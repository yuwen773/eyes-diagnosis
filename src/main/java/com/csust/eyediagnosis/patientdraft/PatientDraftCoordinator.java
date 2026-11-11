package com.csust.eyediagnosis.patientdraft;

import com.csust.eyediagnosis.controlledreference.ControlledEvidenceRetriever;
import com.csust.eyediagnosis.controlledreference.ControlledEvidenceRetriever.Citation;
import com.csust.eyediagnosis.grpc.DiagnosisProto;
import com.csust.eyediagnosis.patientdraft.DraftAgents.*;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.ai.chat.model.ChatModel;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DataSourceTransactionManager;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionTemplate;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.sql.Timestamp;
import java.time.Clock;
import java.util.*;
import java.util.concurrent.*;
import java.util.function.Supplier;

/**
 * Internal application boundary. Never publishes or saves diagnoses, and the only controller in front of it is
 * the opt-in admin test entry ({@link PatientDraftTestService}), which starts the same run a poller would.
 */
@Service
public class PatientDraftCoordinator implements AutoCloseable {
    private static final Logger log = LoggerFactory.getLogger(PatientDraftCoordinator.class);
    private static final Set<String> SECTIONS = Set.of("MAIN_FINDING", "RISK", "NEXT_STEP", "UNCERTAINTY", "DETAIL", "LIMITATION");
    private static final Set<String> LABELS = Set.of("normal", "amd", "cataract", "diabetes", "glaucoma", "hypertension", "myopia", "other");
    private static final String TOPIC = "PATIENT_EXPLANATION";
    private final JdbcTemplate jdbc;
    private final ControlledEvidenceRetriever retriever;
    private final Clock clock;
    private final Budget budget;
    private final ObjectMapper json = new ObjectMapper().findAndRegisterModules();
    private final TransactionTemplate transactions;
    private final VisionAgent vision;
    private final EvidenceAgent evidence;
    private final ExplanationAgent explanation;
    private final CriticAgent critic;
    // Two provider slots and a bounded queue; orchestration never blocks a provider worker.
    private final ThreadPoolExecutor calls = new ThreadPoolExecutor(2, 2, 0, TimeUnit.SECONDS, new ArrayBlockingQueue<>(2), r -> {
        var thread = new Thread(r, "patient-draft-model"); thread.setDaemon(true); return thread;
    });

    public record Budget(int maxCalls, long totalMillis, long callMillis) {
        public Budget {
            if (maxCalls < 1 || maxCalls > 8 || totalMillis < 1 || totalMillis > 90_000 || callMillis < 1 || callMillis > 20_000) {
                throw new IllegalArgumentException("Budget exceeds the approved ceiling");
            }
        }
    }
    public record Evidence(int version, List<Citation> citations) {}
    public record Message(int sequence, String role, String state, String output, java.time.Instant startedAt, java.time.Instant completedAt) {}
    public record Report(String status, String stopReason, int calls, int supplements, int rewrites,
                         String inferenceDigest, List<Evidence> evidence, List<Draft> drafts, List<Message> messages, String workflowVersion) {}

    @Autowired
    public PatientDraftCoordinator(JdbcTemplate jdbc, ControlledEvidenceRetriever retriever, ChatModel model) {
        this(jdbc, retriever, model, Clock.systemUTC(), new Budget(8, 90_000, 20_000));
    }

    public PatientDraftCoordinator(JdbcTemplate jdbc, ControlledEvidenceRetriever retriever, ChatModel model, Clock clock, Budget budget) {
        this.jdbc = jdbc; this.retriever = retriever; this.clock = clock; this.budget = budget;
        this.transactions = new TransactionTemplate(new DataSourceTransactionManager(Objects.requireNonNull(jdbc.getDataSource())));
        var transport = new Transport(model);
        vision = new VisionAgent(transport); evidence = new EvidenceAgent(transport, retriever);
        explanation = new ExplanationAgent(transport); critic = new CriticAgent(transport);
    }

    public void run(String requestedTaskId) {
        Claimed claimed = claim(requestedTaskId);
        if (claimed == null) return;
        String taskId = claimed.taskId();
        var run = new AutonomousRun(taskId, claimed.inference(), claimed.deadline());
        try { run.execute(); }
        catch (Stop e) { restrict(taskId, e.reason); }
        catch (DraftMailbox.Rejected e) { restrict(taskId, e.reason); }
        catch (ControlledEvidenceRetriever.EvidenceUnavailable e) { restrict(taskId, "SOURCE_INVALIDATED"); }
        catch (InterruptedException e) { Thread.currentThread().interrupt(); restrict(taskId, "INTERRUPTED"); }
        catch (Exception e) { log.error("Patient draft run failed for an unexpected reason", e); restrict(taskId, "INVALID_OUTPUT"); }
        finally { run.cancel(); }
    }

    /** A task-local event loop: only validated, addressed messages make another role eligible to run. */
    private final class AutonomousRun {
        private final String taskId;
        private final Inference inference;
        private final String disease;
        private final DraftMailbox mailbox;
        private final java.time.Instant deadline;
        private final List<Pending> active = new ArrayList<>();
        private final BlockingQueue<Completed> completed = new ArrayBlockingQueue<>(8);
        private Evidence frozen;
        private Draft draft;
        private Critique feedback;
        private int draftVersion;
        private boolean ready;

        AutonomousRun(String taskId, Inference inference, java.time.Instant deadline) {
            this.taskId = taskId; this.inference = inference;
            this.deadline = deadline;
            disease = inference.predictedLabel().toUpperCase(Locale.ROOT);
            mailbox = new DraftMailbox(taskId, inference.snapshotDigest(), clock);
        }

        void execute() throws Exception {
            launch("VISION", inference, List.of(), () -> vision.analyze(inference));
            var context = new EvidenceContext(inference, null, null);
            launch("EVIDENCE", context, List.of(), () -> evidence.retrieve(context, disease, TOPIC));
            while (!ready) {
                if (active.isEmpty()) throw new Stop("MESSAGE_CONFLICT");
                long remaining = deadline.toEpochMilli() - clock.millis();
                if (remaining <= 0) throw new Stop("TOTAL_TIMEOUT");
                for (Pending call : active) {
                    if (call.startedNanos != 0 && TimeUnit.NANOSECONDS.toMillis(
                            (call.finishedNanos == 0 ? System.nanoTime() : call.finishedNanos) - call.startedNanos) >= budget.callMillis()) {
                        throw new Stop("AGENT_TIMEOUT");
                    }
                }
                Completed done = completed.poll(Math.min(remaining, 20), TimeUnit.MILLISECONDS);
                if (done == null) continue;
                active.remove(done.call());
                if (done.failure() != null) {
                    Throwable cause = done.failure();
                    if (cause instanceof Stop stop) throw stop;
                    if (cause instanceof ControlledEvidenceRetriever.EvidenceUnavailable unavailable) throw unavailable;
                    throw new Stop(transportFailure(cause));
                }
                // Keep rejected provider output inspectable, but never send it to another role.
                recordResult(taskId, done, List.of());
                List<DraftMailbox.Envelope> outgoing = accept(done.call(), done.result());
                recordResult(taskId, done, outgoing);
                if (ready) {
                    retriever.withValidatedEvidence(disease, TOPIC, frozen.citations(), () -> guarded(taskId, () -> {
                        jdbc.update("UPDATE t_patient_draft_run SET status='REVIEW_READY' WHERE taskId=?", taskId);
                        jdbc.update("UPDATE t_diagnosis_task SET status='WAITING_REVIEW',version=version+1,updatedAt=CURRENT_TIMESTAMP(6) WHERE taskId=? AND BINARY status=BINARY 'DRAFTING'", taskId);
                        return null;
                    }));
                } else schedule();
            }
        }

        private void launch(String role, Object context, List<DraftMailbox.Envelope> inbox, Callable<?> action) {
            if (active.stream().anyMatch(c -> c.role.equals(role))) throw new Stop("MESSAGE_CONFLICT");
            active.add(start(taskId, role, context, inbox, action, completed));
        }

        private List<DraftMailbox.Envelope> accept(Pending call, Object result) {
            var outgoing = new ArrayList<DraftMailbox.Envelope>();
            String cause = call.inbox.isEmpty() ? null : call.inbox.getLast().messageId();
            switch (call.role) {
                case "VISION" -> {
                    validateVision((Vision) result);
                    for (String to : List.of("EVIDENCE", "EXPLANATION", "CRITIC"))
                        outgoing.add(mailbox.send(call.sequence, call.role, to, "VISION_READY", cause, null, null, result));
                }
                case "EVIDENCE" -> {
                    var retrieved = (Retrieved) result;
                    List<Citation> citations = retrieved.citations();
                    if (frozen != null) {
                        var combined = new LinkedHashMap<String, Citation>();
                        for (Citation c : frozen.citations()) combined.put(c.documentId() + ":" + c.chunkIndex(), c);
                        for (Citation c : citations) combined.putIfAbsent(c.documentId() + ":" + c.chunkIndex(), c);
                        if (combined.size() == frozen.citations().size()) throw new Stop("INSUFFICIENT_EVIDENCE");
                        citations = List.copyOf(combined.values());
                    }
                    frozen = freeze(taskId, disease, frozen == null ? 1 : 2, citations);
                    for (String to : List.of("EXPLANATION", "CRITIC"))
                        outgoing.add(mailbox.send(call.sequence, call.role, to, "EVIDENCE_READY", cause, frozen.version(), null, frozen));
                }
                case "EXPLANATION" -> {
                    draft = (Draft) result;
                    validateDraft(draft, frozen);
                    saveDraft(taskId, ++draftVersion, draft);
                    outgoing.add(mailbox.send(call.sequence, call.role, "CRITIC", "DRAFT_READY", cause, frozen.version(), draftVersion, draft));
                }
                case "CRITIC" -> {
                    var review = (Critique) result;
                    validateCritique(review, draft, frozen);
                    if ("NONE".equals(review.action())) {
                        outgoing.add(mailbox.send(call.sequence, call.role, "GATE", "REVIEW_COMPLETED", cause, frozen.version(), draftVersion, review));
                        ready = true;
                    } else {
                        boolean supplement = "SUPPLEMENT".equals(review.action());
                        reserveFeedback(taskId, supplement);
                        feedback = review;
                        outgoing.add(mailbox.send(call.sequence, call.role, supplement ? "EVIDENCE" : "EXPLANATION",
                                supplement ? "SUPPLEMENT_REQUESTED" : "REWRITE_REQUESTED", cause, frozen.version(), draftVersion, review));
                    }
                }
                default -> throw new Stop("INVALID_MESSAGE_ROUTE");
            }
            return List.copyOf(outgoing);
        }

        private void schedule() {
            var visionForEvidence = mailbox.latest("EVIDENCE", "VISION_READY");
            var supplement = mailbox.latest("EVIDENCE", "SUPPLEMENT_REQUESTED");
            if (mailbox.unread(supplement)) {
                checkFeedback(supplement);
                retriever.withValidatedEvidence(disease, TOPIC, frozen.citations(), () -> null);
                var context = new EvidenceContext(inference, (Vision) visionForEvidence.payload(), (Critique) supplement.payload());
                launch("EVIDENCE", context, mailbox.consume(visionForEvidence, supplement), () -> evidence.retrieve(context, disease, TOPIC));
                return;
            }
            var v = mailbox.latest("EXPLANATION", "VISION_READY");
            var e = mailbox.latest("EXPLANATION", "EVIDENCE_READY");
            var rewrite = mailbox.latest("EXPLANATION", "REWRITE_REQUESTED");
            if (v != null && e != null && (draft == null || mailbox.unread(rewrite) || mailbox.unread(e))
                    && active.stream().noneMatch(c -> c.role.equals("EXPLANATION"))) {
                if (rewrite != null) checkFeedback(rewrite);
                var context = new ExplanationContext(inference, (Vision) v.payload(), ExplanationEvidence.from((Evidence) e.payload()), draft, feedback);
                launch("EXPLANATION", context, mailbox.consume(v, e, rewrite), () -> explanation.explain(context));
                return;
            }
            var d = mailbox.latest("CRITIC", "DRAFT_READY");
            if (mailbox.unread(d)) {
                var cv = mailbox.latest("CRITIC", "VISION_READY");
                var ce = mailbox.latest("CRITIC", "EVIDENCE_READY");
                if (cv == null || ce == null || !Objects.equals(d.evidenceVersion(), ce.evidenceVersion())) throw new Stop("MESSAGE_CONFLICT");
                var context = new CriticContext(inference, (Vision) cv.payload(), (Evidence) ce.payload(), (Draft) d.payload());
                launch("CRITIC", context, mailbox.consume(cv, ce, d), () -> critic.critique(context));
            }
        }

        private void checkFeedback(DraftMailbox.Envelope message) {
            if (!Objects.equals(message.draftVersion(), draftVersion) || !Objects.equals(message.evidenceVersion(), frozen.version()))
                throw new Stop("MESSAGE_CONFLICT");
        }

        void cancel() { active.forEach(c -> c.future.cancel(true)); calls.purge(); }
    }

    /** Selects only unstarted work or expired, interrupted work; completed/restricted runs never replay calls. */
    public void runPendingOnce() {
        var candidates = jdbc.query("SELECT t.taskId FROM t_diagnosis_task t LEFT JOIN t_patient_draft_run r ON t.taskId=r.taskId "
                        + "WHERE (BINARY t.status=BINARY 'WAITING_REVIEW' AND r.taskId IS NULL) "
                        + "OR (BINARY t.status=BINARY 'DRAFTING' AND BINARY r.status=BINARY 'RUNNING' AND r.deadlineAt<=?) "
                        + "ORDER BY t.createdAt,t.taskId LIMIT 1", (rs, n) -> rs.getString(1), now());
        if (!candidates.isEmpty()) run(candidates.getFirst());
    }

    private Claimed claim(String requestedTaskId) {
        return transactions.execute(tx -> {
            var tasks = jdbc.queryForList("SELECT * FROM t_diagnosis_task WHERE taskId=? FOR UPDATE", requestedTaskId);
            if (tasks.size() != 1 || !Set.of("WAITING_REVIEW", "DRAFTING").contains(tasks.getFirst().get("status"))) return null;
            // Legacy task ids use a case-insensitive collation; budgets must use the stored canonical id.
            String taskId = (String) tasks.getFirst().get("taskId");
            var existing = jdbc.query("SELECT status,deadlineAt FROM t_patient_draft_run WHERE taskId=?",
                    (rs, n) -> new Gate(rs.getString(1), rs.getTimestamp(2).toInstant()), taskId);
            if (!existing.isEmpty()) {
                if ("RUNNING".equals(existing.getFirst().status()) && !existing.getFirst().deadline().isAfter(clock.instant())) {
                    restrict(taskId, "INTERRUPTED_OR_TIMEOUT");
                }
                return null;
            }
            String snapshot = Objects.toString(tasks.getFirst().get("inferenceSnapshot"), "");
            Bound bound = new Bound(taskId, tasks.getFirst(), snapshot, digest(snapshot));
            Inference inference;
            try {
                inference = inference(bound);
            } catch (Stop e) {
                // Invalid inference never starts generation: commit a terminal audit row without entering DRAFTING.
                return invalidInference(taskId, bound.digest(), e.reason);
            } catch (Exception e) {
                log.error("Patient draft inference snapshot could not be read", e);
                return invalidInference(taskId, bound.digest(), "INVALID_INFERENCE");
            }
            var deadline = clock.instant().plusMillis(budget.totalMillis());
            jdbc.update("INSERT INTO t_patient_draft_run (taskId,inferenceDigest,workflowVersion,status,startedAt,deadlineAt) VALUES (?,?,?,'RUNNING',?,?)",
                    taskId, bound.digest(), DraftMailbox.VERSION, now(), Timestamp.from(deadline));
            jdbc.update("UPDATE t_diagnosis_task SET status='DRAFTING',version=version+1,updatedAt=CURRENT_TIMESTAMP(6) WHERE taskId=?", taskId);
            return new Claimed(taskId, inference, deadline);
        });
    }

    private Claimed invalidInference(String taskId, String digest, String reason) {
        jdbc.update("INSERT INTO t_patient_draft_run (taskId,inferenceDigest,workflowVersion,status,stopReason,startedAt,deadlineAt) VALUES (?,?,?,'RESTRICTED',?,?,?)",
                taskId, digest, DraftMailbox.VERSION, reason, now(), Timestamp.from(clock.instant().plusMillis(budget.totalMillis())));
        jdbc.update("UPDATE t_diagnosis_task SET status='RESTRICTED',version=version+1,updatedAt=CURRENT_TIMESTAMP(6) WHERE taskId=?", taskId);
        return null;
    }

    private record Bound(String taskId, Map<String, Object> task, String snapshot, String digest) {}
    private record Claimed(String taskId, Inference inference, java.time.Instant deadline) {}

    private Inference inference(Bound bound) {
        JsonNode root;
        try { root = json.readTree(bound.snapshot()); }
        catch (Exception e) { throw new Stop("INVALID_INFERENCE"); }
        if (root == null) throw new Stop("INVALID_INFERENCE");
        for (String field : List.of("taskId", "userId", "objectKey", "objectVersion", "imageDigest", "imageFormat")) {
            if (!root.hasNonNull(field) || !root.get(field).asText().equals(Objects.toString(bound.task().get(field), ""))) throw new Stop("INVALID_INFERENCE");
        }
        DiagnosisProto.DiagnosisResponse response;
        try {
            response = DiagnosisProto.DiagnosisResponse.parseFrom(Base64.getDecoder().decode(root.path("responseProtobufBase64").asText()));
        } catch (Exception e) { throw new Stop("INVALID_INFERENCE"); }
        // gRPC/Python emits probability as a 0-100 percentage (algorithm/grpc_server.py), matching DiagnosisResultVO.
        if (response.getRejected() || response.getIsOod() || response.getOodStatus() != DiagnosisProto.OodStatus.IN_DISTRIBUTION
                || !LABELS.contains(response.getPredictedLabel()) || !Double.isFinite(response.getProbability())
                || response.getProbability() < 0 || response.getProbability() > 100) throw new Stop("INVALID_INFERENCE");
        return new Inference(bound.digest(), response.getPredictedLabel(), response.getProbability(), response.getQualityScore(),
                response.getQualityReasons(), response.getCalibrationStatus(), response.getModelVersion(), response.getPreprocessVersion());
    }

    private static final class Pending {
        final int sequence;
        final String role;
        final Object context;
        final List<DraftMailbox.Envelope> inbox;
        volatile long startedNanos;
        volatile long finishedNanos;
        volatile java.time.Instant finishedAt;
        Future<?> future;
        Pending(int sequence, String role, Object context, List<DraftMailbox.Envelope> inbox) {
            this.sequence = sequence; this.role = role; this.context = context; this.inbox = inbox;
        }
    }
    private record Completed(Pending call, Object result, Throwable failure) {}

    private Pending start(String taskId, String role, Object context, List<DraftMailbox.Envelope> inbox,
                          Callable<?> action, BlockingQueue<Completed> completed) {
        int sequence = guarded(taskId, () -> {
            int count = jdbc.queryForObject("SELECT callCount FROM t_patient_draft_run WHERE taskId=?", Integer.class, taskId);
            if (count >= budget.maxCalls()) throw new Stop("CALL_BUDGET");
            jdbc.update("UPDATE t_patient_draft_run SET callCount=callCount+1 WHERE taskId=?", taskId);
            jdbc.update("INSERT INTO t_patient_draft_message (taskId,sequence,role,state,output) VALUES (?,?,?,'STARTED',?)",
                    taskId, count + 1, role, encode(Map.of("context", context, "collaboration", Map.of(
                            "workflowVersion", DraftMailbox.VERSION, "inbox", inbox, "outgoing", List.of()))));
            return count + 1;
        });
        var pending = new Pending(sequence, role, context, inbox);
        try {
            pending.future = calls.submit(() -> {
                Object result = null; Throwable failure = null;
                try {
                    guarded(taskId, () -> {
                        jdbc.update("UPDATE t_patient_draft_message SET startedAt=? WHERE taskId=? AND sequence=?", now(), taskId, sequence);
                        return null;
                    });
                    pending.startedNanos = System.nanoTime();
                    result = action.call();
                } catch (Throwable e) { failure = e; }
                finally { pending.finishedNanos = System.nanoTime(); pending.finishedAt = clock.instant(); }
                completed.offer(new Completed(pending, result, failure));
            });
        } catch (RejectedExecutionException e) { throw new Stop("MODEL_BUSY"); }
        return pending;
    }

    private void recordResult(String taskId, Completed done, List<DraftMailbox.Envelope> outgoing) {
        Pending call = done.call();
        if (call.startedNanos != 0 && TimeUnit.NANOSECONDS.toMillis(call.finishedNanos - call.startedNanos) >= budget.callMillis())
            throw new Stop("AGENT_TIMEOUT");
        guarded(taskId, () -> {
            jdbc.update("UPDATE t_patient_draft_message SET state='COMPLETED',output=?,completedAt=? WHERE taskId=? AND sequence=?",
                    encode(Map.of("context", call.context, "result", done.result(), "collaboration", Map.of(
                            "workflowVersion", DraftMailbox.VERSION, "inbox", call.inbox, "outgoing", outgoing))), Timestamp.from(call.finishedAt), taskId, call.sequence);
            return null;
        });
    }

    /**
     * Separates provider/transport faults from unusable model output. Both arrive as a failed call, but only
     * output faults are the model's contract to keep; credential, quota and network faults must be actionable
     * from the recorded stop reason alone. Spring AI turns provider responses into
     * {@code NonTransientAiException}/{@code TransientAiException}. Spring AI 1.1.2 formats the message as
     * "HTTP 401 - {body}" (its retry autoconfiguration), while older/other adapters use "401 - {body}"; accept
     * both, preferring the explicit {@code HTTP nnn} token. Clients that surface
     * {@link org.springframework.web.client.RestClientResponseException} directly keep the status object.
     */
    private static final java.util.regex.Pattern HTTP_STATUS = java.util.regex.Pattern.compile("(?i)\\bHTTP\\s+(\\d{3})\\b");
    private static final java.util.regex.Pattern BARE_STATUS = java.util.regex.Pattern.compile("^\\s*(\\d{3})\\s*-");

    static String transportFailure(Throwable failure) {
        for (Throwable cause = failure; cause != null; cause = cause.getCause()) {
            // Jackson parse failures are broken model output, not a transport fault; check them before IOException.
            if (cause instanceof com.fasterxml.jackson.core.JsonProcessingException) return "INVALID_OUTPUT";
            if (cause instanceof org.springframework.web.client.RestClientResponseException http) {
                return providerStatusReason(http.getStatusCode().value());
            }
            if (cause instanceof org.springframework.ai.retry.NonTransientAiException
                    || cause instanceof org.springframework.ai.retry.TransientAiException) {
                String message = Objects.toString(cause.getMessage(), "");
                var http = HTTP_STATUS.matcher(message);
                if (http.find()) return providerStatusReason(Integer.parseInt(http.group(1)));
                var bare = BARE_STATUS.matcher(message);
                return bare.find() ? providerStatusReason(Integer.parseInt(bare.group(1))) : "PROVIDER_UNAVAILABLE";
            }
            if (cause instanceof java.io.IOException || cause instanceof TimeoutException) return "PROVIDER_UNAVAILABLE";
        }
        return "INVALID_OUTPUT";
    }

    private static String providerStatusReason(int status) {
        if (status == 401 || status == 403) return "PROVIDER_AUTH";
        if (status == 429) return "PROVIDER_RATE_LIMIT";
        return "PROVIDER_UNAVAILABLE";
    }

    private Evidence freeze(String taskId, String disease, int version, List<Citation> citations) {
        if (citations == null || citations.isEmpty()) throw new Stop("INSUFFICIENT_EVIDENCE");
        return retriever.withValidatedEvidence(disease, TOPIC, citations, () -> guarded(taskId, () -> {
            jdbc.update("INSERT INTO t_patient_evidence_version (taskId,version,citations) VALUES (?,?,?)", taskId, version, encode(citations));
            return new Evidence(version, List.copyOf(citations));
        }));
    }

    private void saveDraft(String taskId, int version, Draft draft) {
        guarded(taskId, () -> {
            jdbc.update("INSERT INTO t_patient_draft_version (taskId,version,evidenceVersion,draft) VALUES (?,?,?,?)", taskId, version, draft.evidenceVersion(), encode(draft));
            return null;
        });
    }

    private void reserveFeedback(String taskId, boolean supplement) {
        guarded(taskId, () -> {
            int updated = jdbc.update("UPDATE t_patient_draft_run SET rewriteCount=rewriteCount+1,supplementCount=supplementCount+? WHERE taskId=? AND rewriteCount=0 AND supplementCount=0",
                    supplement ? 1 : 0, taskId);
            if (updated != 1) throw new Stop("FEEDBACK_LIMIT");
            return null;
        });
    }

    private <T> T guarded(String taskId, Supplier<T> action) {
        return transactions.execute(tx -> {
            // Consistent task -> run lock ordering, including claim/recovery and restriction.
            var tasks = jdbc.queryForList("SELECT status,inferenceSnapshot FROM t_diagnosis_task WHERE taskId=? FOR UPDATE", taskId);
            var rows = jdbc.query("SELECT status,deadlineAt,inferenceDigest FROM t_patient_draft_run WHERE taskId=? FOR UPDATE",
                    (rs, n) -> new RunGate(rs.getString(1), rs.getTimestamp(2).toInstant(), rs.getString(3)), taskId);
            if (rows.size() != 1 || !"RUNNING".equals(rows.getFirst().status())) throw new Stop("STALE_EXECUTOR");
            if (!rows.getFirst().deadline().isAfter(clock.instant())) throw new Stop("TOTAL_TIMEOUT");
            if (tasks.size() != 1 || !"DRAFTING".equals(tasks.getFirst().get("status"))
                    || !rows.getFirst().digest().equals(digest(Objects.toString(tasks.getFirst().get("inferenceSnapshot"), "")))) throw new Stop("INVALID_INFERENCE");
            return action.get();
        });
    }

    private record Gate(String status, java.time.Instant deadline) {}
    private record RunGate(String status, java.time.Instant deadline, String digest) {}

    private void restrict(String taskId, String reason) {
        transactions.executeWithoutResult(tx -> {
            jdbc.queryForList("SELECT taskId FROM t_diagnosis_task WHERE taskId=? FOR UPDATE", taskId);
            // A run recovered after process death stopped at its deadline, not when a later process noticed it.
            var stoppedAt = "INTERRUPTED_OR_TIMEOUT".equals(reason)
                    ? jdbc.query("SELECT deadlineAt FROM t_patient_draft_run WHERE taskId=?", (rs, n) -> rs.getTimestamp(1), taskId)
                            .stream().filter(Objects::nonNull).findFirst().orElse(now())
                    : now();
            int changed = jdbc.update("UPDATE t_patient_draft_run SET status='RESTRICTED',stopReason=? WHERE taskId=? AND BINARY status=BINARY 'RUNNING'", reason, taskId);
            if (changed == 1) {
                jdbc.update("UPDATE t_patient_draft_message SET state='STOPPED',completedAt=? WHERE taskId=? AND state='STARTED'", stoppedAt, taskId);
                jdbc.update("UPDATE t_diagnosis_task SET status='RESTRICTED',version=version+1,updatedAt=CURRENT_TIMESTAMP(6) WHERE taskId=? AND BINARY status=BINARY 'DRAFTING'", taskId);
            }
        });
    }

    /** The six sections every accepted draft must cover, exposed for operator reporting. */
    public static Set<String> requiredSections() { return SECTIONS; }

    static void requireText(String text, int max) {
        if (text == null || text.isBlank() || text.length() > max) throw new Stop("INVALID_OUTPUT");
    }
    private void validateVision(Vision output) {
        requireText(output.summary(), 2000);
        if (output.limitations() == null || output.limitations().size() > 20) throw new Stop("INVALID_OUTPUT");
        output.limitations().forEach(value -> requireText(value, 1000));
        if (!Set.of("NONE", "RECAPTURE", "REVIEW_QUALITY").contains(Objects.toString(output.reanalysisSuggestion(), ""))) throw new Stop("INVALID_OUTPUT");
    }
    public static void validateDraft(Draft draft, Evidence frozen) {
        if (draft.evidenceVersion() != frozen.version() || draft.claims() == null || draft.claims().size() > 30) throw new Stop("INVALID_OUTPUT");
        var ids = new HashSet<String>(); var sections = new HashSet<String>();
        for (Claim claim : draft.claims()) {
            if (claim == null) throw new Stop("INVALID_OUTPUT");
            requireText(claim.id(), 64); requireText(claim.text(), 2000);
            if (!ids.add(claim.id()) || !SECTIONS.contains(claim.section()) || claim.references() == null || claim.references().isEmpty() || claim.references().size() > 5) throw new Stop("INVALID_OUTPUT");
            sections.add(claim.section());
            for (Reference ref : claim.references()) {
                if (ref == null) throw new Stop("INVALID_OUTPUT");
                requireText(ref.quote(), 2000);
                if (ref.citationIndex() < 0 || ref.citationIndex() >= frozen.citations().size()
                        || frozen.citations().get(ref.citationIndex()) == null
                        || frozen.citations().get(ref.citationIndex()).excerpt() == null
                        || !frozen.citations().get(ref.citationIndex()).excerpt().contains(ref.quote())) throw new Stop("INVALID_CITATION");
            }
        }
        if (!sections.containsAll(SECTIONS)) throw new Stop("INVALID_OUTPUT");
    }
    private void validateCritique(Critique review, Draft draft, Evidence frozen) {
        if (review.objections() == null || review.objections().size() > 20 || !Set.of("NONE", "SUPPLEMENT", "REWRITE").contains(Objects.toString(review.action(), ""))
                || "NONE".equals(review.action()) != review.objections().isEmpty()) throw new Stop("INVALID_OUTPUT");
        var targets = new HashSet<String>(); targets.add("vision:summary");
        draft.claims().forEach(claim -> targets.add("claim:" + claim.id()));
        for (int i = 0; i < frozen.citations().size(); i++) targets.add("evidence:" + i);
        for (Objection objection : review.objections()) {
            if (objection == null) throw new Stop("INVALID_OUTPUT");
            requireText(objection.reason(), 2000);
            if (!targets.contains(objection.target())) throw new Stop("INVALID_OBJECTION");
        }
    }

    /** Trusted backend callers only. Raw structured drafts/messages must never enter patient DTOs. */
    public Report inspect(String taskId) {
        var runs = jdbc.queryForList("SELECT * FROM t_patient_draft_run WHERE taskId=?", taskId);
        if (runs.isEmpty()) return null;
        var run = runs.getFirst();
        var evidenceVersions = jdbc.query("SELECT version,citations FROM t_patient_evidence_version WHERE taskId=? ORDER BY version",
                (rs, n) -> new Evidence(rs.getInt(1), decode(rs.getString(2), new TypeReference<List<Citation>>() {})), taskId);
        var drafts = jdbc.query("SELECT draft FROM t_patient_draft_version WHERE taskId=? ORDER BY version",
                (rs, n) -> decode(rs.getString(1), new TypeReference<Draft>() {}), taskId);
        var messages = jdbc.query("SELECT sequence,role,state,output,startedAt,completedAt FROM t_patient_draft_message WHERE taskId=? ORDER BY sequence",
                (rs, n) -> new Message(rs.getInt(1), rs.getString(2), rs.getString(3), rs.getString(4),
                        instant(rs.getTimestamp(5)), instant(rs.getTimestamp(6))), taskId);
        return new Report((String) run.get("status"), (String) run.get("stopReason"), ((Number) run.get("callCount")).intValue(),
                ((Number) run.get("supplementCount")).intValue(), ((Number) run.get("rewriteCount")).intValue(),
                (String) run.get("inferenceDigest"), evidenceVersions, drafts, messages, (String) run.get("workflowVersion"));
    }
    private String encode(Object value) {
        try { return json.writeValueAsString(value); } catch (Exception e) { throw new IllegalStateException(e); }
    }
    private <T> T decode(String value, TypeReference<T> type) {
        try { return json.readValue(value, type); } catch (Exception e) { throw new IllegalStateException(e); }
    }
    private static String digest(String value) {
        try { return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(value.getBytes(StandardCharsets.UTF_8))); }
        catch (Exception e) { throw new IllegalStateException(e); }
    }
    private Timestamp now() { return Timestamp.from(clock.instant()); }
    private static java.time.Instant instant(Timestamp value) { return value == null ? null : value.toInstant(); }

    /** Read-only view of the approved call budget, for operator-facing reporting only. */
    public Budget budget() { return budget; }
    private static final class Stop extends RuntimeException {
        final String reason;
        Stop(String reason) { this.reason = reason; }
    }
    @Override @jakarta.annotation.PreDestroy
    public void close() { calls.shutdownNow(); }
}
