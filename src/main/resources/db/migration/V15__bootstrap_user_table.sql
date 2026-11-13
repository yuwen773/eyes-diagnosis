-- Fresh databases need the user table used by registration and authentication.
-- Existing user tables and accounts are left unchanged.
CREATE TABLE IF NOT EXISTS t_user (
    id BIGINT NOT NULL AUTO_INCREMENT,
    userAccount VARCHAR(256) NOT NULL,
    userPassword VARCHAR(512) NOT NULL,
    userName VARCHAR(256),
    userAvatar VARCHAR(1024),
    userProfile VARCHAR(512),
    userRole VARCHAR(256) NOT NULL DEFAULT 'user',
    editTime DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    createTime DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updateTime DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    isDelete TINYINT NOT NULL DEFAULT 0,
    PRIMARY KEY (id),
    UNIQUE KEY uk_userAccount (userAccount),
    KEY idx_userName (userName)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
