package com.csust.eyediagnosis.workflow.review;

import com.csust.eyediagnosis.workflow.domain.ReviewType;
import com.csust.eyediagnosis.workflow.graph.runtime.GraphRecoveryToken;
import com.csust.eyediagnosis.workflow.persistence.entity.HumanReviewTaskEntity;
import com.csust.eyediagnosis.workflow.persistence.repository.HumanReviewTaskRepository;
import org.springframework.stereotype.Service;

import java.time.LocalDateTime;
import java.util.Objects;
import java.util.Optional;
import java.util.UUID;

@Service
public class DefaultHumanReviewHandoff implements HumanReviewHandoff {
    private final HumanReviewTaskRepository taskRepository;

    public DefaultHumanReviewHandoff(HumanReviewTaskRepository taskRepository) {
        this.taskRepository = taskRepository;
    }

    @Override
    public String createHandoffTask(String workflowId, ReviewType reviewType, GraphRecoveryToken recoveryToken) {
        Objects.requireNonNull(reviewType, "review type must not be null");
        Objects.requireNonNull(recoveryToken, "recovery token must not be null");
        Optional<HumanReviewTaskEntity> latest = taskRepository.findActiveByWorkflowAndType(workflowId, reviewType.name());
        if (latest.isPresent() && ReviewTaskStatus.valueOf(latest.get().getStatus()).isActive()) {
            throw new ReviewTaskConflictException("An active " + reviewType + " task already exists for workflow " + workflowId);
        }
        HumanReviewTaskEntity task = new HumanReviewTaskEntity();
        task.setReviewTaskId(UUID.randomUUID().toString());
        task.setWorkflowId(workflowId);
        task.setReviewType(reviewType.name());
        task.setReviewRound(latest.map(t -> t.getReviewRound() + 1).orElse(1));
        task.setStatus(ReviewTaskStatus.OPEN.name());
        task.setTaskVersion(0L);
        task.setGraphThreadId(recoveryToken.threadId());
        task.setGraphCheckpointId(recoveryToken.checkpointId());
        LocalDateTime now = LocalDateTime.now();
        task.setCreatedAt(now);
        task.setUpdatedAt(now);
        taskRepository.insert(task);
        return task.getReviewTaskId();
    }
}
