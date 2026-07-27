package com.csust.eyediagnosis.workflow.explanation;
import com.csust.eyediagnosis.workflow.risk.*;
/** Pure graph action: no model, retrieval, persistence, or routing. */
public final class ClinicalRiskPrecheckAction { private final ClinicalRiskPolicy policy; public ClinicalRiskPrecheckAction(ClinicalRiskPolicy policy){this.policy=policy;} public ClinicalRiskPrecheckResult execute(ClinicalRiskPrecheckInput input){return policy.precheck(input);} }
