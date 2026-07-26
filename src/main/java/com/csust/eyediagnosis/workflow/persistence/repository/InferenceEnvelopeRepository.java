package com.csust.eyediagnosis.workflow.persistence.repository;
import com.csust.eyediagnosis.workflow.persistence.entity.InferenceEnvelopeEntity; import java.util.Optional;
public interface InferenceEnvelopeRepository { int insert(InferenceEnvelopeEntity entity); Optional<InferenceEnvelopeEntity> findByWorkflowIdAndEpoch(String workflowId, long inferenceEpoch); }
