package com.csust.eyediagnosis.workflow.job;

import com.csust.eyediagnosis.workflow.persistence.repository.WorkflowJobRepository;
import org.springframework.stereotype.Service;

@Service
public class DefaultWorkflowJobLeaseService implements WorkflowJobLeaseService {
    private final WorkflowJobRepository repository;
    private final WorkflowExecutionProperties properties;

    public DefaultWorkflowJobLeaseService(WorkflowJobRepository repository, WorkflowExecutionProperties properties) {
        this.repository = repository;
        this.properties = properties;
    }

    @Override
    public LeaseRenewalResult renew(String jobId, WorkerIdentity workerIdentity, String leaseToken, long leaseVersion) {
        int updated = repository.renewIfLeaseMatches(jobId, workerIdentity.value(), leaseToken, leaseVersion,
                DefaultWorkflowJobClaimService.micros(properties.leaseDuration()));
        return updated == 1 ? LeaseRenewalResult.RENEWED : LeaseRenewalResult.LEASE_LOST;
    }

    @Override
    public boolean markSucceededIfLeaseMatches(LeasedJobFence fence) {
        return repository.markSucceededIfLeaseMatches(fence.jobId(), fence.leaseOwner(), fence.leaseToken(), fence.leaseVersion()) == 1;
    }
}
