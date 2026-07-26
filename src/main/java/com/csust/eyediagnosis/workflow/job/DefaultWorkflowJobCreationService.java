package com.csust.eyediagnosis.workflow.job;

import com.csust.eyediagnosis.workflow.domain.WorkflowJobStatus;
import com.csust.eyediagnosis.workflow.persistence.entity.WorkflowJobEntity;
import com.csust.eyediagnosis.workflow.persistence.repository.WorkflowJobRepository;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.stereotype.Service;

import java.util.UUID;

@Service
public class DefaultWorkflowJobCreationService implements WorkflowJobCreationService {
    private final WorkflowJobRepository repository;

    public DefaultWorkflowJobCreationService(WorkflowJobRepository repository) {
        this.repository = repository;
    }

    @Override
    public JobCreationResult createIfAbsent(NewWorkflowJob job) {
        WorkflowJobEntity entity = new WorkflowJobEntity();
        entity.setJobId(UUID.randomUUID().toString());
        entity.setWorkflowId(job.workflowId());
        entity.setExecutionEpoch(job.executionEpoch());
        entity.setSegmentCode(job.segmentCode().name());
        entity.setJobType(job.jobType().name());
        entity.setStatus(WorkflowJobStatus.READY.name());
        entity.setAttempt(0);
        entity.setMaxAttempts(job.maxAttempts());
        entity.setLeaseVersion(0L);
        try {
            repository.insert(entity);
            return new JobCreationResult(JobCreationResult.Status.CREATED, entity.getJobId());
        } catch (DuplicateKeyException exception) {
            String jobId = repository.findByBusinessKey(job.workflowId(), job.executionEpoch(), job.segmentCode().name(), job.jobType().name())
                    .map(WorkflowJobEntity::getJobId)
                    .orElseThrow(() -> exception);
            return new JobCreationResult(JobCreationResult.Status.ALREADY_EXISTS, jobId);
        }
    }
}
