-- Historical records keep their original material bytes and workflow identity.
ALTER TABLE t_patient_draft_run
    ADD COLUMN workflowVersion VARCHAR(32) NOT NULL DEFAULT 'SEQUENTIAL_V1' AFTER inferenceDigest;
