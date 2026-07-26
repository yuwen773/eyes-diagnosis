package com.csust.eyediagnosis.workflow.persistence.repository;
import com.csust.eyediagnosis.workflow.persistence.entity.WorkflowJobEntity; import java.util.List; import java.util.Optional;
public interface WorkflowJobRepository { int insert(WorkflowJobEntity entity); Optional<WorkflowJobEntity> findById(String jobId); List<WorkflowJobEntity> findByWorkflowId(String workflowId); int updateStatusIfVersionMatches(String jobId, long expectedLeaseVersion, String targetStatus); }
