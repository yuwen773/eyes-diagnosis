package com.csust.eyediagnosis.workflow.explanation;

import com.csust.eyediagnosis.workflow.contract.PatientPredictionProjection;
import com.csust.eyediagnosis.workflow.domain.ExplanationPublicationStatus;
import com.csust.eyediagnosis.workflow.evidence.CitationIds;
import com.csust.eyediagnosis.workflow.evidence.DiagnosisCitationSnapshot;
import com.csust.eyediagnosis.workflow.risk.ClinicalRiskFinalResult;
import com.csust.eyediagnosis.workflow.risk.PublicationRiskDisposition;
import org.junit.jupiter.api.Test;
import java.util.List;
import java.util.Set;
import static org.junit.jupiter.api.Assertions.*;

class ExplanationGovernanceTest {
    private final DiagnosisCitationSnapshot citation = new DiagnosisCitationSnapshot("wf", 1, "source", "r1", "chunk", "title", "quoted evidence", "digest", Set.of("GLAUCOMA"), Set.of("IMAGE_DISEASE_RISK_FOLLOW"), .9, "retrieval-v1", "catalog-v1");
    private final PatientPredictionProjection prediction = new PatientPredictionProjection("GLAUCOMA", .8);
    @Test void validatorAcceptsBoundedCitedClaimAndRejectsUnsafeContent() {
        String id = CitationIds.forSnapshot(citation);
        ExplanationDraft valid = new ExplanationDraft("summary", List.of(new ExplanationClaim("c1", ExplanationClaimType.GENERAL_DISEASE_INFORMATION, "GLAUCOMA information", Set.of(id))), "not a diagnosis", "model", "prompt", "policy");
        DeterministicExplanationClaimValidator validator = new DeterministicExplanationClaimValidator();
        assertEquals(ExplanationValidationStatus.VALIDATED, validator.validate(valid, List.of(citation), prediction).status());
        ExplanationDraft unsafe = new ExplanationDraft("summary", List.of(new ExplanationClaim("c1", ExplanationClaimType.GENERAL_DISEASE_INFORMATION, "You have confirmed diagnosis. Take 5 mg medication.", Set.of(id))), "notice", "model", "prompt", "policy");
        ExplanationClaimValidationResult result = validator.validate(unsafe, List.of(citation), prediction);
        assertEquals(ExplanationValidationStatus.REJECTED, result.status());
        assertTrue(result.issues().stream().anyMatch(issue -> issue.code() == ExplanationValidationIssueCode.PROHIBITED_DIAGNOSIS_CERTAINTY));
        assertTrue(result.issues().stream().anyMatch(issue -> issue.code() == ExplanationValidationIssueCode.PROHIBITED_TREATMENT_ADVICE));
    }
    @Test void publicationGuardDoesNotPublishUnvalidatedOrLimitedResults() {
        ExplanationPublicationGuard guard = new ExplanationPublicationGuard();
        ExplanationClaimValidationResult pass = new ExplanationClaimValidationResult(ExplanationValidationStatus.VALIDATED, List.of(), "v1");
        assertEquals(ExplanationPublicationDecision.PUBLISH, guard.decide(new ClinicalRiskFinalResult(PublicationRiskDisposition.AUTO_PUBLICATION_ELIGIBLE, "risk"), ExplanationPublicationStatus.VALIDATED, pass, true));
        assertEquals(ExplanationPublicationDecision.FINAL_REVIEW_REQUIRED, guard.decide(new ClinicalRiskFinalResult(PublicationRiskDisposition.FINAL_REVIEW_REQUIRED, "risk"), ExplanationPublicationStatus.VALIDATED, pass, true));
        assertEquals(ExplanationPublicationDecision.COMPLETE_LIMITED, guard.decide(new ClinicalRiskFinalResult(PublicationRiskDisposition.LIMITED_EVIDENCE, "risk"), ExplanationPublicationStatus.WITHHELD, pass, false));
        assertEquals(ExplanationPublicationDecision.WITHHOLD, guard.decide(new ClinicalRiskFinalResult(PublicationRiskDisposition.AUTO_PUBLICATION_ELIGIBLE, "risk"), ExplanationPublicationStatus.DRAFT, pass, true));
    }
}
