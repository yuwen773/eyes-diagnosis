package com.csust.eyediagnosis.patientexplanation;

import com.csust.eyediagnosis.doctorreview.DoctorReviewService;
import com.csust.eyediagnosis.exception.BusinessException;
import com.csust.eyediagnosis.exception.ErrorCode;
import com.csust.eyediagnosis.patientdraft.DraftAgents;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

import java.util.List;

/** Whitelisted patient information only. Never return the doctor's frozen Materials object. */
@Service
public class PatientExplanationService {
    private final JdbcTemplate jdbc;
    private final DoctorReviewService reviews;
    private final ObjectMapper json = new ObjectMapper().findAndRegisterModules();

    public PatientExplanationService(JdbcTemplate jdbc, DoctorReviewService reviews) {
        this.jdbc = jdbc; this.reviews = reviews;
    }

    public record Source(int citationIndex, String title, String source, String documentVersion, long governanceVersion, String excerpt) {}
    public record Result(List<DraftAgents.Claim> claims, List<Source> sources, String disclaimer, String modelVersion,
                         String preprocessVersion, String calibrationNotice) {}
    public record View(String taskId, String status, String stage, String message, List<String> workNotes, Result result) {}

    public View view(String id, long owner) {
        var approved = reviews.approvedForPatient(id, owner);
        var rows = jdbc.queryForList("SELECT taskId,status FROM t_diagnosis_task WHERE taskId=? AND userId=?", id, owner);
        if (rows.isEmpty()) throw new BusinessException(ErrorCode.NOT_FOUND_ERROR);
        var task = rows.getFirst();
        String taskId = (String) task.get("taskId");
        if (approved != null) {
            return new View(taskId, "AVAILABLE", "RESULT", "已通过医生复核及本次读取门禁。", List.of("分层解释已完成复核。"),
                    result(approved));
        }
        return switch ((String) task.get("status")) {
            case "PENDING" -> new View(taskId, "PROCESSING", "QUEUED", "任务已登记，等待图像分析。", List.of(), null);
            case "RUNNING" -> new View(taskId, "PROCESSING", "IMAGE_ANALYSIS", "正在进行图像分析。", List.of(), null);
            case "DRAFTING" -> new View(taskId, "PROCESSING", "COLLABORATION", "正在整理供复核的说明。", workNotes(taskId), null);
            case "WAITING_REVIEW" -> waitingView(taskId);
            default -> new View(taskId, "RESTRICTED", "RESTRICTED", restrictedMessage(taskId), List.of(), null);
        };
    }

    public static Result result(DoctorReviewService.Approved approved) {
        return new Result(approved.draft().claims(), java.util.stream.IntStream.range(0, approved.materials().evidence().size()).mapToObj(index -> {
                        var citation = approved.materials().evidence().get(index);
                        return new Source(index, citation.title(), citation.source(), citation.documentVersion(), citation.governanceVersion(), citation.excerpt());
                    }).toList(), "模型预测并非确诊；请结合眼科医生的临床检查判断。", approved.inference().getModelVersion(),
                            approved.inference().getPreprocessVersion(), "模型概率不代表临床可靠性；请结合下方不确定性和适用限制阅读。");
    }

    private View waitingView(String taskId) {
        var runs = jdbc.queryForList("SELECT status FROM t_patient_draft_run WHERE taskId=?", String.class, taskId);
        if (runs.isEmpty()) return new View(taskId, "PROCESSING", "COLLABORATION", "图像分析已完成，等待协作整理供复核的说明。", List.of(), null);
        return switch (runs.getFirst()) {
            case "RUNNING" -> new View(taskId, "PROCESSING", "COLLABORATION", "正在整理供复核的说明。", workNotes(taskId), null);
            case "REVIEW_READY" -> new View(taskId, "WAITING_REVIEW", "DOCTOR_REVIEW", "结果尚未获准展示，请等待医生复核。", List.of("正在等待复核与安全检查，不会自动批准。"), null);
            default -> new View(taskId, "RESTRICTED", "RESTRICTED", restrictedMessage(taskId), List.of(), null);
        };
    }

    private String restrictedMessage(String taskId) {
        String snapshot = jdbc.queryForObject("SELECT inferenceSnapshot FROM t_diagnosis_task WHERE taskId=?", String.class, taskId);
        try {
            if (snapshot != null) {
                var response = com.csust.eyediagnosis.grpc.DiagnosisProto.DiagnosisResponse.parseFrom(java.util.Base64.getDecoder()
                        .decode(json.readTree(snapshot).path("responseProtobufBase64").asText()));
                if ("QUALITY_FAIL".equals(response.getAbstainReason())) return "图片质量未通过，请重新提交清晰的眼底图片，必要时咨询眼科医生。";
                if (response.getRejected() || response.getIsOod()) return "模型未接受本次输入，无法提供结果，请咨询眼科医生。";
            }
        } catch (java.io.IOException | IllegalArgumentException invalid) { /* Unknown snapshots use the fixed fallback. */ }
        var reasons = jdbc.queryForList("SELECT stopReason FROM t_patient_draft_run WHERE taskId=?", String.class, taskId);
        if (reasons.contains("INSUFFICIENT_EVIDENCE")) return "受控资料不足，暂无法提供解释，请咨询眼科医生。";
        return "本次分析暂无法提供结果，请咨询眼科医生或重新提交清晰图片。";
    }

    private List<String> workNotes(String taskId) {
        return jdbc.query("SELECT role,state FROM t_patient_draft_message WHERE taskId=? ORDER BY sequence", (rs, n) -> {
            String activity = switch (rs.getString(1)) {
                case "VISION" -> "图像分析信息整理";
                case "EVIDENCE" -> "受控资料检索";
                case "EXPLANATION" -> "分层说明整理";
                case "CRITIC" -> "一致性检查";
                default -> "";
            };
            String state = switch (rs.getString(2)) {
                case "STARTED" -> "正在处理。";
                case "COMPLETED" -> "已完成，仍须后续复核。";
                case "STOPPED" -> "已停止，请等待处理。";
                default -> "";
            };
            return activity.isEmpty() || state.isEmpty() ? "" : activity + state;
        }, taskId).stream().filter(note -> !note.isEmpty()).toList();
    }

    public Source citation(String id, long owner, int index) {
        View view = view(id, owner);
        if (view.result() == null || index < 0 || index >= view.result().sources().size()) throw new BusinessException(ErrorCode.NOT_FOUND_ERROR);
        return view.result().sources().get(index);
    }
}
