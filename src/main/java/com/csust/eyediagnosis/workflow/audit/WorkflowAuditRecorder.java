package com.csust.eyediagnosis.workflow.audit;

import java.util.List;

/**
 * Append-only audit trail API (PR-12.2). Intentionally exposes no update or delete operation:
 * an audit record, once written, is immutable.
 */
public interface WorkflowAuditRecorder {

    /** Appends one audit event. Never updates existing rows. */
    void append(WorkflowAuditEventDraft draft);

    /** Returns the audit trail of one workflow, oldest first. */
    List<WorkflowAuditEventEntity> findByWorkflowId(String workflowId);
}
