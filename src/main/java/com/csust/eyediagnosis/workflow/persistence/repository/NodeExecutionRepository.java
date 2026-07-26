package com.csust.eyediagnosis.workflow.persistence.repository;
import com.csust.eyediagnosis.workflow.persistence.entity.WorkflowNodeExecutionEntity; import java.util.Optional;
public interface NodeExecutionRepository { int insertIfAbsent(WorkflowNodeExecutionEntity entity); Optional<WorkflowNodeExecutionEntity> findByIdempotencyKey(String idempotencyKey); }
