-- Cache identity must include every versioned safety policy input. Existing
-- cache rows are intentionally marked legacy-unknown so they cannot be reused.
ALTER TABLE t_inference_cache
    ADD COLUMN inferencePolicyVersion VARCHAR(64) NOT NULL DEFAULT 'legacy-unknown' AFTER preprocessVersion,
    ADD COLUMN calibrationStatus VARCHAR(32) NOT NULL DEFAULT 'NOT_CALIBRATED' AFTER calibratedProbability,
    ADD COLUMN oodStatus VARCHAR(32) NOT NULL DEFAULT 'NOT_EVALUATED' AFTER oodScore;

ALTER TABLE t_inference_cache
    DROP INDEX uk_inference,
    ADD UNIQUE KEY uk_inference (imageHash, modelVersion, weightSha256, preprocessVersion, inferencePolicyVersion);

-- Persist the evidence used at diagnosis time. Historical records must not
-- depend on the shared cache, which may expire or be superseded.
ALTER TABLE t_diagnosis
    ADD COLUMN preprocessVersion VARCHAR(64) NULL AFTER weightSha256,
    ADD COLUMN inferencePolicyVersion VARCHAR(64) NULL AFTER preprocessVersion,
    ADD COLUMN calibrationStatus VARCHAR(32) NULL AFTER inferencePolicyVersion,
    ADD COLUMN calibratedProbability DOUBLE NULL AFTER calibrationStatus,
    ADD COLUMN qualityScore INT NULL AFTER calibratedProbability,
    ADD COLUMN qualityReasons VARCHAR(512) NULL AFTER qualityScore,
    ADD COLUMN oodStatus VARCHAR(32) NULL AFTER qualityReasons,
    ADD COLUMN oodScore DOUBLE NULL AFTER oodStatus;
