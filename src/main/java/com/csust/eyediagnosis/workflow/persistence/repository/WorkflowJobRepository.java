package com.csust.eyediagnosis.workflow.persistence.repository;

import com.csust.eyediagnosis.workflow.persistence.entity.WorkflowJobEntity;

import java.util.List;
import java.util.Optional;

public interface WorkflowJobRepository {
    int insert(WorkflowJobEntity entity);
    Optional<WorkflowJobEntity> findById(String jobId);
    List<WorkflowJobEntity> findByWorkflowId(String workflowId);
    Optional<WorkflowJobEntity> findNextClaimableForUpdate(List<String> claimableStatuses, List<String> activeWorkflowStatuses);
    int claimIfAvailable(String jobId, String leaseOwner, String leaseToken, long leaseMicros, List<String> claimableStatuses, List<String> activeWorkflowStatuses);
    int renewIfLeaseMatches(String jobId, String leaseOwner, String leaseToken, long leaseVersion, long leaseMicros);
    int markSucceededIfLeaseMatches(String jobId, String leaseOwner, String leaseToken, long leaseVersion);
    int scheduleRetryIfLeaseMatches(String jobId, String leaseOwner, String leaseToken, long leaseVersion, long delayMicros, String errorCode);
    int failIfLeaseMatches(String jobId, String leaseOwner, String leaseToken, long leaseVersion, String errorCode);
    List<String> findExpiredLeaseJobIdsForUpdate(int batchSize);
    String findWorkflowStatusForUpdate(String workflowId);
    int recoverExpiredLeaseToRetryWait(String jobId, long delayMicros);
    int recoverExpiredLeaseToFailed(String jobId);
    int cancelExpiredLease(String jobId);
    Optional<WorkflowJobEntity> findByBusinessKey(String workflowId, long executionEpoch, String segmentCode, String jobType);
}
