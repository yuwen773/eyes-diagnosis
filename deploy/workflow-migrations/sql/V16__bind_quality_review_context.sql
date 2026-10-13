-- Existing release review tasks remain unbound and cannot be submitted to Python.
ALTER TABLE t_human_review_task
    ADD COLUMN workflowVersion BIGINT,
    ADD COLUMN inferenceEnvelopeId VARCHAR(64),
    ADD COLUMN graphDefinitionVersion VARCHAR(64),
    ADD COLUMN graphDefinitionHash VARCHAR(128),
    ADD COLUMN actionVersion VARCHAR(64);
