-- Separate from personal chat RAG: existing knowledge documents are never promoted.
CREATE TABLE t_controlled_reference (
    id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
    title VARCHAR(200) NOT NULL,
    source VARCHAR(1024) NOT NULL,
    fileName VARCHAR(255) NOT NULL,
    documentVersion CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    fileContent MEDIUMBLOB NOT NULL,
    isTest TINYINT NOT NULL DEFAULT 1,
    visibility VARCHAR(32) NOT NULL DEFAULT 'PRIVATE_USER',
    reviewStatus VARCHAR(32) NOT NULL DEFAULT 'PENDING',
    diseaseCodes JSON NOT NULL,
    topicCodes JSON NOT NULL,
    enabled TINYINT NOT NULL DEFAULT 1,
    isDelete TINYINT NOT NULL DEFAULT 0,
    governanceVersion BIGINT NOT NULL DEFAULT 1,
    uploadedBy BIGINT NOT NULL,
    reviewedBy BIGINT,
    reviewedAt DATETIME(6),
    reviewNote VARCHAR(2000) NOT NULL DEFAULT '',
    createdAt DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    KEY idx_reference_eligibility (reviewStatus, visibility, enabled, isDelete, isTest)
) ENGINE=InnoDB;

CREATE TABLE t_controlled_reference_chunk (
    documentId CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    chunkIndex INT NOT NULL,
    excerpt MEDIUMTEXT NOT NULL,
    excerptDigest CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    PRIMARY KEY (documentId, chunkIndex),
    CONSTRAINT fk_controlled_reference_chunk FOREIGN KEY (documentId) REFERENCES t_controlled_reference(id)
) ENGINE=InnoDB;
