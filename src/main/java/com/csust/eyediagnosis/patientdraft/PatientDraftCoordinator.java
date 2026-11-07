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

/** Internal application boundary, deliberately not exposed by a controller. Never publishes or saves diagnoses. */
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
    // Bounded queue also permits handoff while the preceding Future is finishing on its worker thread.
    private final ThreadPoolExecutor calls = new ThreadPoolExecutor(1, 1, 0, TimeUnit.SECONDS, new ArrayBlockingQueue<>(1), r -> {
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
    public record Message(int sequence, String role, String state, String output) {}
    public record Report(String status, String stopReason, int calls, int supplements, int rewrites,
                         String inferenceDigest, List<Evidence> evidence, List<Draft> drafts, List<Message> messages) {}

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
        try {
            Inference inference = claimed.inference();
            String disease = inference.predictedLabel().toUpperCase(Locale.ROOT);
            Vision analysis = invoke(taskId, "VISION", inference, () -> vision.analyze(inference));
            validateVision(analysis);
            var searchContext = new EvidenceContext(inference, analysis, null);
            Retrieved retrieved = invoke(taskId, "EVIDENCE", searchContext, () -> evidence.retrieve(searchContext, disease, TOPIC));
            Evidence frozen = freeze(taskId, disease, 1, retrieved.citations());
            var initialContext = new ExplanationContext(inference, analysis, frozen, null, null);
            Draft draft = invoke(taskId, "EXPLANATION", initialContext, () -> explanation.explain(initialContext));
            validateDraft(draft, frozen);
            saveDraft(taskId, 1, draft);
            var initialReview = new CriticContext(inference, analysis, frozen, draft);
            Critique review = invoke(taskId, "CRITIC", initialReview, () -> critic.critique(initialReview));
            validateCritique(review, draft, frozen);
            if (!"NONE".equals(review.action())) {
                boolean supplement = "SUPPLEMENT".equals(review.action());
                reserveFeedback(taskId, supplement);
                if (supplement) {
                    retriever.withValidatedEvidence(disease, TOPIC, frozen.citations(), () -> null);
                    var feedbackContext = new EvidenceContext(inference, analysis, review);
                    var extra = invoke(taskId, "EVIDENCE", feedbackContext, () -> evidence.retrieve(feedbackContext, disease, TOPIC));
                    var combined = new LinkedHashMap<String, Citation>();
                    for (Citation citation : frozen.citations()) combined.put(citation.documentId() + ":" + citation.chunkIndex(), citation);
                    for (Citation citation : extra.citations()) combined.putIfAbsent(citation.documentId() + ":" + citation.chunkIndex(), citation);
                    if (combined.size() == frozen.citations().size()) throw new Stop("INSUFFICIENT_EVIDENCE");
                    frozen = freeze(taskId, disease, 2, List.copyOf(combined.values()));
                }
                var rewriteContext = new ExplanationContext(inference, analysis, frozen, draft, review);
                draft = invoke(taskId, "EXPLANATION", rewriteContext, () -> explanation.explain(rewriteContext));
                validateDraft(draft, frozen);
                saveDraft(taskId, 2, draft);
                var reviewContext = new CriticContext(inference, analysis, frozen, draft);
                review = invoke(taskId, "CRITIC", reviewContext, () -> critic.critique(reviewContext));
                validateCritique(review, draft, frozen);
                if (!"NONE".equals(review.action())) throw new Stop("FEEDBACK_LIMIT");
            }
            retriever.withValidatedEvidence(disease, TOPIC, frozen.citations(), () -> guarded(taskId, () -> {
                jdbc.update("UPDATE t_patient_draft_run SET status='REVIEW_READY' WHERE taskId=?", taskId);
                jdbc.update("UPDATE t_diagnosis_task SET status='WAITING_REVIEW',version=version+1,updatedAt=CURRENT_TIMESTAMP(6) WHERE taskId=? AND BINARY status=BINARY 'DRAFTING'", taskId);
                return null;
            }));
        } catch (Stop e) { restrict(taskId, e.reason); }
        catch (ControlledEvidenceRetriever.EvidenceUnavailable e) { restrict(taskId, "SOURCE_INVALIDATED"); }
        catch (Exception e) { log.error("Patient draft run failed for an unexpected reason", e); restrict(taskId, "INVALID_OUTPUT"); }
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
            jdbc.update("INSERT INTO t_patient_draft_run (taskId,inferenceDigest,status,startedAt,deadlineAt) VALUES (?,?,'RUNNING',?,?)",
                    taskId, bound.digest(), now(), Timestamp.from(clock.instant().plusMillis(budget.totalMillis())));
            jdbc.update("UPDATE t_diagnosis_task SET status='DRAFTING',version=version+1,updatedAt=CURRENT_TIMESTAMP(6) WHERE taskId=?", taskId);
            return new Claimed(taskId, inference);
        });
    }

    private Claimed invalidInference(String taskId, String digest, String reason) {
        jdbc.update("INSERT INTO t_patient_draft_run (taskId,inferenceDigest,status,stopReason,startedAt,deadlineAt) VALUES (?,?,'RESTRICTED',?,?,?)",
                taskId, digest, reason, now(), Timestamp.from(clock.instant().plusMillis(budget.totalMillis())));
        jdbc.update("UPDATE t_diagnosis_task SET status='RESTRICTED',version=version+1,updatedAt=CURRENT_TIMESTAMP(6) WHERE taskId=?", taskId);
        return null;
    }

    private record Bound(String taskId, Map<String, Object> task, String snapshot, String digest) {}
    private record Claimed(String taskId, Inference inference) {}

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

    private <T> T invoke(String taskId, String role, Object context, Callable<T> action) throws Exception {
        int sequence = guarded(taskId, () -> {
            int count = jdbc.queryForObject("SELECT callCount FROM t_patient_draft_run WHERE taskId=?", Integer.class, taskId);
            if (count >= budget.maxCalls()) throw new Stop("CALL_BUDGET");
            jdbc.update("UPDATE t_patient_draft_run SET callCount=callCount+1 WHERE taskId=?", taskId);
            jdbc.update("INSERT INTO t_patient_draft_message (taskId,sequence,role,state,output) VALUES (?,?,?,'STARTED',?)", taskId, count + 1, role, encode(Map.of("context", context)));
            return count + 1;
        });
        Future<T> future;
        try { future = calls.submit(action); }
        catch (RejectedExecutionException e) { throw new Stop("MODEL_BUSY"); }
        try {
            long remaining = jdbc.queryForObject("SELECT deadlineAt FROM t_patient_draft_run WHERE taskId=?", Timestamp.class, taskId).toInstant().toEpochMilli() - clock.millis();
            if (remaining <= 0) throw new Stop("TOTAL_TIMEOUT");
            T result = future.get(Math.min(remaining, budget.callMillis()), TimeUnit.MILLISECONDS);
            guarded(taskId, () -> {
                jdbc.update("UPDATE t_patient_draft_message SET state='COMPLETED',output=? WHERE taskId=? AND sequence=?", encode(Map.of("context", context, "result", result)), taskId, sequence);
                return null;
            });
            return result;
        } catch (TimeoutException e) { throw new Stop("AGENT_TIMEOUT"); }
        catch (ExecutionException e) { log.warn("Patient draft model call failed", e.getCause() != null ? e.getCause() : e); throw new Stop("INVALID_OUTPUT"); }
        catch (InterruptedException e) { Thread.currentThread().interrupt(); throw new Stop("INTERRUPTED"); }
        finally { future.cancel(true); calls.purge(); }
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
            int changed = jdbc.update("UPDATE t_patient_draft_run SET status='RESTRICTED',stopReason=? WHERE taskId=? AND BINARY status=BINARY 'RUNNING'", reason, taskId);
            if (changed == 1) {
                jdbc.update("UPDATE t_patient_draft_message SET state='STOPPED' WHERE taskId=? AND state='STARTED'", taskId);
                jdbc.update("UPDATE t_diagnosis_task SET status='RESTRICTED',version=version+1,updatedAt=CURRENT_TIMESTAMP(6) WHERE taskId=? AND BINARY status=BINARY 'DRAFTING'", taskId);
            }
        });
    }

    static void requireText(String text, int max) {
        if (text == null || text.isBlank() || text.length() > max) throw new Stop("INVALID_OUTPUT");
    }
    private void validateVision(Vision output) {
        requireText(output.summary(), 2000);
        if (output.limitations() == null || output.limitations().size() > 20) throw new Stop("INVALID_OUTPUT");
        output.limitations().forEach(value -> requireText(value, 1000));
        if (!Set.of("NONE", "RECAPTURE", "REVIEW_QUALITY").contains(Objects.toString(output.reanalysisSuggestion(), ""))) throw new Stop("INVALID_OUTPUT");
    }
    private void validateDraft(Draft draft, Evidence frozen) {
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
        var messages = jdbc.query("SELECT sequence,role,state,output FROM t_patient_draft_message WHERE taskId=? ORDER BY sequence",
                (rs, n) -> new Message(rs.getInt(1), rs.getString(2), rs.getString(3), rs.getString(4)), taskId);
        return new Report((String) run.get("status"), (String) run.get("stopReason"), ((Number) run.get("callCount")).intValue(),
                ((Number) run.get("supplementCount")).intValue(), ((Number) run.get("rewriteCount")).intValue(),
                (String) run.get("inferenceDigest"), evidenceVersions, drafts, messages);
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
    private static final class Stop extends RuntimeException {
        final String reason;
        Stop(String reason) { this.reason = reason; }
    }
    @Override @jakarta.annotation.PreDestroy
    public void close() { calls.shutdownNow(); }
}
