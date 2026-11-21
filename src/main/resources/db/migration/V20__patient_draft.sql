-- Internal only: no patient-facing draft or publication state.
CREATE TABLE t_patient_draft_run (
    taskId VARCHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
    inferenceDigest CHAR(64) NOT NULL,
    status VARCHAR(32) NOT NULL,
    stopReason VARCHAR(64),
    callCount INT NOT NULL DEFAULT 0,
    supplementCount INT NOT NULL DEFAULT 0,
    rewriteCount INT NOT NULL DEFAULT 0,
    startedAt DATETIME(6) NOT NULL,
    deadlineAt DATETIME(6) NOT NULL,
    KEY idx_draft_deadline (status, deadlineAt)
) ENGINE=InnoDB;

CREATE TABLE t_patient_evidence_version (
    taskId VARCHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    version INT NOT NULL,
    citations JSON NOT NULL,
    PRIMARY KEY (taskId, version)
) ENGINE=InnoDB;

CREATE TABLE t_patient_draft_version (
    taskId VARCHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    version INT NOT NULL,
    evidenceVersion INT NOT NULL,
    draft JSON NOT NULL,
    PRIMARY KEY (taskId, version)
) ENGINE=InnoDB;

CREATE TABLE t_patient_draft_message (
    taskId VARCHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    sequence INT NOT NULL,
    role VARCHAR(32) NOT NULL,
    state VARCHAR(32) NOT NULL,
    output JSON,
    PRIMARY KEY (taskId, sequence)
) ENGINE=InnoDB;
