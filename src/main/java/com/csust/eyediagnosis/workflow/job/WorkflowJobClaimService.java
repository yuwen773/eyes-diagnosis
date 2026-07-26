package com.csust.eyediagnosis.workflow.job;

import java.util.Optional;

public interface WorkflowJobClaimService {
    Optional<LeasedWorkflowJob> claimNext(WorkerIdentity workerIdentity);
}
