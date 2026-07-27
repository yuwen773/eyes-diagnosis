package com.csust.eyediagnosis.workflow.explanation;
import com.csust.eyediagnosis.workflow.risk.*;
/** Pure graph action: graph definitions own all conditional edges. */
public final class ClinicalRiskFinalAction { private final ClinicalRiskPolicy policy; public ClinicalRiskFinalAction(ClinicalRiskPolicy policy){this.policy=policy;} public ClinicalRiskFinalResult execute(ClinicalRiskFinalInput input){return policy.finalAssess(input);} }
