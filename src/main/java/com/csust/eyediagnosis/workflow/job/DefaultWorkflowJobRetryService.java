package com.csust.eyediagnosis.workflow.job;

import com.csust.eyediagnosis.workflow.persistence.repository.WorkflowJobRepository;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class DefaultWorkflowJobRetryService implements WorkflowJobRetryService {
    private final WorkflowJobRepository repository;
    private final JobRetryBackoffPolicy backoffPolicy;

    public DefaultWorkflowJobRetryService(WorkflowJobRepository repository, JobRetryBackoffPolicy backoffPolicy) {
        this.repository = repository;
        this.backoffPolicy = backoffPolicy;
    }

    @Override
    @Transactional
    public JobRetryResult scheduleRetry(LeasedJobFence fence, ControlledJobErrorCode errorCode) {
        long delayMicros = DefaultWorkflowJobClaimService.micros(backoffPolicy.delayForAttempt(fence.attempt()));
        if (repository.scheduleRetryIfLeaseMatches(fence.jobId(), fence.leaseOwner(), fence.leaseToken(), fence.leaseVersion(), delayMicros, errorCode.name()) == 1) {
            return JobRetryResult.RETRY_SCHEDULED;
        }
        if (repository.failIfLeaseMatches(fence.jobId(), fence.leaseOwner(), fence.leaseToken(), fence.leaseVersion(), ControlledJobErrorCode.RETRY_EXHAUSTED.name()) == 1) {
            return JobRetryResult.RETRY_EXHAUSTED;
        }
        return JobRetryResult.LEASE_LOST;
    }
}
