package com.csust.eyediagnosis.workflow.persistence.repository;
import com.csust.eyediagnosis.workflow.persistence.entity.DiagnosisWorkflowEventEntity; import java.util.List;
public interface WorkflowEventRepository { int append(DiagnosisWorkflowEventEntity entity); List<DiagnosisWorkflowEventEntity> findByWorkflowIdOrderBySequence(String workflowId); }
