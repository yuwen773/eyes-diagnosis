package com.csust.eyediagnosis.service;

import com.csust.eyediagnosis.model.vo.diagnosis.DiagnosisSourceProjection;
import lombok.extern.slf4j.Slf4j;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

import java.util.List;
import java.util.Map;

/**
 * 只读地拼出「这条判读从哪来、谁授权保存、影像在哪」。
 *
 * <p>三条信息来源本来就在库里分开放着，报告页却一直在用一个字段猜另一件事：
 * 有公开 URL 就当影像已归档、状态是 REVIEWED 就当医生复核过。这里把它们分开读出来，
 * 读不出来就返回 UNKNOWN，而不是返回一个看起来干净的默认值。
 *
 * <p>**只读**：不接受任何写入参数，不修改状态机，不扩大任何人的可见范围——
 * 调用方必须先过归属校验（`getOwnedDiagnosis`）再调这里。
 */
@Slf4j
@Service
public class DiagnosisSourceProjectionService {

    private final JdbcTemplate jdbc;

    public DiagnosisSourceProjectionService(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    /**
     * @param diagnosisId  已经通过归属校验的记录 id
     * @param diagnosisUrl 该记录的影像地址（`t_diagnosis.url`），只用来判定归档状态
     */
    public DiagnosisSourceProjection project(long diagnosisId, String diagnosisUrl) {
        String taskId = firstString(
                "SELECT patientTaskId FROM t_diagnosis WHERE id = ?", diagnosisId);
        if (taskId == null || taskId.isBlank()) {
            // 患者自传影像的直接判读：没有草稿、没有授权、没有任务。这是正常的，不是缺失。
            return new DiagnosisSourceProjection(
                    DiagnosisSourceProjection.SOURCE_DIRECT,
                    null, null, null, null, null,
                    archivalState(diagnosisUrl, null));
        }

        Map<String, Object> review = firstRow(
                "SELECT status FROM t_doctor_review WHERE taskId = ? ORDER BY assignedAt DESC LIMIT 1", taskId);
        Map<String, Object> authorization = firstRow(
                "SELECT status, receiptId, authorizedAt FROM t_patient_authorization WHERE taskId = ?", taskId);
        String objectKey = firstString("SELECT objectKey FROM t_diagnosis_task WHERE taskId = ?", taskId);

        return new DiagnosisSourceProjection(
                DiagnosisSourceProjection.SOURCE_COLLABORATION_DRAFT,
                taskId,
                review == null ? null : asString(review.get("status")),
                authorization == null ? null : asString(authorization.get("status")),
                authorization == null ? null : asString(authorization.get("authorizedAt")),
                authorization == null ? null : maskReceipt(asString(authorization.get("receiptId"))),
                archivalState(diagnosisUrl, objectKey));
    }

    /**
     * 归档状态。
     *
     * <p>只根据**我们自己能确认的事实**判定：
     * 有地址 → 记录引用了一个可取用的影像；
     * 没地址但有对象键 → 影像归档了，但按隐私策略不公开（协作影像）；
     * 两者都没有 → 这张判读确实没留影像；
     * 查询本身失败 → UNKNOWN（不能把「查不到」说成「没有」）。
     *
     * <p>对象键存在并不能证明底层对象仍然存在（生命周期规则、人工清理都可能删掉它）。
     * 要在这上面给出 ARCHIVED 需要一次存储侧的存在性探测；本轮没有加，因此
     * `ARCHIVED_NOT_PUBLIC` 只陈述「按策略不给公开地址」，不陈述「对象一定能取回」。
     */
    private String archivalState(String url, String objectKey) {
        if (url != null && !url.isBlank()) {
            return DiagnosisSourceProjection.Archival.ARCHIVED;
        }
        if (objectKey != null && !objectKey.isBlank()) {
            return DiagnosisSourceProjection.Archival.ARCHIVED_NOT_PUBLIC;
        }
        return DiagnosisSourceProjection.Archival.NOT_ARCHIVED;
    }

    private String firstString(String sql, Object arg) {
        try {
            List<String> rows = jdbc.queryForList(sql, String.class, arg);
            if (rows.isEmpty()) {
                return null;
            }
            String value = rows.get(0);
            return value == null || value.isBlank() ? null : value;
        } catch (RuntimeException e) {
            // 读不出来就是不知道。调用方据此返回 UNKNOWN，而不是猜一个「没有」。
            log.warn("来源投影查询失败 sql 片段={}", sql.substring(0, Math.min(sql.length(), 40)), e);
            throw new ProjectionUnavailable(e);
        }
    }

    private Map<String, Object> firstRow(String sql, Object arg) {
        try {
            List<Map<String, Object>> rows = jdbc.queryForList(sql, arg);
            return rows.isEmpty() ? null : rows.get(0);
        } catch (RuntimeException e) {
            log.warn("来源投影查询失败 sql 片段={}", sql.substring(0, Math.min(sql.length(), 40)), e);
            throw new ProjectionUnavailable(e);
        }
    }

    /** 回执号只给前缀：完整回执对患者本人是否可见是产品决策，代码不替产品决定。 */
    static String maskReceipt(String receiptId) {
        if (receiptId == null || receiptId.isBlank()) {
            return null;
        }
        String trimmed = receiptId.trim();
        return trimmed.length() <= 8 ? trimmed : trimmed.substring(0, 8) + "…";
    }

    private static String asString(Object value) {
        return value == null ? null : String.valueOf(value);
    }

    /** 查询失败：调用方应把它翻译成 UNKNOWN，而不是让整个报告页 500。 */
    public static class ProjectionUnavailable extends RuntimeException {
        public ProjectionUnavailable(Throwable cause) {
            super("来源投影不可用", cause);
        }
    }
}
