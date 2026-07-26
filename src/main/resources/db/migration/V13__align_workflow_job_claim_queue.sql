ALTER TABLE t_workflow_job
    ADD COLUMN claimableAt DATETIME(6)
        GENERATED ALWAYS AS (
            CASE
                WHEN status IN ('READY', 'RETRY_WAIT') AND attempt < maxAttempts THEN availableAt
                ELSE NULL
            END
        );

CREATE INDEX idx_workflow_job_claimable_order
    ON t_workflow_job (claimableAt, jobId);
