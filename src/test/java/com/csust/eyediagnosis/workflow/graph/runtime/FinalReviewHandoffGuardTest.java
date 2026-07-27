package com.csust.eyediagnosis.workflow.graph.runtime;
import com.csust.eyediagnosis.workflow.domain.*; import com.csust.eyediagnosis.workflow.graph.definition.GraphDefinitionBinding; import org.junit.jupiter.api.Test; import static org.junit.jupiter.api.Assertions.*;
class FinalReviewHandoffGuardTest {
 @Test void rejectsGenericFinalReviewResumeBeforeAnyCommit(){
  SegmentBusinessCommitPlan plan=new SegmentBusinessCommitPlan(WorkflowStatus.RUNNING,SegmentCode.FINAL_RISK_EXPLANATION,ExplanationPublicationStatus.VALIDATED,PredictionExposureStatus.AVAILABLE,null,null,new NoBusinessDelta(),new WorkflowEventDraft("x","SYSTEM","x",null,null));
  SegmentExecutionResult result=new SegmentExecutionResult("wf",SegmentCode.FINAL_RISK_EXPLANATION,GraphRuntimeDisposition.INTERRUPTED,"finalClinicalReview",SegmentCode.FINAL_CLINICAL_REVIEW_RESUME,new GraphRecoveryToken("thread","checkpoint"),new GraphDefinitionBinding("v","h","a"),plan);
  SegmentCommitFailureException e=assertThrows(SegmentCommitFailureException.class,()->new FinalReviewHandoffGuard().requireAllowed(result)); assertEquals(FinalReviewHandoffGuard.ERROR_CODE,e.getMessage());
 }
}
