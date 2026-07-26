package com.csust.eyediagnosis.workflow.job;

import com.csust.eyediagnosis.workflow.domain.WorkflowStatus;
import com.csust.eyediagnosis.workflow.persistence.entity.WorkflowJobEntity;
import com.csust.eyediagnosis.workflow.persistence.repository.WorkflowJobRepository;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class DefaultExpiredLeaseRecoveryService implements ExpiredLeaseRecoveryService {
    private final WorkflowExecutionGate gate;
    private final WorkflowExecutionProperties properties;
    private final WorkflowJobRepository repository;
    private final JobRetryBackoffPolicy backoffPolicy;

    public DefaultExpiredLeaseRecoveryService(WorkflowExecutionGate gate, WorkflowExecutionProperties properties,
                                              WorkflowJobRepository repository, JobRetryBackoffPolicy backoffPolicy) {
        this.gate = gate;
        this.properties = properties;
        this.repository = repository;
        this.backoffPolicy = backoffPolicy;
    }

    @Override
    @Transactional
    public ExpiredLeaseRecoveryReport recoverExpiredLeases() {
        if (!gate.isClaimEnabled()) {
            return ExpiredLeaseRecoveryReport.skippedReport();
        }
        int retried = 0;
        int failed = 0;
        int cancelled = 0;
        for (String jobId : repository.findExpiredLeaseJobIdsForUpdate(properties.recoveryBatchSize())) {
            WorkflowJobEntity job = repository.findById(jobId).orElse(null);
            if (job == null) {
                continue;
            }
            WorkflowStatus workflowStatus = WorkflowStatus.valueOf(repository.findWorkflowStatusForUpdate(job.getWorkflowId()));
            if (workflowStatus.isTerminal()) {
                cancelled += repository.cancelExpiredLease(jobId);
            } else if (job.getAttempt() < job.getMaxAttempts()) {
                long delayMicros = DefaultWorkflowJobClaimService.micros(backoffPolicy.delayForAttempt(job.getAttempt()));
                retried += repository.recoverExpiredLeaseToRetryWait(jobId, delayMicros);
            } else {
                failed += repository.recoverExpiredLeaseToFailed(jobId);
            }
        }
        return new ExpiredLeaseRecoveryReport(false, retried, failed, cancelled);
    }
}
