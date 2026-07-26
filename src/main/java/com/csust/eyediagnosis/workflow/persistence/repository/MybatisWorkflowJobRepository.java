package com.csust.eyediagnosis.workflow.persistence.repository;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.csust.eyediagnosis.workflow.persistence.entity.WorkflowJobEntity;
import com.csust.eyediagnosis.workflow.persistence.mapper.WorkflowJobMapper;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.Optional;

@Repository
public class MybatisWorkflowJobRepository implements WorkflowJobRepository {
    private final WorkflowJobMapper mapper;

    public MybatisWorkflowJobRepository(WorkflowJobMapper mapper) {
        this.mapper = mapper;
    }

    public int insert(WorkflowJobEntity entity) { return mapper.insertWithDatabaseDefaultAvailableAt(entity); }
    public Optional<WorkflowJobEntity> findById(String jobId) { return Optional.ofNullable(mapper.selectById(jobId)); }
    public List<WorkflowJobEntity> findByWorkflowId(String workflowId) { return mapper.selectList(new LambdaQueryWrapper<WorkflowJobEntity>().eq(WorkflowJobEntity::getWorkflowId, workflowId)); }
    public Optional<WorkflowJobEntity> findNextClaimableForUpdate(List<String> claimableStatuses, List<String> activeWorkflowStatuses) { return Optional.ofNullable(mapper.selectNextClaimableForUpdate(claimableStatuses, activeWorkflowStatuses)); }
    public int claimIfAvailable(String jobId, String leaseOwner, String leaseToken, long leaseMicros, List<String> claimableStatuses, List<String> activeWorkflowStatuses) { return mapper.claimIfAvailable(jobId, leaseOwner, leaseToken, leaseMicros, claimableStatuses, activeWorkflowStatuses); }
    public int renewIfLeaseMatches(String jobId, String leaseOwner, String leaseToken, long leaseVersion, long leaseMicros) { return mapper.renewIfLeaseMatches(jobId, leaseOwner, leaseToken, leaseVersion, leaseMicros); }
    public int markSucceededIfLeaseMatches(String jobId, String leaseOwner, String leaseToken, long leaseVersion) { return mapper.markSucceededIfLeaseMatches(jobId, leaseOwner, leaseToken, leaseVersion); }
    public int scheduleRetryIfLeaseMatches(String jobId, String leaseOwner, String leaseToken, long leaseVersion, long delayMicros, String errorCode) { return mapper.scheduleRetryIfLeaseMatches(jobId, leaseOwner, leaseToken, leaseVersion, delayMicros, errorCode); }
    public int failIfLeaseMatches(String jobId, String leaseOwner, String leaseToken, long leaseVersion, String errorCode) { return mapper.failIfLeaseMatches(jobId, leaseOwner, leaseToken, leaseVersion, errorCode); }
    public List<String> findExpiredLeaseJobIdsForUpdate(int batchSize) { return mapper.selectExpiredLeaseJobIdsForUpdate(batchSize); }
    public String findWorkflowStatusForUpdate(String workflowId) { return mapper.selectWorkflowStatusForUpdate(workflowId); }
    public int recoverExpiredLeaseToRetryWait(String jobId, long delayMicros) { return mapper.recoverExpiredLeaseToRetryWait(jobId, delayMicros); }
    public int recoverExpiredLeaseToFailed(String jobId) { return mapper.recoverExpiredLeaseToFailed(jobId); }
    public int cancelExpiredLease(String jobId) { return mapper.cancelExpiredLease(jobId); }
    public Optional<WorkflowJobEntity> findByBusinessKey(String workflowId, long executionEpoch, String segmentCode, String jobType) { return Optional.ofNullable(mapper.selectByBusinessKey(workflowId, executionEpoch, segmentCode, jobType)); }
}
