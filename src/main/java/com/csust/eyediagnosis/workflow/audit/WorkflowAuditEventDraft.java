package com.csust.eyediagnosis.workflow.audit;

/** Input for one append-only audit record. */
public record WorkflowAuditEventDraft(String workflowId,
                                      AuditEventType eventType,
                                      String actorType,
                                      String actorId,
                                      String segmentCode,
                                      String payloadSnapshot) {
    public WorkflowAuditEventDraft {
        if (workflowId == null || workflowId.isBlank() || eventType == null
                || actorType == null || actorType.isBlank()) {
            throw new IllegalArgumentException("audit event draft must have workflowId, eventType and actorType");
        }
    }

    public static WorkflowAuditEventDraft system(String workflowId, AuditEventType eventType,
                                                 String segmentCode, String payloadSnapshot) {
        return new WorkflowAuditEventDraft(workflowId, eventType, "SYSTEM", null, segmentCode, payloadSnapshot);
    }
}
