package com.csust.eyediagnosis.workflow.persistence.entity;
import com.baomidou.mybatisplus.annotation.*; import lombok.Data; import java.time.LocalDateTime;
@Data @TableName("t_workflow_node_execution") public class WorkflowNodeExecutionEntity {
 @TableId(type=IdType.INPUT) private String nodeExecutionId; private String workflowId; private Long executionEpoch; private String segmentCode; private String nodeCode; private String idempotencyKey; private String status; private String inputDigest; private String outputDigest; private String resultReference; private String errorCode; private LocalDateTime startedAt; private LocalDateTime completedAt; private LocalDateTime createdAt; private LocalDateTime updatedAt;
}
