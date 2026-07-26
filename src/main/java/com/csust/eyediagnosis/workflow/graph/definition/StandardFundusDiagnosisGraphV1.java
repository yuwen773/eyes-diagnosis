package com.csust.eyediagnosis.workflow.graph.definition;

import com.csust.eyediagnosis.workflow.domain.SegmentCode;
import org.springframework.stereotype.Component;

import java.util.List;

/** V1 topology metadata only. Future graph compilation must consume this manifest rather than recreate its topology. */
@Component
public final class StandardFundusDiagnosisGraphV1 implements DiagnosisGraphDefinition {
    private final DiagnosisGraphDefinition definition;

    public StandardFundusDiagnosisGraphV1(GraphDefinitionHasher hasher) {
        definition = DiagnosisGraphDefinitionFactory.create(new GraphDefinitionManifest(
                "fundus-diagnosis", "fundus-diagnosis-v1", "diagnosis-actions-v1",
                List.of(
                        node("START", "BOUNDARY"), node("LocalImageValidation", "ACTION"), node("ImageInference", "ACTION"),
                        node("ImageQualityRoute", "ACTION"), node("ImageQualityHumanReview", "HUMAN_REVIEW"), node("QualityReviewDecision", "ACTION"),
                        node("VisionExposure", "ACTION"), node("ClinicalRiskPrecheck", "ACTION"), node("EvidenceRetrieval", "ACTION"),
                        node("RetrievalSourceValidation", "ACTION"), node("QueryRewrite", "ACTION"), node("ClinicalRiskFinal", "ACTION"),
                        node("ExplanationDraft", "ACTION"), node("ExplanationClaimValidation", "ACTION"), node("PublishValidatedExplanation", "PUBLICATION"),
                        node("FinalClinicalReview", "HUMAN_REVIEW"), node("FinalReviewDecision", "ACTION"), node("END", "BOUNDARY")),
                List.of(edge("START", "LocalImageValidation"), edge("LocalImageValidation", "ImageInference"), edge("ImageInference", "ImageQualityRoute"),
                        edge("ImageQualityHumanReview", "QualityReviewDecision"), edge("VisionExposure", "ClinicalRiskPrecheck"),
                        edge("EvidenceRetrieval", "RetrievalSourceValidation"), edge("QueryRewrite", "EvidenceRetrieval"), edge("ClinicalRiskFinal", "ExplanationDraft"),
                        edge("ExplanationDraft", "ExplanationClaimValidation"), edge("PublishValidatedExplanation", "FinalClinicalReview"), edge("FinalClinicalReview", "FinalReviewDecision")),
                List.of(conditional("ImageQualityRoute", "PASS", "VisionExposure"), conditional("ImageQualityRoute", "REVIEW", "ImageQualityHumanReview"), conditional("ImageQualityRoute", "REJECT", "END"),
                        conditional("QualityReviewDecision", "APPROVE_CONTINUE", "VisionExposure"), conditional("QualityReviewDecision", "REJECT_RESUBMIT", "END"),
                        conditional("ClinicalRiskPrecheck", "PUBLISH", "EvidenceRetrieval"), conditional("ClinicalRiskPrecheck", "LIMITED", "END"),
                        conditional("RetrievalSourceValidation", "INSUFFICIENT_REWRITE_ALLOWED", "QueryRewrite"), conditional("RetrievalSourceValidation", "ACCEPTED_OR_EXHAUSTED", "ClinicalRiskFinal"),
                        conditional("ClinicalRiskFinal", "FINAL_REVIEW_REQUIRED", "FinalClinicalReview"), conditional("ClinicalRiskFinal", "PUBLISH", "ExplanationDraft"),
                        conditional("ExplanationClaimValidation", "PUBLISH", "PublishValidatedExplanation"), conditional("ExplanationClaimValidation", "LIMITED", "END"),
                        conditional("FinalReviewDecision", "PUBLISH", "END"), conditional("FinalReviewDecision", "LIMITED", "END")),
                List.of(segment(SegmentCode.INTAKE_INFERENCE_QUALITY, "START", "ClinicalRiskPrecheck"),
                        segment(SegmentCode.QUALITY_REVIEW_RESUME, "QualityReviewDecision", "ClinicalRiskPrecheck"),
                        segment(SegmentCode.EVIDENCE_RETRIEVAL_VALIDATION, "EvidenceRetrieval", "RetrievalSourceValidation"),
                        segment(SegmentCode.FINAL_RISK_EXPLANATION, "ClinicalRiskFinal", "FinalClinicalReview"),
                        segment(SegmentCode.FINAL_CLINICAL_REVIEW_RESUME, "FinalReviewDecision", "END")),
                List.of("ImageQualityHumanReview", "FinalClinicalReview"), List.of("ClinicalRiskPrecheck", "RetrievalSourceValidation")), hasher);
    }

    @Override public String graphId() { return definition.graphId(); }
    @Override public String definitionVersion() { return definition.definitionVersion(); }
    @Override public String definitionHash() { return definition.definitionHash(); }
    @Override public String actionVersion() { return definition.actionVersion(); }
    @Override public GraphDefinitionManifest manifest() { return definition.manifest(); }

    private static GraphNodeSpec node(String code, String type) { return new GraphNodeSpec(code, type); }
    private static GraphEdgeSpec edge(String source, String target) { return new GraphEdgeSpec(source, target); }
    private static GraphConditionalEdgeSpec conditional(String source, String condition, String target) { return new GraphConditionalEdgeSpec(source, condition, target); }
    private static GraphSegmentSpec segment(SegmentCode code, String entry, String exit) { return new GraphSegmentSpec(code, entry, exit); }
}
