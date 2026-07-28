package com.csust.eyediagnosis.workflow.audit;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import lombok.Data;

import java.time.LocalDateTime;

/** Immutable row of the append-only audit trail ({@code t_workflow_audit_event}). */
@Data
@TableName("t_workflow_audit_event")
public class WorkflowAuditEventEntity {
    @TableId(type = IdType.INPUT)
    private String auditEventId;
    private String workflowId;
    private String eventType;
    private String actorType;
    private String actorId;
    private String segmentCode;
    private String traceId;
    private String payloadSnapshot;
    private LocalDateTime occurredAt;
}
