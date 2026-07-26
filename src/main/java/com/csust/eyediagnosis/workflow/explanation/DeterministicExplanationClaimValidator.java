package com.csust.eyediagnosis.workflow.explanation;

import com.csust.eyediagnosis.workflow.contract.PatientPredictionProjection;
import com.csust.eyediagnosis.workflow.evidence.CitationIds;
import com.csust.eyediagnosis.workflow.evidence.DiagnosisCitationSnapshot;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;

/** Conservative structural and policy validator; it performs no retrieval or model invocation. */
public final class DeterministicExplanationClaimValidator implements ExplanationClaimValidator {
    public static final String VERSION = "explanation-claim-validator-v1";

    @Override public ExplanationClaimValidationResult validate(ExplanationDraft draft, List<DiagnosisCitationSnapshot> citations,
                                                                PatientPredictionProjection prediction) {
        List<ExplanationValidationIssue> issues = new ArrayList<>();
        if (draft == null || citations == null || citations.isEmpty() || prediction == null) {
            return rejected(issues, ExplanationValidationIssueCode.INVALID_OUTPUT_STRUCTURE, null);
        }
        Set<String> ids = new HashSet<>(); Set<String> citationIds = new HashSet<>(); Set<String> diseases = new HashSet<>();
        for (DiagnosisCitationSnapshot citation : citations) { citationIds.add(CitationIds.forSnapshot(citation)); diseases.addAll(citation.diseaseCodes()); }
        diseases.add(prediction.diseaseCode());
        for (ExplanationClaim claim : draft.claims()) {
            if (!ids.add(claim.claimId())) issues.add(new ExplanationValidationIssue(ExplanationValidationIssueCode.INVALID_OUTPUT_STRUCTURE, claim.claimId()));
            boolean factual = claim.type() != ExplanationClaimType.LIMITATION_NOTICE;
            if (factual && claim.citationIds().isEmpty()) issues.add(new ExplanationValidationIssue(ExplanationValidationIssueCode.MISSING_CITATION, claim.claimId()));
            if (!citationIds.containsAll(claim.citationIds())) issues.add(new ExplanationValidationIssue(ExplanationValidationIssueCode.UNKNOWN_CITATION, claim.claimId()));
            if (!topicSupported(claim, citations)) issues.add(new ExplanationValidationIssue(ExplanationValidationIssueCode.UNSUPPORTED_CLAIM_TYPE, claim.claimId()));
            String text = claim.text().toLowerCase(Locale.ROOT);
            if (text.matches(".*\\d.*")) issues.add(new ExplanationValidationIssue(ExplanationValidationIssueCode.UNSUPPORTED_NUMERIC_CLAIM, claim.claimId()));
            if (containsAny(text, "confirmed diagnosis", "definitively", "you have", "确诊", "明确诊断")) issues.add(new ExplanationValidationIssue(ExplanationValidationIssueCode.PROHIBITED_DIAGNOSIS_CERTAINTY, claim.claimId()));
            if (containsAny(text, "mg", "medication", "prescribe", "surgery", "剂量", "处方", "手术")) issues.add(new ExplanationValidationIssue(ExplanationValidationIssueCode.PROHIBITED_TREATMENT_ADVICE, claim.claimId()));
            if (containsAny(text, "ignore previous", "system prompt", "chain of thought", "internal reasoning", "忽略之前", "系统提示")) issues.add(new ExplanationValidationIssue(ExplanationValidationIssueCode.PROMPT_INJECTION_ARTIFACT, claim.claimId()));
            if (mentionsUnacceptedDisease(text, diseases)) issues.add(new ExplanationValidationIssue(ExplanationValidationIssueCode.UNSUPPORTED_DISEASE_CLAIM, claim.claimId()));
        }
        return issues.isEmpty() ? new ExplanationClaimValidationResult(ExplanationValidationStatus.VALIDATED, List.of(), VERSION)
                : new ExplanationClaimValidationResult(ExplanationValidationStatus.REJECTED, issues, VERSION);
    }

    private static ExplanationClaimValidationResult rejected(List<ExplanationValidationIssue> issues, ExplanationValidationIssueCode code, String claimId) {
        issues.add(new ExplanationValidationIssue(code, claimId)); return new ExplanationClaimValidationResult(ExplanationValidationStatus.REJECTED, issues, VERSION);
    }
    private static boolean topicSupported(ExplanationClaim claim, List<DiagnosisCitationSnapshot> citations) {
        if (claim.type() == ExplanationClaimType.LIMITATION_NOTICE) return true;
        String expected = switch (claim.type()) {
            case IMAGE_FINDING_SUMMARY -> "IMAGE";
            case GENERAL_DISEASE_INFORMATION -> "DISEASE";
            case GENERAL_RISK_CONTEXT -> "RISK";
            case GENERAL_FOLLOW_UP_GUIDANCE -> "FOLLOW";
            case LIMITATION_NOTICE -> "";
        };
        return citations.stream().flatMap(c -> c.topicCodes().stream()).anyMatch(topic -> topic.toUpperCase(Locale.ROOT).contains(expected));
    }
    private static boolean containsAny(String text, String... terms) { for (String term : terms) if (text.contains(term)) return true; return false; }
    private static boolean mentionsUnacceptedDisease(String text, Set<String> diseaseCodes) {
        return diseaseCodes.stream().noneMatch(code -> text.contains(code.toLowerCase(Locale.ROOT))) && text.contains("disease code:");
    }
}
