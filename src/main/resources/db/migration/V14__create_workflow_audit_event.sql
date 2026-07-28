-- PR-12.2 append-only audit trail. Rows are immutable: the application layer only exposes
-- append/read operations and never issues UPDATE or DELETE against this table.
CREATE TABLE t_workflow_audit_event (
    auditEventId    VARCHAR(64)  NOT NULL,
    workflowId      VARCHAR(64)  NOT NULL,
    eventType       VARCHAR(64)  NOT NULL,
    actorType       VARCHAR(32)  NOT NULL,
    actorId         VARCHAR(64)  NULL,
    segmentCode     VARCHAR(64)  NULL,
    traceId         VARCHAR(64)  NULL,
    payloadSnapshot TEXT         NULL,
    occurredAt      DATETIME(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    PRIMARY KEY (auditEventId),
    INDEX idx_audit_workflow (workflowId, occurredAt),
    INDEX idx_audit_event_type (eventType, occurredAt)
);
