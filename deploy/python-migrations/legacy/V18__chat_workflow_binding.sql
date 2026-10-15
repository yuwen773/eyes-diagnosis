-- Bounded original inputs for new chat uploads; legacy attachments remain NULL.
ALTER TABLE t_python_chat_attachment ADD COLUMN imageBytes MEDIUMBLOB;

CREATE TABLE t_python_chat_workflow (
    sessionId VARCHAR(64) NOT NULL,
    workflowId VARCHAR(64) NOT NULL,
    messageId BIGINT NOT NULL,
    attachmentId VARCHAR(36),
    createdTime DATETIME NOT NULL,
    PRIMARY KEY (sessionId, workflowId),
    INDEX idx_workflow (workflowId)
) COMMENT 'Authorized chat references to existing clinical workflows, not duplicate jobs';
