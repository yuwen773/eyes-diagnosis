package com.csust.eyediagnosis.patientfollowup;

import com.csust.eyediagnosis.agent.rag.Bm25Segmenter;
import com.csust.eyediagnosis.doctorreview.DoctorReviewService;
import com.csust.eyediagnosis.exception.BusinessException;
import com.csust.eyediagnosis.exception.ErrorCode;
import com.csust.eyediagnosis.patientdraft.DraftAgents;
import com.csust.eyediagnosis.patientexplanation.PatientExplanationService;
import org.springframework.stereotype.Service;

import java.util.HashSet;
import java.util.List;
import java.util.Set;

/** Extractive follow-up: approved patient statements only, with their original citations. */
@Service
public class PatientFollowUpService {
    private final DoctorReviewService reviews;
    private final Bm25Segmenter segmenter = new Bm25Segmenter();
    private static final Set<String> STOP_WORDS = Set.of("我的", "本次", "结果", "请问", "什么", "怎么", "如何", "是否", "可以", "the", "my", "is", "a", "what", "this");

    public PatientFollowUpService(DoctorReviewService reviews) { this.reviews = reviews; }

    public record Question(String question) {}
    public record Answer(String taskId, String status, String message, List<DraftAgents.Claim> claims,
                         List<PatientExplanationService.Source> sources) {}

    public Answer ask(String id, long owner, Question request) {
        if (request == null || request.question() == null || request.question().isBlank() || request.question().length() > 1000)
            throw new BusinessException(ErrorCode.PARAMS_ERROR, "请填写不超过1000字的追问");
        Answer answer = reviews.withApprovedForPatientReadOnly(id, owner, (review, approved) -> {
            var terms = new HashSet<>(segmenter.tokenize(request.question()));
            terms.removeAll(STOP_WORDS);
            var result = PatientExplanationService.result(approved);
            var matchedSources = new HashSet<Integer>();
            result.sources().stream().filter(source -> segmenter.tokenize(source.excerpt()).stream().anyMatch(terms::contains))
                    .forEach(source -> matchedSources.add(source.citationIndex()));
            var claims = result.claims().stream().filter(claim -> segmenter.tokenize(claim.text()).stream().anyMatch(terms::contains)
                    || claim.references().stream().anyMatch(reference -> matchedSources.contains(reference.citationIndex()))).toList();
            if (claims.isEmpty()) return new Answer(review.taskId(), "INSUFFICIENT_EVIDENCE",
                    "本次已发布内容及获准来源中未找到与问题匹配的依据，无法据此回答。请向眼科医生咨询；一般眼健康咨询请使用单独入口。", List.of(), List.of());
            var indices = new HashSet<Integer>();
            claims.forEach(claim -> claim.references().forEach(reference -> indices.add(reference.citationIndex())));
            return new Answer(review.taskId(), "RELATED_INFORMATION",
                    "以下仅为已发布的相关说明及原有依据，不构成新的诊断或对问题全部内容的回答。未覆盖的问题请咨询眼科医生。模型预测并非确诊。",
                    claims, result.sources().stream().filter(source -> indices.contains(source.citationIndex())).toList());
        });
        return answer != null ? answer : new Answer(id, "RESTRICTED", "本次结果尚未发布或当前读取条件不满足，无法追问。请重新查看任务进度或咨询眼科医生。", List.of(), List.of());
    }
}
