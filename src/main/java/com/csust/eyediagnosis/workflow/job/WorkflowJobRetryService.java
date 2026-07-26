package com.csust.eyediagnosis.workflow.job;

public interface WorkflowJobRetryService {
    JobRetryResult scheduleRetry(LeasedJobFence fence, ControlledJobErrorCode errorCode);
}
