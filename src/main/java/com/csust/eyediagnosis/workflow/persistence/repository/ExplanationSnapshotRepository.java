package com.csust.eyediagnosis.workflow.persistence.repository;
import com.csust.eyediagnosis.workflow.persistence.entity.ExplanationSnapshotEntity; import java.util.Optional;
public interface ExplanationSnapshotRepository {
    int insert(ExplanationSnapshotEntity entity);
    Optional<ExplanationSnapshotEntity> findByWorkflowIdAndRevision(String workflowId, long revision);
    int updatePublicationStatusIfExpected(String workflowId, long revision, String expectedStatus, String targetStatus);
}
