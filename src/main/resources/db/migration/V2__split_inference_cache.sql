CREATE TABLE IF NOT EXISTS t_inference_cache (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    imageHash VARCHAR(64) NOT NULL,
    modelVersion VARCHAR(64) NOT NULL,
    preprocessVersion VARCHAR(64) NOT NULL,
    predictedLabel VARCHAR(64) NOT NULL,
    probability DOUBLE NOT NULL,
    description VARCHAR(512),
    reliabilityScore INT NOT NULL,
    topPredictions JSON,
    createTime DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uk_inference (imageHash, modelVersion, preprocessVersion)
) COMMENT '推理结果缓存';
