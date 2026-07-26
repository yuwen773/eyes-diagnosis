package com.csust.eyediagnosis.workflow.risk;

import com.csust.eyediagnosis.workflow.domain.*;
import com.csust.eyediagnosis.workflow.evidence.EvidenceSufficiency;
import com.csust.eyediagnosis.workflow.evidence.EvidenceSufficiencyReasonCode;
import org.junit.jupiter.api.Test;
import java.util.Set;
import static org.junit.jupiter.api.Assertions.assertEquals;

class ClinicalRiskPolicyTest {
    private final DeterministicClinicalRiskPolicy policy = new DeterministicClinicalRiskPolicy();
    @Test void precheckRoutesOnlyFromControlledWorkflowState() {
        assertEquals(PublicationRiskDisposition.PROCEED_TO_EVIDENCE, policy.precheck(new ClinicalRiskPrecheckInput(InferenceOutcomeType.VALID_PREDICTION, PredictionExposureStatus.AVAILABLE, ImageQualityDecision.PASS, "fingerprint")).disposition());
        assertEquals(PublicationRiskDisposition.LIMITED_SAFETY_ABSTENTION, policy.precheck(new ClinicalRiskPrecheckInput(InferenceOutcomeType.SAFETY_ABSTENTION, PredictionExposureStatus.WITHHELD_BY_ABSTENTION, ImageQualityDecision.PASS, "fingerprint")).disposition());
        assertEquals(PublicationRiskDisposition.BLOCKED_TECHNICAL_FAILURE, policy.precheck(new ClinicalRiskPrecheckInput(InferenceOutcomeType.TECHNICAL_FAILURE, PredictionExposureStatus.NOT_AVAILABLE, ImageQualityDecision.PASS, "fingerprint")).disposition());
    }
    @Test void finalPolicyIsDeterministicAndFailsClosed() {
        EvidenceSufficiency sufficient = new EvidenceSufficiency(1, Set.of("D1"), Set.of("DISEASE"), true, EvidenceSufficiencyReasonCode.SUFFICIENT);
        ClinicalRiskFinalInput eligible = new ClinicalRiskFinalInput(InferenceOutcomeType.VALID_PREDICTION, PredictionExposureStatus.AVAILABLE, ImageQualityDecision.PASS, sufficient, true, false);
        assertEquals(PublicationRiskDisposition.AUTO_PUBLICATION_ELIGIBLE, policy.finalAssess(eligible).disposition());
        assertEquals(policy.finalAssess(eligible), policy.finalAssess(eligible));
        assertEquals(PublicationRiskDisposition.FINAL_REVIEW_REQUIRED, policy.finalAssess(new ClinicalRiskFinalInput(InferenceOutcomeType.VALID_PREDICTION, PredictionExposureStatus.AVAILABLE, ImageQualityDecision.PASS, sufficient, true, true)).disposition());
        assertEquals(PublicationRiskDisposition.WITHHOLD_UNSAFE, policy.finalAssess(new ClinicalRiskFinalInput(InferenceOutcomeType.VALID_PREDICTION, PredictionExposureStatus.AVAILABLE, ImageQualityDecision.PASS, sufficient, false, false)).disposition());
    }
}
