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
    default int updateStateIfExactBindingAndVersionMatches(String workflowId, long expectedVersion, String expectedStatus,
                                                            String definitionVersion, String definitionHash, String actionVersion,
                                                            String targetStatus, String currentSegmentCode, String publicationStatus,
                                                            String exposureStatus, String stopReasonCode, String limitationReasonCode) {
        throw new UnsupportedOperationException("Exact graph-binding compare-and-swap is not implemented");
    }
    default int attachInferenceEnvelopeIfVersionMatches(String workflowId, long expectedWorkflowVersion, String inferenceEnvelopeId) {
        throw new UnsupportedOperationException("Inference envelope compare-and-swap is not implemented");
    }
}
