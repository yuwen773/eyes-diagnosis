package com.csust.eyediagnosis.workflow.explanation;

import com.csust.eyediagnosis.workflow.domain.ExplanationPublicationStatus;
import com.csust.eyediagnosis.workflow.risk.ClinicalRiskFinalResult;
import com.csust.eyediagnosis.workflow.risk.PublicationRiskDisposition;

/** Pure publication decision; graph routing and persistence remain outside this guard. */
public final class ExplanationPublicationGuard {
    public ExplanationPublicationDecision decide(ClinicalRiskFinalResult risk, ExplanationPublicationStatus snapshotStatus,
                                                ExplanationClaimValidationResult validation, boolean sufficientEvidence) {
        if (risk == null || snapshotStatus == null || validation == null) throw new IllegalArgumentException("publication input is incomplete");
        if (risk.disposition() == PublicationRiskDisposition.AUTO_PUBLICATION_ELIGIBLE && sufficientEvidence
                && snapshotStatus == ExplanationPublicationStatus.VALIDATED && validation.status() == ExplanationValidationStatus.VALIDATED) return ExplanationPublicationDecision.PUBLISH;
        if (risk.disposition() == PublicationRiskDisposition.FINAL_REVIEW_REQUIRED
                && snapshotStatus == ExplanationPublicationStatus.VALIDATED && validation.status() == ExplanationValidationStatus.VALIDATED) return ExplanationPublicationDecision.FINAL_REVIEW_REQUIRED;
        if (risk.disposition() == PublicationRiskDisposition.LIMITED_EVIDENCE
                && (snapshotStatus == ExplanationPublicationStatus.NONE || snapshotStatus == ExplanationPublicationStatus.REJECTED || snapshotStatus == ExplanationPublicationStatus.WITHHELD)) return ExplanationPublicationDecision.COMPLETE_LIMITED;
        return ExplanationPublicationDecision.WITHHOLD;
    }
}
