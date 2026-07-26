package com.csust.eyediagnosis.workflow.runtime;

import com.csust.eyediagnosis.workflow.job.LeasedWorkflowJob;

public interface ClaimedSegmentExecutionService {
    SegmentExecutionAttemptResult execute(LeasedWorkflowJob job);
}
