package com.csust.eyediagnosis.workflow.job;

import com.csust.eyediagnosis.workflow.domain.SegmentCode;
import com.csust.eyediagnosis.workflow.domain.WorkflowJobStatus;
import com.csust.eyediagnosis.workflow.domain.WorkflowJobType;
import com.csust.eyediagnosis.workflow.domain.WorkflowStatus;
import com.csust.eyediagnosis.workflow.persistence.entity.WorkflowJobEntity;
import com.csust.eyediagnosis.workflow.persistence.repository.WorkflowJobRepository;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.ZoneId;
import java.util.List;
import java.util.Optional;

@Service
public class DefaultWorkflowJobClaimService implements WorkflowJobClaimService {
    private static final List<String> CLAIMABLE_STATUSES = List.of(WorkflowJobStatus.READY.name(), WorkflowJobStatus.RETRY_WAIT.name());

    private final WorkflowExecutionGate gate;
    private final WorkflowJobRepository repository;
    private final LeaseTokenGenerator tokenGenerator;
    private final WorkflowExecutionProperties properties;

    public DefaultWorkflowJobClaimService(WorkflowExecutionGate gate, WorkflowJobRepository repository,
                                          LeaseTokenGenerator tokenGenerator, WorkflowExecutionProperties properties) {
        this.gate = gate;
        this.repository = repository;
        this.tokenGenerator = tokenGenerator;
        this.properties = properties;
    }

    @Override
    @Transactional
    public Optional<LeasedWorkflowJob> claimNext(WorkerIdentity workerIdentity) {
        if (!gate.isClaimEnabled()) {
            return Optional.empty();
        }
        return repository.findNextClaimableForUpdate(CLAIMABLE_STATUSES, WorkflowStatus.nonTerminalNames())
                .flatMap(job -> claim(job, workerIdentity));
    }

    private Optional<LeasedWorkflowJob> claim(WorkflowJobEntity selectedJob, WorkerIdentity workerIdentity) {
        String token = tokenGenerator.generate();
        if (repository.claimIfAvailable(selectedJob.getJobId(), workerIdentity.value(), token, micros(properties.leaseDuration()), CLAIMABLE_STATUSES, WorkflowStatus.nonTerminalNames()) != 1) {
            return Optional.empty();
        }
        return repository.findById(selectedJob.getJobId()).map(DefaultWorkflowJobClaimService::toLeasedJob);
    }

    private static LeasedWorkflowJob toLeasedJob(WorkflowJobEntity job) {
        return new LeasedWorkflowJob(job.getJobId(), job.getWorkflowId(), WorkflowJobType.valueOf(job.getJobType()),
                SegmentCode.valueOf(job.getSegmentCode()), job.getExecutionEpoch(), job.getAttempt(), job.getMaxAttempts(),
                job.getLeaseOwner(), job.getLeaseToken(), job.getLeaseVersion(),
                job.getLeaseUntil().atZone(ZoneId.systemDefault()).toInstant());
    }

    static long micros(java.time.Duration duration) {
        return duration.toNanos() / 1_000;
    }
}
