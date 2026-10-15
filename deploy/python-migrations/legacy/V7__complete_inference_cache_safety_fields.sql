ALTER TABLE t_inference_cache
    ADD COLUMN weightSha256 VARCHAR(64) NOT NULL DEFAULT '' AFTER modelVersion,
    ADD COLUMN calibratedProbability DOUBLE NOT NULL DEFAULT 0 AFTER probability,
    ADD COLUMN qualityScore INT NOT NULL DEFAULT 0 AFTER topPredictions,
    ADD COLUMN qualityReasons VARCHAR(512) NULL AFTER qualityScore,
    ADD COLUMN isOod TINYINT NOT NULL DEFAULT 0 AFTER qualityReasons,
    ADD COLUMN oodScore DOUBLE NOT NULL DEFAULT 0 AFTER isOod,
    ADD COLUMN rejected TINYINT NOT NULL DEFAULT 0 AFTER oodScore,
    ADD COLUMN abstainReason VARCHAR(64) NULL AFTER rejected,
    ADD COLUMN requiresReview TINYINT NOT NULL DEFAULT 0 AFTER abstainReason;

ALTER TABLE t_inference_cache
    DROP INDEX uk_inference,
    ADD UNIQUE KEY uk_inference (imageHash, modelVersion, weightSha256, preprocessVersion);
