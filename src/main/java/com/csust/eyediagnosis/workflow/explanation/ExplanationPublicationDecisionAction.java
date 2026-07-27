package com.csust.eyediagnosis.workflow.explanation;
import com.csust.eyediagnosis.workflow.domain.ExplanationPublicationStatus; import com.csust.eyediagnosis.workflow.risk.ClinicalRiskFinalResult;
/** Pure decision action; it does not write a workflow or choose a graph node. */
public final class ExplanationPublicationDecisionAction { private final ExplanationPublicationGuard guard; public ExplanationPublicationDecisionAction(ExplanationPublicationGuard guard){this.guard=guard;} public ExplanationPublicationDecision execute(ClinicalRiskFinalResult risk,ExplanationPublicationStatus status,ExplanationClaimValidationResult validation,boolean sufficient){return guard.decide(risk,status,validation,sufficient);} }
