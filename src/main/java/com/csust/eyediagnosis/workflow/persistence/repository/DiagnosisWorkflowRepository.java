package com.csust.eyediagnosis.workflow.persistence.repository;
import com.csust.eyediagnosis.workflow.persistence.entity.DiagnosisWorkflowEntity;
import java.util.List;
import java.util.Optional;

public interface DiagnosisWorkflowRepository {
    Optional<DiagnosisWorkflowEntity> findByWorkflowId(String workflowId);
    Optional<DiagnosisWorkflowEntity> findByOwnerAndIdempotencyKey(Long ownerUserId, String idempotencyKey);
    List<ActiveWorkflowGraphBinding> findNonTerminalGraphBindings();
    int insert(DiagnosisWorkflowEntity entity);
    int updateStateIfVersionMatches(String workflowId, long expectedVersion, String expectedStatus, String targetStatus, String currentSegmentCode, String publicationStatus, String exposureStatus, String stopReasonCode, String limitationReasonCode);
}
