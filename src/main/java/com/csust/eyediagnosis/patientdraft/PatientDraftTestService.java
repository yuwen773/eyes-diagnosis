package com.csust.eyediagnosis.patientdraft;

import com.csust.eyediagnosis.controlledreference.ControlledEvidenceRetriever.Citation;
import com.csust.eyediagnosis.exception.BusinessException;
import com.csust.eyediagnosis.exception.ErrorCode;
import com.csust.eyediagnosis.grpc.DiagnosisProto;
import com.csust.eyediagnosis.patientdraft.DraftAgents.Claim;
import com.csust.eyediagnosis.patientdraft.DraftAgents.Draft;
import com.csust.eyediagnosis.patientdraft.DraftAgents.Reference;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.Instant;
import java.util.*;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * Operator-only trigger and trace for the four-agent draft flow. It adds no capability to the coordinator:
 * it starts the same {@link PatientDraftCoordinator#run(String)} a poller would start and reads back what the
 * coordinator persisted. Raw inference snapshots and patient identity are never returned; the view is role
 * states, per-role timing, citation checks and the stop reason.
 *
 * <p>Registered only when {@code eye-diagnosis.draft.test-entry.enabled=true} and reachable only by admins.
 */
@Service
@ConditionalOnProperty(name = "eye-diagnosis.draft.test-entry.enabled", havingValue = "true")
public class PatientDraftTestService implements AutoCloseable {
    private static final Logger log = LoggerFactory.getLogger(PatientDraftTestService.class);
    private static final Set<String> LABELS = Set.of("normal", "amd", "cataract", "diabetes", "glaucoma", "hypertension", "myopia", "other");
    /**
     * Seeded excerpts carry the label in Chinese and English plus the words a patient-explanation query is
     * likely to use: retrieval only needs one shared token, and every quote in the draft must appear verbatim.
     */
    private static final Map<String, List<String>> SEED_EXCERPTS = Map.ofEntries(
            Map.entry("normal", List.of(
                    "合成资料：正常眼底 normal fundus，建议按医生安排定期复查视力与眼底检查。患者解释需由眼科医生复核，模型概率不代表临床可靠性。",
                    "合成补充：任何解释都不能替代临床检查；不确定性与适用限制应明确告知患者，并由医生确认。")),
            Map.entry("amd", List.of(
                    "合成资料：年龄相关性黄斑变性 AMD macular degeneration，随访需关注中心视力变化与眼底检查。患者解释需由眼科医生复核，模型概率不代表临床可靠性。",
                    "合成补充：任何解释都不能替代临床检查；不确定性与适用限制应明确告知患者，并由医生确认。")),
            Map.entry("cataract", List.of(
                    "合成资料：白内障 cataract，是否手术由眼科医生评估，随访需关注视力变化与眼底检查。患者解释需由眼科医生复核，模型概率不代表临床可靠性。",
                    "合成补充：任何解释都不能替代临床检查；不确定性与适用限制应明确告知患者，并由医生确认。")),
            Map.entry("diabetes", List.of(
                    "合成资料：糖尿病视网膜病变 diabetic retinopathy，随访需定期散瞳眼底检查并配合血糖管理。患者解释需由眼科医生复核，模型概率不代表临床可靠性。",
                    "合成补充：任何解释都不能替代临床检查；不确定性与适用限制应明确告知患者，并由医生确认。")),
            Map.entry("glaucoma", List.of(
                    "合成资料：青光眼 glaucoma，随访需监测眼压、视野与视神经，治疗由眼科医生决定。患者解释需由眼科医生复核，模型概率不代表临床可靠性。",
                    "合成补充：任何解释都不能替代临床检查；不确定性与适用限制应明确告知患者，并由医生确认。")),
            Map.entry("hypertension", List.of(
                    "合成资料：高血压视网膜病变 hypertensive retinopathy，需控制血压并按医嘱复查眼底。患者解释需由眼科医生复核，模型概率不代表临床可靠性。",
                    "合成补充：任何解释都不能替代临床检查；不确定性与适用限制应明确告知患者，并由医生确认。")),
            Map.entry("myopia", List.of(
                    "合成资料：近视 myopia，患者需关注眼底并发症风险并定期检查视网膜。患者解释需由眼科医生复核，模型概率不代表临床可靠性。",
                    "合成补充：任何解释都不能替代临床检查；不确定性与适用限制应明确告知患者，并由医生确认。")),
            Map.entry("other", List.of(
                    "合成资料：其他眼底改变 other fundus findings，需由眼科医生进一步检查确认。患者解释需由眼科医生复核，模型概率不代表临床可靠性。",
                    "合成补充：任何解释都不能替代临床检查；不确定性与适用限制应明确告知患者，并由医生确认。")));
    private final JdbcTemplate jdbc;
    private final PatientDraftCoordinator coordinator;
    private final ObjectMapper json = new ObjectMapper().findAndRegisterModules();
    private final AtomicBoolean busy = new AtomicBoolean();
    private final ExecutorService worker = Executors.newSingleThreadExecutor(runnable -> {
        var thread = new Thread(runnable, "patient-draft-test-entry");
        thread.setDaemon(true);
        return thread;
    });

    @Autowired
    public PatientDraftTestService(JdbcTemplate jdbc, PatientDraftCoordinator coordinator) {
        this.jdbc = jdbc;
        this.coordinator = coordinator;
    }

    /** Recent tasks with their draft-run state; a restricted or ready run can no longer be started again. */
    public List<TaskRow> tasks() {
        return jdbc.query("SELECT t.taskId,t.status,t.createdAt,r.status AS runStatus,r.stopReason,r.callCount "
                        + "FROM t_diagnosis_task t LEFT JOIN t_patient_draft_run r ON r.taskId=t.taskId "
                        + "WHERE t.status IN ('WAITING_REVIEW','DRAFTING','RESTRICTED','PUBLISHED') ORDER BY t.createdAt DESC LIMIT 20",
                (rs, n) -> new TaskRow(rs.getString("taskId"), rs.getString("status"), rs.getString("runStatus"),
                        rs.getString("stopReason"), rs.getObject("callCount") == null ? 0 : rs.getInt("callCount"),
                        instant(rs.getTimestamp("createdAt"))));
    }

    /**
     * Starts one run on a worker thread; the page polls {@link #trace(String)}. The coordinator itself refuses
     * tasks that already have a run, so a repeated click is reported, not re-executed.
     */
    public void trigger(String taskId) {
        Integer tasks = jdbc.queryForObject("SELECT COUNT(*) FROM t_diagnosis_task WHERE taskId=?", Integer.class, taskId);
        if (tasks == null || tasks == 0) throw new BusinessException(ErrorCode.NOT_FOUND_ERROR);
        if (!busy.compareAndSet(false, true)) throw new Busy();
        try {
            worker.execute(() -> {
                try { coordinator.run(taskId); }
                catch (Exception e) { log.error("Manual patient draft run failed", e); }
                finally { busy.set(false); }
            });
        } catch (RuntimeException rejected) {
            busy.set(false);
            throw rejected;
        }
    }

    /**
     * Creates a synthetic task plus an eligible-looking controlled reference so the operator page has something
     * to run without the image pipeline. Rows are marked as synthetic in object key, title and source; the
     * reference is only inserted once per label so repeated seeding reuses it. Guarded by its own switch
     * ({@code eye-diagnosis.draft.test-entry.allow-seed}) because it writes into the configured database.
     */
    public String seed(long userId, String label) {
        String normalized = label == null ? "" : label.trim().toLowerCase(Locale.ROOT);
        if (!LABELS.contains(normalized)) throw new BusinessException(ErrorCode.PARAMS_ERROR);
        String taskId = UUID.randomUUID().toString();
        String objectKey = "draft-test/" + taskId + ".png";
        String digest = digest(taskId);
        var response = DiagnosisProto.DiagnosisResponse.newBuilder().setPredictedLabel(normalized).setProbability(70.0)
                .setOodStatus(DiagnosisProto.OodStatus.IN_DISTRIBUTION).setQualityScore(80)
                .setCalibrationStatus("NOT_CALIBRATED").setModelVersion("synthetic-draft-test")
                .setPreprocessVersion("synthetic-draft-test").build();
        String snapshot;
        try {
            snapshot = json.writeValueAsString(new LinkedHashMap<>(Map.of(
                    "taskId", taskId, "userId", userId, "objectKey", objectKey, "objectVersion", "v1",
                    "imageDigest", digest, "imageFormat", "png",
                    "responseProtobufBase64", Base64.getEncoder().encodeToString(response.toByteArray()))));
        } catch (Exception impossible) {
            throw new IllegalStateException(impossible);
        }
        jdbc.update("INSERT INTO t_diagnosis_task (taskId,userId,idempotencyKey,requestDigest,imageDigest,objectKey,objectVersion,"
                        + "imageFormat,status,inferenceSnapshot,createdAt,updatedAt) VALUES (?,?,?,?,?,?,'v1','png','WAITING_REVIEW',?,CURRENT_TIMESTAMP(6),CURRENT_TIMESTAMP(6))",
                taskId, userId, "draft-test:" + taskId, digest, digest, objectKey, snapshot);
        seedReference(normalized, userId);
        return taskId;
    }

    private void seedReference(String label, long userId) {
        String documentId = UUID.nameUUIDFromBytes(("draft-test:" + label).getBytes(StandardCharsets.UTF_8)).toString();
        if (!jdbc.queryForList("SELECT id FROM t_controlled_reference WHERE id=?", String.class, documentId).isEmpty()) return;
        // Source stays a short publisher-like label: real citations do not put prose here, and the explanation
        // model must quote the excerpt, not metadata (a long source line invites exactly that mistake).
        String source = "synthetic.invalid";
        jdbc.update("INSERT INTO t_controlled_reference (id,title,source,fileName,documentVersion,fileContent,isTest,visibility,"
                        + "reviewStatus,diseaseCodes,topicCodes,governanceVersion,uploadedBy,reviewedBy,reviewedAt) "
                        + "VALUES (?,?,?,'synthetic.txt',?,?,0,'CURATED_PUBLIC','APPROVED',JSON_ARRAY(?),JSON_ARRAY('PATIENT_EXPLANATION'),1,?,?,CURRENT_TIMESTAMP(6))",
                // Title and source stay short and label-like. Long prose here is quoted by the explanation model
                // as if it were an excerpt, which the citation contract then (correctly) rejects.
                documentId, "SYNTHETIC-" + label, source, digest(source), new byte[]{1},
                label.toUpperCase(Locale.ROOT), userId, userId);
        for (int index = 0; index < SEED_EXCERPTS.get(label).size(); index++) {
            String excerpt = SEED_EXCERPTS.get(label).get(index);
            jdbc.update("INSERT INTO t_controlled_reference_chunk VALUES (?,?,?,?)", documentId, index, excerpt, digest(excerpt));
        }
    }

    public Trace trace(String taskId) {        var runs = jdbc.query("SELECT status,stopReason,callCount,supplementCount,rewriteCount,startedAt,deadlineAt "
                        + "FROM t_patient_draft_run WHERE taskId=?",
                (rs, n) -> new RunRow(rs.getString(1), rs.getString(2), rs.getInt(3), rs.getInt(4), rs.getInt(5),
                        instant(rs.getTimestamp(6)), instant(rs.getTimestamp(7))), taskId);
        var statuses = jdbc.queryForList("SELECT status FROM t_diagnosis_task WHERE taskId=?", String.class, taskId);
        if (statuses.isEmpty()) throw new BusinessException(ErrorCode.NOT_FOUND_ERROR);
        String taskStatus = statuses.getFirst();
        if (runs.isEmpty()) {
            return new Trace(taskId, taskStatus, null, null, 0, 0, 0, null, null, null, predictedLabel(taskId),
                    List.of(), List.of(), List.of(), coordinator.budget(), null);
        }
        var run = runs.getFirst();
        var report = coordinator.inspect(taskId);
        Map<Integer, List<Citation>> evidenceByVersion = new HashMap<>();
        List<EvidenceView> evidence = new ArrayList<>();
        for (var frozen : report.evidence()) {
            evidenceByVersion.put(frozen.version(), frozen.citations());
            var sources = new ArrayList<CitationSource>();
            for (int i = 0; i < frozen.citations().size(); i++) {
                var citation = frozen.citations().get(i);
                sources.add(new CitationSource(i, citation.title(), citation.source(), citation.chunkIndex(), citation.excerpt()));
            }
            evidence.add(new EvidenceView(frozen.version(), sources));
        }
        Instant lastCompletion = report.messages().stream().map(PatientDraftCoordinator.Message::completedAt)
                .filter(Objects::nonNull).max(Comparator.naturalOrder()).orElse(null);
        Instant finishedAt = "RUNNING".equals(run.status()) ? Instant.now() : lastCompletion;
        Long elapsed = run.startedAt() == null || finishedAt == null ? null
                : Math.max(0, java.time.Duration.between(run.startedAt(), finishedAt).toMillis());
        return new Trace(taskId, taskStatus, run.status(), run.stopReason(), run.calls(), run.supplements(), run.rewrites(),
                run.startedAt(), run.deadlineAt(), elapsed, predictedLabel(taskId),
                report.messages().stream().map(message -> new RoleRow(message.sequence(), message.role(), message.state(),
                        message.startedAt(), message.completedAt(),
                        message.startedAt() == null || message.completedAt() == null ? null
                                : Math.max(0, java.time.Duration.between(message.startedAt(), message.completedAt()).toMillis()),
                        hasResult(message.output()), part(message.output(), "context"),
                        part(message.output(), "result"), part(message.output(), "collaboration"))).toList(),
                evidence,
                attempts(report.messages(), report.drafts(), evidenceByVersion),
                coordinator.budget(), report.workflowVersion());
    }

    /** Every Explanation output the provider returned, including the ones validation rejected before saving. */
    private List<DraftAttempt> attempts(List<PatientDraftCoordinator.Message> messages, List<Draft> saved,
                                        Map<Integer, List<Citation>> evidenceByVersion) {
        var attempts = new ArrayList<DraftAttempt>();
        for (var message : messages) {
            if (!"EXPLANATION".equals(message.role()) || message.output() == null) continue;
            Draft draft = parseDraft(message.output());
            if (draft == null) continue;
            var citations = evidenceByVersion.getOrDefault(draft.evidenceVersion(), List.of());
            var sections = new LinkedHashSet<String>();
            var claims = new ArrayList<ClaimCheck>();
            for (Claim claim : draft.claims() == null ? List.<Claim>of() : draft.claims()) {
                if (claim == null) continue;
                sections.add(claim.section());
                var references = new ArrayList<ReferenceCheck>();
                for (Reference reference : claim.references() == null ? List.<Reference>of() : claim.references()) {
                    if (reference == null) continue;
                    boolean matched = reference.citationIndex() >= 0 && reference.citationIndex() < citations.size()
                            && citations.get(reference.citationIndex()).excerpt() != null
                            && citations.get(reference.citationIndex()).excerpt().contains(reference.quote());
                    references.add(new ReferenceCheck(reference.citationIndex(), matched, reference.quote()));
                }
                claims.add(new ClaimCheck(claim.id(), claim.section(), claim.text(), references));
            }
            var missing = new TreeSet<>(PatientDraftCoordinator.requiredSections());
            missing.removeAll(sections);
            attempts.add(new DraftAttempt(message.sequence(), saved.contains(draft), draft.evidenceVersion(),
                    missing.isEmpty(), List.copyOf(missing), claims));
        }
        return attempts;
    }

    private boolean hasResult(String output) {
        return part(output, "result") != null;
    }

    /**
     * The coordinator stores {@code {context, result}} per role message. Both halves are already non-identifying
     * (the inference digest and clinical summary, never the snapshot, object key or patient), so the operator can
     * see what each agent received and produced. Returns null for roles that stopped before producing a result.
     */
    private Object part(String output, String field) {
        if (output == null) return null;
        try {
            JsonNode node = json.readTree(output).path(field);
            return node.isMissingNode() || node.isNull() ? null : json.treeToValue(node, Object.class);
        } catch (Exception unreadable) {
            return null;
        }
    }

    private Draft parseDraft(String output) {
        try {
            JsonNode result = json.readTree(output).path("result");
            return result.isMissingNode() || result.isNull() ? null : json.treeToValue(result, Draft.class);
        } catch (Exception unparseable) {
            // The model answered with something that is not a draft at all; the message state already records that.
            return null;
        }
    }

    private String predictedLabel(String taskId) {
        try {
            String snapshot = jdbc.queryForObject("SELECT inferenceSnapshot FROM t_diagnosis_task WHERE taskId=?", String.class, taskId);
            var response = DiagnosisProto.DiagnosisResponse.parseFrom(Base64.getDecoder()
                    .decode(json.readTree(snapshot).path("responseProtobufBase64").asText()));
            return response.getPredictedLabel();
        } catch (Exception unreadable) {
            return null;
        }
    }

    private static Instant instant(java.sql.Timestamp value) { return value == null ? null : value.toInstant(); }

    private static String digest(String value) {
        try {
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(value.getBytes(StandardCharsets.UTF_8)));
        } catch (Exception impossible) {
            throw new IllegalStateException(impossible);
        }
    }

    public record TaskRow(String taskId, String status, String runStatus, String stopReason, int calls, Instant createdAt) {}
    public record RoleRow(int sequence, String role, String state, Instant startedAt, Instant completedAt, Long elapsedMs,
                          boolean hasResult, Object context, Object result, Object collaboration) {}
    public record ReferenceCheck(int citationIndex, boolean matched, String quote) {}
    public record ClaimCheck(String id, String section, String text, List<ReferenceCheck> references) {}
    public record DraftAttempt(int sequence, boolean saved, int evidenceVersion, boolean allSectionsPresent,
                               List<String> missingSections, List<ClaimCheck> claims) {}
    public record CitationSource(int index, String title, String source, int chunkIndex, String excerpt) {}
    public record EvidenceView(int version, List<CitationSource> citations) {}
    public record Trace(String taskId, String taskStatus, String status, String stopReason, int calls, int supplements,
                        int rewrites, Instant startedAt, Instant deadlineAt, Long elapsedMs, String predictedLabel,
                        List<RoleRow> roles, List<EvidenceView> evidence, List<DraftAttempt> attempts,
                        PatientDraftCoordinator.Budget budget, String workflowVersion) {}
    private record RunRow(String status, String stopReason, int calls, int supplements, int rewrites,
                          Instant startedAt, Instant deadlineAt) {}

    /** One run at a time: the coordinator's budget is per task, but a shared worker keeps timings interpretable. */
    public static class Busy extends RuntimeException {
        public Busy() { super("已有一个手动测试任务在执行，请等待完成"); }
    }

    @Override @jakarta.annotation.PreDestroy
    public void close() { worker.shutdownNow(); }
}
