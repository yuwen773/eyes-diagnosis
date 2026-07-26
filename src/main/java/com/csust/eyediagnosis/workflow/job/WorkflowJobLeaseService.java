package com.csust.eyediagnosis.workflow.job;

public interface WorkflowJobLeaseService {
    LeaseRenewalResult renew(String jobId, WorkerIdentity workerIdentity, String leaseToken, long leaseVersion);
    boolean markSucceededIfLeaseMatches(LeasedJobFence fence);
}
