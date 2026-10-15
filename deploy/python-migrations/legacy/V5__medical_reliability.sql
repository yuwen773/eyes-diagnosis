CREATE TABLE IF NOT EXISTS t_diagnosis_audit (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    diagnosisId BIGINT NOT NULL,
    actorId BIGINT NOT NULL,
    actorRole VARCHAR(20) NOT NULL,
    action VARCHAR(40) NOT NULL,
    payload JSON,
    createdTime DATETIME DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_diagnosis (diagnosisId)
) COMMENT '诊断审计';

ALTER TABLE t_diagnosis
    ADD COLUMN aiRejected TINYINT(1) NOT NULL DEFAULT 0,
    ADD COLUMN abstainReason VARCHAR(40),
    ADD COLUMN modelVersion VARCHAR(64),
    ADD COLUMN weightSha256 VARCHAR(128),
    ADD COLUMN humanReviewStatus VARCHAR(20) NOT NULL DEFAULT 'PENDING_AI',
    ADD COLUMN humanReviewerId BIGINT,
    ADD COLUMN humanReviewedAt DATETIME,
    ADD COLUMN humanReviewNote TEXT,
    ADD COLUMN humanResult VARCHAR(255),
    ADD COLUMN humanSeverity VARCHAR(40),
    ADD COLUMN humanRecommendations TEXT;

UPDATE t_diagnosis SET humanReviewStatus = 'AI_ONLY' WHERE result IS NOT NULL AND humanReviewStatus = 'PENDING_AI';