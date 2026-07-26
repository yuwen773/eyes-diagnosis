package com.csust.eyediagnosis.workflow.inference;

import com.csust.eyediagnosis.workflow.persistence.entity.WorkflowNodeExecutionEntity;
import com.csust.eyediagnosis.workflow.persistence.repository.NodeExecutionRepository;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDateTime;
import java.util.UUID;

@Service
public class InferenceInvocationReservationService {
    private final NodeExecutionRepository nodeRepository;
    public InferenceInvocationReservationService(NodeExecutionRepository nodeRepository) { this.nodeRepository = nodeRepository; }
    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public String reserve(InferenceInvocationRequest request, String key) {
        WorkflowNodeExecutionEntity entity = new WorkflowNodeExecutionEntity();
        entity.setNodeExecutionId(UUID.randomUUID().toString()); entity.setWorkflowId(request.input().workflowId()); entity.setExecutionEpoch(request.inferenceEpoch());
        entity.setSegmentCode("INTAKE_INFERENCE_QUALITY"); entity.setNodeCode("IMAGE_INFERENCE"); entity.setIdempotencyKey(key); entity.setStatus("INVOKING");
        entity.setInputDigest(request.input().inputDigest()); entity.setStartedAt(LocalDateTime.now()); entity.setCreatedAt(LocalDateTime.now()); entity.setUpdatedAt(LocalDateTime.now());
        try { return nodeRepository.insertIfAbsent(entity) == 1 ? entity.getNodeExecutionId() : null; }
        catch (DataIntegrityViolationException exception) { return null; }
    }
}
