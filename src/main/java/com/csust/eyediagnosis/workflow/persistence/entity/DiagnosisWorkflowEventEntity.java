package com.csust.eyediagnosis.workflow.persistence.entity;
import com.baomidou.mybatisplus.annotation.*; import lombok.Data; import java.time.LocalDateTime;
@Data @TableName("t_diagnosis_workflow_event") public class DiagnosisWorkflowEventEntity {
 @TableId(type=IdType.INPUT) private String eventId; private String workflowId; private Long eventSequence; private String eventType; private String actorType; private String actorId; private Long workflowVersion; private String segmentCode; private String reasonCode; private String payloadSnapshot; private LocalDateTime occurredAt;
}
