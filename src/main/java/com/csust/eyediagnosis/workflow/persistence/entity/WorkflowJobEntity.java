package com.csust.eyediagnosis.workflow.persistence.entity;
import com.baomidou.mybatisplus.annotation.*; import lombok.Data; import java.time.LocalDateTime;
@Data @TableName("t_workflow_job") public class WorkflowJobEntity {
 @TableId(type=IdType.INPUT) private String jobId; private String workflowId; private String jobType; private String segmentCode; private Long executionEpoch; private String status; private Integer attempt; private Integer maxAttempts; private LocalDateTime availableAt; private String leaseOwner; private String leaseToken; private Long leaseVersion; private LocalDateTime leaseUntil; private String graphThreadId; private String graphCheckpointId; private String lastErrorCode; private LocalDateTime createdAt; private LocalDateTime updatedAt;
}
