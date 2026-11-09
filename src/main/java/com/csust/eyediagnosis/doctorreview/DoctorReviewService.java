package com.csust.eyediagnosis.doctorreview;

import com.csust.eyediagnosis.controlledreference.ControlledEvidenceRetriever;
import com.csust.eyediagnosis.controlledreference.ControlledEvidenceRetriever.Citation;
import com.csust.eyediagnosis.exception.BusinessException;
import com.csust.eyediagnosis.exception.ErrorCode;
import com.csust.eyediagnosis.grpc.DiagnosisProto;
import com.csust.eyediagnosis.model.entity.User;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DataSourceTransactionManager;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionTemplate;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Instant;
import java.util.*;

/** Doctor authorization and frozen review decisions. Does not publish or save a diagnosis. */
@Service
public class DoctorReviewService {
    private final JdbcTemplate jdbc;
    private final ControlledEvidenceRetriever evidence;
    private final TransactionTemplate transactions;
    private final ObjectMapper json = new ObjectMapper().findAndRegisterModules();

    public DoctorReviewService(JdbcTemplate jdbc, ControlledEvidenceRetriever evidence) {
        this.jdbc = jdbc; this.evidence = evidence;
        transactions = new TransactionTemplate(new DataSourceTransactionManager(Objects.requireNonNull(jdbc.getDataSource())));
    }

    public record Summary(String reviewId, String taskId, String status, Instant assignedAt) {}
    public record Materials(String inferenceDigest, String inputDigest, String diseaseCode,
                            JsonNode draft, List<Citation> evidence, List<JsonNode> agentMessages) {}
    public record Detail(String reviewId, String taskId, long doctorId, long assignedBy, Instant assignedAt,
                         long taskVersion, int draftVersion, int evidenceVersion, String materialDigest,
                         Materials materials, String status, String note, Long decidedBy, Instant decidedAt) {}
    public record Decision(Long expectedTaskVersion, Integer expectedDraftVersion, Integer expectedEvidenceVersion,
                           String expectedMaterialDigest, String decision, String note) {}
    private record Frozen(String taskId, long owner, long version, int draftVersion, int evidenceVersion, Materials materials) {}

    public Detail assign(User admin, String taskId, Long doctorId) {
        requireRole(admin, "admin");
        if (taskId == null || taskId.isBlank() || taskId.length() > 36 || doctorId == null) throw new BusinessException(ErrorCode.PARAMS_ERROR);
        var frozen = freeze(taskId);
        return evidence.withValidatedEvidence(frozen.materials().diseaseCode(), "PATIENT_EXPLANATION", frozen.materials().evidence(), () -> transactions.execute(tx -> {
            lockTask(frozen.taskId());
            Frozen current = freeze(frozen.taskId());
            if (!current.equals(frozen)) throw new ReviewConflict("任务材料已变化，请重新分配");
            var doctors = jdbc.queryForList("SELECT id FROM t_user WHERE id=? AND BINARY userRole=BINARY 'doctor' AND isDelete=0 FOR UPDATE", doctorId);
            if (doctors.size() != 1 || doctorId == current.owner()) throw new BusinessException(ErrorCode.NO_AUTH_ERROR, "须分配给非患者本人的医生");
            var existing = jdbc.query("SELECT * FROM t_doctor_review WHERE taskId=? FOR UPDATE", this::map, current.taskId());
            if (!existing.isEmpty()) {
                if (existing.getFirst().doctorId() != doctorId) throw new ReviewConflict("任务已分配，不能覆盖原授权");
                return existing.getFirst();
            }
            String id = UUID.randomUUID().toString();
            jdbc.update("INSERT INTO t_doctor_review (reviewId,taskId,doctorId,assignedBy,taskVersion,draftVersion,evidenceVersion,materialDigest,materials) VALUES (?,?,?,?,?,?,?,?,?)",
                    id, current.taskId(), doctorId, admin.getId(), current.version(), current.draftVersion(), current.evidenceVersion(), digest(encode(current.materials())), encode(current.materials()));
            return find(id);
        }));
    }

    public List<Summary> list(User doctor) {
        requireRole(doctor, "doctor");
        return jdbc.query("SELECT r.reviewId,r.taskId,r.status,r.assignedAt FROM t_doctor_review r JOIN t_diagnosis_task t ON t.taskId=r.taskId WHERE r.doctorId=? AND t.userId<>? ORDER BY r.assignedAt DESC,r.reviewId DESC LIMIT 50",
                (rs, n) -> new Summary(rs.getString(1), rs.getString(2), rs.getString(3), rs.getTimestamp(4).toInstant()), doctor.getId(), doctor.getId());
    }

    public Detail detail(User doctor, String id) {
        requireRole(doctor, "doctor");
        Detail review = find(id);
        authorize(doctor, review);
        return review;
    }

    public Detail decide(User doctor, String id, Decision decision) {
        Detail review = detail(doctor, id);
        validate(decision);
        match(review, decision);
        if (!"PENDING".equals(review.status())) return replay(review, decision);
        Detail result;
        try {
            result = "REJECTED".equals(decision.decision())
                    ? transactions.execute(tx -> submit(doctor, review.taskId(), id, decision))
                    : evidence.withValidatedEvidence(review.materials().diseaseCode(), "PATIENT_EXPLANATION", review.materials().evidence(),
                        () -> transactions.execute(tx -> submit(doctor, review.taskId(), id, decision)));
        } catch (ControlledEvidenceRetriever.EvidenceUnavailable unavailable) {
            result = transactions.execute(tx -> {
                lockTask(review.taskId());
                Detail current = locked(id);
                authorize(doctor, current);
                if (!"PENDING".equals(current.status())) return replay(current, decision);
                return invalidate(current, "SOURCE_INVALIDATED");
            });
        }
        if ("INVALIDATED".equals(result.status())) throw new ReviewConflict("冻结材料或来源已失效，禁止批准");
        return result;
    }

    private Detail submit(User doctor, String taskId, String id, Decision decision) {
        lockTask(taskId);
        Detail review = locked(id);
        authorize(doctor, review);
        match(review, decision);
        if (!"PENDING".equals(review.status())) return replay(review, decision);
        Frozen current;
        try { current = freeze(review.taskId()); }
        catch (ReviewConflict conflict) { return invalidate(review, "TASK_CHANGED"); }
        if (current.version() != review.taskVersion() || current.draftVersion() != review.draftVersion()
                || current.evidenceVersion() != review.evidenceVersion() || !digest(encode(current.materials())).equals(review.materialDigest()))
            return invalidate(review, "MATERIALS_CHANGED");
        jdbc.update("UPDATE t_doctor_review SET status=?,note=?,decidedBy=?,decidedAt=CURRENT_TIMESTAMP(6) WHERE reviewId=? AND status='PENDING'",
                decision.decision(), decision.note().trim(), doctor.getId(), id);
        jdbc.update("UPDATE t_diagnosis_task SET status=?,version=version+1,updatedAt=CURRENT_TIMESTAMP(6) WHERE taskId=?",
                "REJECTED".equals(decision.decision()) ? "RESTRICTED" : "WAITING_REVIEW", review.taskId());
        return find(id);
    }

    private Detail invalidate(Detail review, String reason) {
        jdbc.update("UPDATE t_doctor_review SET status='INVALIDATED',note=? WHERE reviewId=? AND status='PENDING'", reason, review.reviewId());
        jdbc.update("UPDATE t_diagnosis_task SET status='RESTRICTED',version=version+1,updatedAt=CURRENT_TIMESTAMP(6) WHERE taskId=?", review.taskId());
        return find(review.reviewId());
    }

    private Detail replay(Detail review, Decision decision) {
        if (!review.status().equals(decision.decision()) || !review.note().equals(decision.note().trim()))
            throw new ReviewConflict("已有决定不可覆盖，请刷新复核记录");
        return review;
    }

    private void match(Detail review, Decision decision) {
        if (!Objects.equals(decision.expectedTaskVersion(), review.taskVersion()) || !Objects.equals(decision.expectedDraftVersion(), review.draftVersion())
                || !Objects.equals(decision.expectedEvidenceVersion(), review.evidenceVersion()) || !Objects.equals(decision.expectedMaterialDigest(), review.materialDigest()))
            throw new ReviewConflict("提交版本与显示版本不符，请重新打开任务");
    }

    private void validate(Decision decision) {
        if (decision == null || !Set.of("APPROVED", "REJECTED").contains(Objects.toString(decision.decision(), ""))
                || decision.note() == null || decision.note().isBlank() || decision.note().length() > 2000)
            throw new BusinessException(ErrorCode.PARAMS_ERROR, "请选择决定并填写复核意见");
    }

    private Frozen freeze(String requestedId) {
        // Current reads are essential: a waiter must observe writes committed before acquiring these locks.
        var tasks = jdbc.queryForList("SELECT * FROM t_diagnosis_task WHERE taskId=? FOR UPDATE", requestedId);
        if (tasks.isEmpty()) throw new BusinessException(ErrorCode.NOT_FOUND_ERROR);
        var task = tasks.getFirst();
        String id = (String) task.get("taskId");
        var runs = jdbc.queryForList("SELECT * FROM t_patient_draft_run WHERE taskId=? FOR UPDATE", id);
        if (!"WAITING_REVIEW".equals(task.get("status")) || runs.size() != 1 || !"REVIEW_READY".equals(runs.getFirst().get("status")))
            throw new ReviewConflict("草稿尚不可复核");
        String snapshot = Objects.toString(task.get("inferenceSnapshot"), "");
        String inferenceDigest = digest(snapshot);
        if (!inferenceDigest.equals(runs.getFirst().get("inferenceDigest"))) throw new ReviewConflict("推理快照已变化");
        var drafts = jdbc.queryForList("SELECT version,evidenceVersion,draft FROM t_patient_draft_version WHERE taskId=? ORDER BY version DESC LIMIT 1 FOR UPDATE", id);
        if (drafts.isEmpty()) throw new ReviewConflict("缺少冻结草稿");
        var draft = drafts.getFirst();
        int evidenceVersion = ((Number) draft.get("evidenceVersion")).intValue();
        var citations = jdbc.query("SELECT citations FROM t_patient_evidence_version WHERE taskId=? AND version=? FOR UPDATE",
                (rs, n) -> decode(rs.getString(1), new TypeReference<List<Citation>>() {}), id, evidenceVersion);
        if (citations.size() != 1) throw new ReviewConflict("缺少冻结证据");
        List<JsonNode> messages = jdbc.query("SELECT sequence,role,state,output FROM t_patient_draft_message WHERE taskId=? ORDER BY sequence FOR UPDATE",
                (rs, n) -> json.valueToTree(new TreeMap<>(Map.of("sequence", rs.getInt(1), "role", rs.getString(2), "state", rs.getString(3), "output", tree(rs.getString(4))))), id);
        var input = new TreeMap<String, Object>();
        for (String key : List.of("userId", "requestDigest", "imageDigest", "objectKey", "objectVersion", "imageFormat")) input.put(key, task.get(key));
        String disease;
        try {
            var response = DiagnosisProto.DiagnosisResponse.parseFrom(Base64.getDecoder().decode(tree(snapshot).path("responseProtobufBase64").asText()));
            disease = response.getPredictedLabel().toUpperCase(Locale.ROOT);
        } catch (Exception e) { throw new ReviewConflict("推理快照无效"); }
        return new Frozen(id, ((Number) task.get("userId")).longValue(), ((Number) task.get("version")).longValue(),
                ((Number) draft.get("version")).intValue(), evidenceVersion,
                new Materials(inferenceDigest, digest(encode(input)), disease, tree((String) draft.get("draft")), citations.getFirst(), messages));
    }

    private void authorize(User doctor, Detail review) {
        requireRole(doctor, "doctor");
        Long owner = jdbc.queryForObject("SELECT userId FROM t_diagnosis_task WHERE taskId=?", Long.class, review.taskId());
        if (review.doctorId() != doctor.getId() || Objects.equals(owner, doctor.getId())) throw new BusinessException(ErrorCode.NO_AUTH_ERROR);
    }

    private void requireRole(User actor, String role) {
        if (actor == null || actor.getId() == null || !role.equals(actor.getUserRole())) throw new BusinessException(ErrorCode.NO_AUTH_ERROR);
    }

    private void lockTask(String taskId) { jdbc.queryForList("SELECT taskId FROM t_diagnosis_task WHERE taskId=? FOR UPDATE", taskId); }
    private Detail locked(String id) { return jdbc.query("SELECT * FROM t_doctor_review WHERE reviewId=? FOR UPDATE", this::map, id).getFirst(); }
    private Detail find(String id) {
        var reviews = jdbc.query("SELECT * FROM t_doctor_review WHERE reviewId=?", this::map, id);
        if (reviews.isEmpty()) throw new BusinessException(ErrorCode.NOT_FOUND_ERROR);
        return reviews.getFirst();
    }
    private Detail map(ResultSet rs, int row) throws SQLException {
        var decidedAt = rs.getTimestamp("decidedAt");
        return new Detail(rs.getString("reviewId"), rs.getString("taskId"), rs.getLong("doctorId"), rs.getLong("assignedBy"), rs.getTimestamp("assignedAt").toInstant(),
                rs.getLong("taskVersion"), rs.getInt("draftVersion"), rs.getInt("evidenceVersion"), rs.getString("materialDigest"),
                decode(rs.getString("materials"), new TypeReference<Materials>() {}), rs.getString("status"), rs.getString("note"), rs.getObject("decidedBy", Long.class), decidedAt == null ? null : decidedAt.toInstant());
    }
    private String encode(Object value) { try { return json.writeValueAsString(value); } catch (Exception e) { throw new IllegalStateException(e); } }
    private <T> T decode(String value, TypeReference<T> type) { try { return json.readValue(value, type); } catch (Exception e) { throw new IllegalStateException(e); } }
    private JsonNode tree(String value) { try { return json.readTree(value); } catch (Exception e) { throw new IllegalStateException(e); } }
    private static String digest(String value) {
        try { return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(value.getBytes(StandardCharsets.UTF_8))); }
        catch (Exception e) { throw new IllegalStateException(e); }
    }
    public static class ReviewConflict extends RuntimeException { public ReviewConflict(String message) { super(message); } }
}
