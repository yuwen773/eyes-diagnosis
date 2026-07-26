package com.csust.eyediagnosis.workflow.persistence.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.csust.eyediagnosis.workflow.persistence.entity.WorkflowJobEntity;
import org.apache.ibatis.annotations.Insert;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;
import org.apache.ibatis.annotations.Update;

import java.util.List;

@Mapper
public interface WorkflowJobMapper extends BaseMapper<WorkflowJobEntity> {

    @Insert("""
            INSERT INTO t_workflow_job(jobId, workflowId, jobType, segmentCode, executionEpoch, status, attempt, maxAttempts, availableAt, leaseVersion, graphThreadId, graphCheckpointId)
            VALUES(#{jobId}, #{workflowId}, #{jobType}, #{segmentCode}, #{executionEpoch}, #{status}, #{attempt}, #{maxAttempts}, DEFAULT, #{leaseVersion}, #{graphThreadId}, #{graphCheckpointId})
            """)
    int insertWithDatabaseDefaultAvailableAt(WorkflowJobEntity entity);

    @Select("""
            <script>
            SELECT j.* FROM t_workflow_job j FORCE INDEX (idx_workflow_job_claimable_order)
            JOIN t_diagnosis_workflow w ON w.workflowId = j.workflowId
            WHERE j.claimableAt IS NOT NULL
              AND j.claimableAt BETWEEN '1000-01-01 00:00:00' AND NOW(6)
              AND w.status IN
            <foreach collection='activeWorkflowStatuses' item='status' open='(' separator=',' close=')'>#{status}</foreach>
            ORDER BY j.claimableAt ASC, j.jobId ASC
            LIMIT 1
            FOR UPDATE OF j SKIP LOCKED
            </script>
            """)
    WorkflowJobEntity selectNextClaimableForUpdate(
            @Param("claimableStatuses") List<String> claimableStatuses,
            @Param("activeWorkflowStatuses") List<String> activeWorkflowStatuses);

    @Update("""
            <script>
            UPDATE t_workflow_job
            SET status = 'LEASED', attempt = attempt + 1, leaseOwner = #{leaseOwner}, leaseToken = #{leaseToken},
                leaseVersion = leaseVersion + 1,
                leaseUntil = DATE_ADD(NOW(6), INTERVAL #{leaseMicros} MICROSECOND), updatedAt = NOW(6)
            WHERE jobId = #{jobId} AND status IN
            <foreach collection='claimableStatuses' item='status' open='(' separator=',' close=')'>#{status}</foreach>
              AND availableAt BETWEEN '1000-01-01 00:00:00' AND NOW(6)
              AND attempt BETWEEN -2147483648 AND maxAttempts - 1
              AND EXISTS (
                SELECT 1 FROM t_diagnosis_workflow w
                WHERE w.workflowId = t_workflow_job.workflowId AND w.status IN
                <foreach collection='activeWorkflowStatuses' item='status' open='(' separator=',' close=')'>#{status}</foreach>
              )
            </script>
            """)
    int claimIfAvailable(@Param("jobId") String jobId, @Param("leaseOwner") String leaseOwner,
                         @Param("leaseToken") String leaseToken, @Param("leaseMicros") long leaseMicros,
                         @Param("claimableStatuses") List<String> claimableStatuses,
                         @Param("activeWorkflowStatuses") List<String> activeWorkflowStatuses);

    @Update("""
            UPDATE t_workflow_job SET leaseUntil = DATE_ADD(NOW(6), INTERVAL #{leaseMicros} MICROSECOND), updatedAt = NOW(6)
            WHERE jobId = #{jobId} AND status = 'LEASED' AND leaseOwner = #{leaseOwner}
              AND leaseToken = #{leaseToken} AND leaseVersion = #{leaseVersion} AND leaseUntil > NOW(6)
            """)
    int renewIfLeaseMatches(@Param("jobId") String jobId, @Param("leaseOwner") String leaseOwner,
                            @Param("leaseToken") String leaseToken, @Param("leaseVersion") long leaseVersion,
                            @Param("leaseMicros") long leaseMicros);

    @Update("""
            UPDATE t_workflow_job
            SET status = 'SUCCEEDED', leaseOwner = NULL, leaseToken = NULL, leaseUntil = NULL, updatedAt = NOW(6)
            WHERE jobId = #{jobId} AND status = 'LEASED' AND leaseOwner = #{leaseOwner}
              AND leaseToken = #{leaseToken} AND leaseVersion = #{leaseVersion} AND leaseUntil > NOW(6)
            """)
    int markSucceededIfLeaseMatches(@Param("jobId") String jobId, @Param("leaseOwner") String leaseOwner,
                                    @Param("leaseToken") String leaseToken, @Param("leaseVersion") long leaseVersion);

    @Update("""
            UPDATE t_workflow_job
            SET status = 'RETRY_WAIT', availableAt = DATE_ADD(NOW(6), INTERVAL #{delayMicros} MICROSECOND),
                leaseOwner = NULL, leaseToken = NULL, leaseUntil = NULL, lastErrorCode = #{errorCode}, updatedAt = NOW(6)
            WHERE jobId = #{jobId} AND status = 'LEASED' AND leaseOwner = #{leaseOwner}
              AND leaseToken = #{leaseToken} AND leaseVersion = #{leaseVersion} AND leaseUntil > NOW(6)
              AND attempt BETWEEN -2147483648 AND maxAttempts - 1
            """)
    int scheduleRetryIfLeaseMatches(@Param("jobId") String jobId, @Param("leaseOwner") String leaseOwner,
                                    @Param("leaseToken") String leaseToken, @Param("leaseVersion") long leaseVersion,
                                    @Param("delayMicros") long delayMicros, @Param("errorCode") String errorCode);

    @Update("""
            UPDATE t_workflow_job
            SET status = 'FAILED', leaseOwner = NULL, leaseToken = NULL, leaseUntil = NULL,
                lastErrorCode = #{errorCode}, updatedAt = NOW(6)
            WHERE jobId = #{jobId} AND status = 'LEASED' AND leaseOwner = #{leaseOwner}
              AND leaseToken = #{leaseToken} AND leaseVersion = #{leaseVersion} AND leaseUntil > NOW(6)
              AND attempt >= maxAttempts
            """)
    int failIfLeaseMatches(@Param("jobId") String jobId, @Param("leaseOwner") String leaseOwner,
                           @Param("leaseToken") String leaseToken, @Param("leaseVersion") long leaseVersion,
                           @Param("errorCode") String errorCode);

    @Select("""
            <script>
            SELECT j.jobId FROM t_workflow_job j
            JOIN t_diagnosis_workflow w ON w.workflowId = j.workflowId
            WHERE j.status = 'LEASED' AND j.leaseUntil BETWEEN '1000-01-01 00:00:00' AND NOW(6)
            ORDER BY j.leaseUntil ASC, j.jobId ASC
            LIMIT #{batchSize}
            FOR UPDATE SKIP LOCKED
            </script>
            """)
    List<String> selectExpiredLeaseJobIdsForUpdate(@Param("batchSize") int batchSize);

    @Select("SELECT status FROM t_diagnosis_workflow WHERE workflowId = #{workflowId} FOR UPDATE")
    String selectWorkflowStatusForUpdate(@Param("workflowId") String workflowId);

    @Update("""
            <script>
            UPDATE t_workflow_job
            SET status = 'RETRY_WAIT', availableAt = DATE_ADD(NOW(6), INTERVAL #{delayMicros} MICROSECOND),
                leaseOwner = NULL, leaseToken = NULL, leaseUntil = NULL, lastErrorCode = 'LEASE_EXPIRED', updatedAt = NOW(6)
            WHERE jobId = #{jobId} AND status = 'LEASED' AND leaseUntil BETWEEN '1000-01-01 00:00:00' AND NOW(6)
            </script>
            """)
    int recoverExpiredLeaseToRetryWait(@Param("jobId") String jobId, @Param("delayMicros") long delayMicros);

    @Update("""
            <script>
            UPDATE t_workflow_job
            SET status = 'FAILED', leaseOwner = NULL, leaseToken = NULL, leaseUntil = NULL,
                lastErrorCode = 'RETRY_EXHAUSTED', updatedAt = NOW(6)
            WHERE jobId = #{jobId} AND status = 'LEASED' AND leaseUntil BETWEEN '1000-01-01 00:00:00' AND NOW(6)
            </script>
            """)
    int recoverExpiredLeaseToFailed(@Param("jobId") String jobId);

    @Update("""
            <script>
            UPDATE t_workflow_job
            SET status = 'CANCELLED', leaseOwner = NULL, leaseToken = NULL, leaseUntil = NULL,
                lastErrorCode = 'EXECUTION_CANCELLED', updatedAt = NOW(6)
            WHERE jobId = #{jobId} AND status = 'LEASED' AND leaseUntil BETWEEN '1000-01-01 00:00:00' AND NOW(6)
            </script>
            """)
    int cancelExpiredLease(@Param("jobId") String jobId);

    @Select("""
            SELECT * FROM t_workflow_job
            WHERE workflowId = #{workflowId} AND executionEpoch = #{executionEpoch}
              AND segmentCode = #{segmentCode} AND jobType = #{jobType}
            """)
    WorkflowJobEntity selectByBusinessKey(@Param("workflowId") String workflowId,
                                          @Param("executionEpoch") long executionEpoch,
                                          @Param("segmentCode") String segmentCode,
                                          @Param("jobType") String jobType);
}
