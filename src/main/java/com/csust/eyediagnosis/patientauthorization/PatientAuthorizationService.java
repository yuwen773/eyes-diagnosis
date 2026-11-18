package com.csust.eyediagnosis.patientauthorization;

import com.baomidou.mybatisplus.core.toolkit.IdWorker;
import com.csust.eyediagnosis.doctorreview.DoctorReviewService;
import com.csust.eyediagnosis.exception.BusinessException;
import com.csust.eyediagnosis.exception.ErrorCode;
import com.csust.eyediagnosis.patientexplanation.PatientExplanationService;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DataSourceTransactionManager;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionTemplate;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.HexFormat;
import java.util.List;
import java.util.Objects;
import java.util.UUID;

/** Explicit patient save, independent of the doctor's decision and read permission. */
@Service
public class PatientAuthorizationService {
    private final JdbcTemplate jdbc;
    private final DoctorReviewService reviews;
    private final TransactionTemplate transactions;
    private final ObjectMapper json = new ObjectMapper().findAndRegisterModules();

    public PatientAuthorizationService(JdbcTemplate jdbc, DoctorReviewService reviews) {
        this.jdbc = jdbc; this.reviews = reviews;
        transactions = new TransactionTemplate(new DataSourceTransactionManager(Objects.requireNonNull(jdbc.getDataSource())));
    }

    public record Approval(String authorizationId, Long expectedTaskVersion, Integer expectedDraftVersion,
                           Integer expectedEvidenceVersion, String expectedContentDigest) {}
    public record Receipt(String receiptId, String taskId, long diagnosisId,
                          @com.fasterxml.jackson.annotation.JsonFormat(shape = com.fasterxml.jackson.annotation.JsonFormat.Shape.STRING) Instant authorizedAt, String contentDigest) {}
    public record Content(PatientExplanationService.Result explanation, String modelPrediction, double modelProbability) {}
    public record View(String taskId, String authorizationId, String status, long taskVersion, int draftVersion,
                       int evidenceVersion, String contentDigest,
                       @com.fasterxml.jackson.annotation.JsonFormat(shape = com.fasterxml.jackson.annotation.JsonFormat.Shape.STRING) Instant expiresAt,
                       Content content, Receipt receipt) {}
    private record Stored(View view, String materialDigest) {}

    public View view(String requestedId, long owner) {
        String id = owned(requestedId, owner);
        Stored previous = find(id, false);
        if (previous != null && !"OFFERED".equals(previous.view.status())) return previous.view;
        View result = reviews.withApprovedForPatient(id, owner, (review, approved) -> {
            Stored current = find(id, true);
            if (current != null) return checked(current, review, approved);
            String content = encode(content(approved));
            jdbc.update("INSERT INTO t_patient_authorization (taskId,authorizationId,userId,taskVersion,draftVersion,evidenceVersion,materialDigest,contentDigest,content,expiresAt) VALUES (?,?,?,?,?,?,?,?,?,DATE_ADD(UTC_TIMESTAMP(6),INTERVAL 30 MINUTE))",
                    id, UUID.randomUUID().toString(), owner, review.taskVersion() + 1, review.draftVersion(), review.evidenceVersion(),
                    review.materialDigest(), digest(content), content);
            return find(id, true).view;
        });
        if (result != null) return result;
        if (previous != null) return restrict(id, owner);
        throw new SaveConflict("内容尚未获准保存");
    }

    public View approve(String requestedId, long owner, Approval approval) {
        String id = owned(requestedId, owner);
        validate(approval);
        Stored previous = find(id, false);
        if (previous == null) throw new SaveConflict("请先查看拟保存内容");
        match(previous.view, approval);
        if ("APPROVED".equals(previous.view.status())) return previous.view;
        if (!"OFFERED".equals(previous.view.status())) throw new SaveConflict("授权内容已受限");
        View result = reviews.withApprovedForPatient(id, owner, (review, approved) -> {
            Stored current = find(id, true);
            match(current.view, approval);
            View checked = checked(current, review, approved);
            if (!"OFFERED".equals(checked.status())) return checked;
            long diagnosisId = IdWorker.getId();
            var inference = approved.inference();
            // Private object keys and internal review materials never become a public image URL or history text.
            jdbc.update("INSERT INTO t_diagnosis (id,url,userId,result,probability,confidence,details,humanReviewStatus,modelVersion,weightSha256,preprocessVersion,inferencePolicyVersion,calibrationStatus,calibratedProbability,qualityScore,oodStatus,oodScore,patientTaskId) VALUES (?,'',?,?,?,?,?,'AI_ONLY',?,?,?,?,?,?,?,?,?,?)",
                    diagnosisId, owner, checked.content().modelPrediction(), checked.content().modelProbability(), checked.content().modelProbability(),
                    "模型预测并非确诊；患者已授权保存本次辅助说明，完整冻结内容可追溯至任务回执。",
                    inference.getModelVersion(), inference.getWeightSha256(), inference.getPreprocessVersion(), inference.getInferencePolicyVersion(),
                    inference.getCalibrationStatus(), "CALIBRATED".equals(inference.getCalibrationStatus()) ? inference.getCalibratedProbability() : null,
                    inference.getQualityScore(), inference.getOodStatus().name(), inference.getOodScore(), id);
            jdbc.update("UPDATE t_patient_authorization SET status='APPROVED',diagnosisId=?,receiptId=?,authorizedAt=UTC_TIMESTAMP(6) WHERE taskId=?",
                    diagnosisId, UUID.randomUUID().toString(), id);
            return find(id, true).view;
        });
        if (result == null) result = restrict(id, owner);
        if (!"APPROVED".equals(result.status())) throw new SaveConflict("内容、有效期或来源已失效，禁止保存");
        return result;
    }

    private View checked(Stored stored, DoctorReviewService.Detail review, DoctorReviewService.Approved approved) {
        View view = stored.view;
        if (!"OFFERED".equals(view.status())) return view;
        boolean expired = Boolean.TRUE.equals(jdbc.queryForObject("SELECT expiresAt<=UTC_TIMESTAMP(6) FROM t_patient_authorization WHERE taskId=?", Boolean.class, view.taskId()));
        if (expired || view.taskVersion() != review.taskVersion() + 1 || view.draftVersion() != review.draftVersion()
                || view.evidenceVersion() != review.evidenceVersion() || !stored.materialDigest.equals(review.materialDigest())
                || !view.contentDigest().equals(digest(encode(view.content())))
                || !view.contentDigest().equals(digest(encode(content(approved))))) {
            restrictLocked(view.taskId());
            return find(view.taskId(), true).view;
        }
        return view;
    }

    private View restrict(String id, long owner) {
        return transactions.execute(tx -> {
            jdbc.queryForList("SELECT taskId FROM t_diagnosis_task WHERE taskId=? AND userId=? FOR UPDATE", id, owner);
            Stored current = find(id, true);
            if (current != null && "APPROVED".equals(current.view.status())) return current.view;
            restrictLocked(id);
            return find(id, true).view;
        });
    }

    private void restrictLocked(String id) {
        jdbc.update("UPDATE t_patient_authorization SET status='RESTRICTED' WHERE taskId=? AND status='OFFERED'", id);
        jdbc.update("UPDATE t_diagnosis_task SET status='RESTRICTED',version=version+1,updatedAt=CURRENT_TIMESTAMP(6) WHERE taskId=? AND BINARY status<>BINARY 'RESTRICTED'", id);
    }

    private String owned(String id, long owner) {
        var rows = jdbc.queryForList("SELECT taskId FROM t_diagnosis_task WHERE taskId=? AND userId=?", String.class, id, owner);
        if (rows.isEmpty()) throw new BusinessException(ErrorCode.NOT_FOUND_ERROR);
        return rows.getFirst();
    }

    private Stored find(String id, boolean lock) {
        List<Stored> rows = jdbc.query("SELECT * FROM t_patient_authorization WHERE taskId=?" + (lock ? " FOR UPDATE" : ""), this::map, id);
        return rows.isEmpty() ? null : rows.getFirst();
    }

    private Stored map(ResultSet rs, int row) throws SQLException {
        String state = rs.getString("status");
        String id = rs.getString("taskId");
        String contentDigest = rs.getString("contentDigest");
        var utc = java.util.Calendar.getInstance(java.util.TimeZone.getTimeZone("UTC"));
        Timestamp authorizedAt = rs.getTimestamp("authorizedAt", utc);
        try {
            var content = "OFFERED".equals(state) ? json.readValue(rs.getString("content"), Content.class) : null;
            Receipt receipt = "APPROVED".equals(state) ? new Receipt(rs.getString("receiptId"), id, rs.getLong("diagnosisId"), authorizedAt.toInstant(), contentDigest) : null;
            return new Stored(new View(id, rs.getString("authorizationId"), state, rs.getLong("taskVersion"), rs.getInt("draftVersion"),
                    rs.getInt("evidenceVersion"), contentDigest, rs.getTimestamp("expiresAt", utc).toInstant(), content, receipt), rs.getString("materialDigest"));
        } catch (java.io.IOException invalid) { throw new IllegalStateException(invalid); }
    }

    private void validate(Approval approval) {
        if (approval == null || approval.authorizationId() == null || approval.expectedTaskVersion() == null || approval.expectedDraftVersion() == null
                || approval.expectedEvidenceVersion() == null || approval.expectedContentDigest() == null)
            throw new BusinessException(ErrorCode.PARAMS_ERROR);
    }

    private void match(View view, Approval approval) {
        if (!view.authorizationId().equals(approval.authorizationId()) || view.taskVersion() != approval.expectedTaskVersion()
                || view.draftVersion() != approval.expectedDraftVersion() || view.evidenceVersion() != approval.expectedEvidenceVersion()
                || !view.contentDigest().equals(approval.expectedContentDigest())) throw new SaveConflict("提交内容与查看的授权版本不符");
    }

    private String encode(Object value) {
        try { return json.writeValueAsString(value); } catch (java.io.IOException invalid) { throw new IllegalStateException(invalid); }
    }
    private Content content(DoctorReviewService.Approved approved) {
        return new Content(PatientExplanationService.result(approved),
                com.csust.eyediagnosis.constant.DiagnosisCategoryEnum.getChineseLabelByEnglishLabel(approved.inference().getPredictedLabel()),
                approved.inference().getProbability());
    }
    private static String digest(String value) {
        try { return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(value.getBytes(StandardCharsets.UTF_8))); }
        catch (java.security.NoSuchAlgorithmException impossible) { throw new IllegalStateException(impossible); }
    }
    public static class SaveConflict extends RuntimeException { public SaveConflict(String message) { super(message); } }
}
