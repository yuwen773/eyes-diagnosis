package com.csust.eyediagnosis.workflow.persistence.entity;
import com.baomidou.mybatisplus.annotation.*; import lombok.Data; import java.time.LocalDateTime;
@Data @TableName("t_human_review_task") public class HumanReviewTaskEntity {
 @TableId(type=IdType.INPUT) private String reviewTaskId; private String workflowId; private String reviewType; private Integer reviewRound; private String status; private Long assignedDoctorId; private Long submittedDoctorId; private String decisionCode; private String decisionReasonCode; private Long taskVersion; private String graphThreadId; private String graphCheckpointId; private LocalDateTime createdAt; private LocalDateTime claimedAt; private LocalDateTime submittedAt; private LocalDateTime cancelledAt; private LocalDateTime updatedAt;
}
