package com.csust.eyediagnosis.workflow.explanation;
import com.csust.eyediagnosis.workflow.contract.PatientPredictionProjection; import com.csust.eyediagnosis.workflow.evidence.DiagnosisCitationSnapshot; import java.util.List;
/** Deterministic validation action; it never invokes the explanation model. */
public final class ExplanationClaimValidationAction { private final ExplanationClaimValidator validator; public ExplanationClaimValidationAction(ExplanationClaimValidator validator){this.validator=validator;} public ExplanationClaimValidationResult execute(ExplanationDraft draft,List<DiagnosisCitationSnapshot> citations,PatientPredictionProjection prediction){return validator.validate(draft,citations,prediction);} }
