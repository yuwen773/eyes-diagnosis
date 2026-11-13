-- Explicit task grants and write-once decisions, separate from publication and patient consent.
CREATE TABLE t_doctor_review (
    reviewId CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
    taskId VARCHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    doctorId BIGINT NOT NULL,
    assignedBy BIGINT NOT NULL,
    assignedAt DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    taskVersion BIGINT NOT NULL,
    draftVersion INT NOT NULL,
    evidenceVersion INT NOT NULL,
    materialDigest CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    materials JSON NOT NULL,
    status VARCHAR(32) NOT NULL DEFAULT 'PENDING',
    note VARCHAR(2000) NOT NULL DEFAULT '',
    decidedBy BIGINT,
    decidedAt DATETIME(6),
    UNIQUE KEY uk_doctor_review_task (taskId),
    KEY idx_doctor_review_inbox (doctorId, assignedAt)
) ENGINE=InnoDB;
