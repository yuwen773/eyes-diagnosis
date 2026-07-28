-- PR-12.4 部署环境：存量（Flyway 之外）表初始化脚本
-- 背景：t_user 等 8 张表属于项目早期手工维护的 schema.sql（开发库存量），
--       不在 Flyway V1-V14 迁移链内。全新数据库仅执行 Flyway 会缺失这些表，
--       导致登录、DemoDataSeeder 等功能不可用。
-- 用法：由 docker-compose 挂载至 mysql 容器 /docker-entrypoint-initdb.d/，
--       仅在数据卷首次初始化时执行一次。DDL 为 schema.sql 的最终状态
--       （已合并其中的 ALTER/DROP 语句），全部使用 IF NOT EXISTS 保证幂等。
-- 注意：本脚本不包含 Flyway 管理的任何表（t_diagnosis / t_mcp_server /
--       t_inference_cache / t_agent_message / t_workflow_* 等），避免双头管理。

USE diagnosis;

-- 用户表
CREATE TABLE IF NOT EXISTS t_user
(
    id           BIGINT AUTO_INCREMENT COMMENT 'id' PRIMARY KEY,
    userAccount  VARCHAR(256)                           NOT NULL COMMENT '账号',
    userPassword VARCHAR(512)                           NOT NULL COMMENT '密码',
    userName     VARCHAR(256)                           NULL COMMENT '用户昵称',
    userAvatar   VARCHAR(1024)                          NULL COMMENT '用户头像',
    userProfile  VARCHAR(512)                           NULL COMMENT '用户简介',
    userRole     VARCHAR(256) DEFAULT 'user'            NOT NULL COMMENT '用户角色：user/doctor/admin/auditor',
    editTime     DATETIME     DEFAULT CURRENT_TIMESTAMP NOT NULL COMMENT '编辑时间',
    createTime   DATETIME     DEFAULT CURRENT_TIMESTAMP NOT NULL COMMENT '创建时间',
    updateTime   DATETIME     DEFAULT CURRENT_TIMESTAMP NOT NULL ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
    isDelete     TINYINT      DEFAULT 0                 NOT NULL COMMENT '是否删除',
    UNIQUE KEY uk_userAccount (userAccount),
    INDEX idx_userName (userName)
) COMMENT '用户' COLLATE = utf8mb4_unicode_ci;

-- 新闻表
CREATE TABLE IF NOT EXISTS t_news
(
    id          BIGINT AUTO_INCREMENT COMMENT 'id' PRIMARY KEY,
    title       VARCHAR(255) NOT NULL COMMENT '新闻标题',
    userId      BIGINT       NOT NULL COMMENT '创建用户id',
    content     TEXT         NOT NULL COMMENT '新闻正文（富文本)',
    summary     VARCHAR(512) DEFAULT NULL COMMENT '摘要',
    coverImg    VARCHAR(512) NOT NULL COMMENT '封面图片 url',
    status      TINYINT(1)   DEFAULT '0' COMMENT '状态（0草稿/1已发布/2下架）',
    publishTime DATETIME     NOT NULL COMMENT '发布时间',
    editTime    DATETIME     DEFAULT CURRENT_TIMESTAMP NOT NULL COMMENT '修改时间',
    INDEX idx_title (title),
    INDEX idx_summary (summary),
    INDEX idx_userId (userId)
) COMMENT '新闻' COLLATE = utf8mb4_unicode_ci;

-- 新闻段落表
CREATE TABLE IF NOT EXISTS t_paragraph
(
    id      BIGINT AUTO_INCREMENT COMMENT 'id' PRIMARY KEY,
    newsId  BIGINT NOT NULL COMMENT '关联新闻id',
    content TEXT   NOT NULL COMMENT '段落内容'
) COMMENT '新闻段落' COLLATE = utf8mb4_unicode_ci;

-- 新闻图片表
CREATE TABLE IF NOT EXISTS t_attachment
(
    id            BIGINT AUTO_INCREMENT COMMENT 'id' PRIMARY KEY,
    newsId        BIGINT       NOT NULL COMMENT '关联新闻id',
    url           VARCHAR(512) NOT NULL COMMENT '图片 url',
    `order`       TINYINT      DEFAULT '0' COMMENT '段落顺序(用于排序)',
    `description` VARCHAR(200) DEFAULT '' COMMENT '图片描述'
) COMMENT '新闻附件表' COLLATE = utf8mb4_unicode_ci;

-- 会话表（最终状态：message 列已在 schema.sql 中 DROP，故不包含）
CREATE TABLE IF NOT EXISTS t_chatSession
(
    id         BIGINT AUTO_INCREMENT COMMENT 'id' PRIMARY KEY,
    title      VARCHAR(255) NOT NULL COMMENT '会话标题',
    userId     BIGINT       NOT NULL COMMENT '创建用户 id',
    createTime DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL COMMENT '创建时间',
    updateTime DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL COMMENT '更改时间',
    INDEX idx_title (title),
    INDEX idx_userId (userId)
) COMMENT '会话' COLLATE = utf8mb4_unicode_ci;

-- 对话历史表
CREATE TABLE IF NOT EXISTS t_chat_history
(
    id          BIGINT AUTO_INCREMENT COMMENT 'id' PRIMARY KEY,
    message     TEXT        NOT NULL COMMENT '消息',
    messageType VARCHAR(32) NOT NULL COMMENT 'user/ai',
    sessionId   BIGINT      NOT NULL COMMENT '会话id',
    userId      BIGINT      NOT NULL COMMENT '创建用户id',
    createTime  DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL COMMENT '创建时间',
    updateTime  DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
    isDelete    TINYINT  DEFAULT 0                 NOT NULL COMMENT '是否删除',
    INDEX idx_appId (sessionId),
    INDEX idx_createTime (createTime),
    INDEX idx_appId_createTime (sessionId, createTime)
) COMMENT '对话历史' COLLATE = utf8mb4_unicode_ci;

-- Agent会话表
CREATE TABLE IF NOT EXISTS t_agent_session (
    id             BIGINT PRIMARY KEY AUTO_INCREMENT,
    sessionId      VARCHAR(64) NOT NULL COMMENT '会话ID',
    userId         BIGINT      NOT NULL COMMENT '用户ID',
    title          VARCHAR(255) DEFAULT '新会话' COMMENT '会话标题',
    modelName      VARCHAR(100) COMMENT '模型名称',
    status         TINYINT      DEFAULT 1 COMMENT '状态:0结束,1活跃',
    lastMessage    VARCHAR(500) DEFAULT '' COMMENT '最后一条消息',
    messageCount   INT          DEFAULT 0 COMMENT '消息数量',
    summaryContent TEXT COMMENT '摘要内容',
    summaryAt      DATETIME COMMENT '摘要时间',
    checkpointData BLOB COMMENT '检查点数据',
    createdTime    DATETIME     DEFAULT CURRENT_TIMESTAMP,
    updatedTime    DATETIME     DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    expiredTime    DATETIME COMMENT '过期时间',
    isDelete       INT          DEFAULT 0 COMMENT '逻辑删除',
    pinned         TINYINT(1) NOT NULL DEFAULT 0 COMMENT '是否置顶：0-否，1-是',
    pinTime        DATETIME COMMENT '置顶时间',
    INDEX idx_userId (userId),
    UNIQUE KEY uk_agent_session_session_id (sessionId)
) COMMENT 'Agent会话表' COLLATE = utf8mb4_unicode_ci;

-- 知识库文档表
CREATE TABLE IF NOT EXISTS t_knowledge_document (
    id          BIGINT AUTO_INCREMENT COMMENT 'id' PRIMARY KEY,
    userId      BIGINT        NOT NULL COMMENT '上传用户id',
    title       VARCHAR(255)  NOT NULL COMMENT '文档标题',
    fileName    VARCHAR(512)  NOT NULL COMMENT '原始文件名',
    fileUrl     VARCHAR(1024) NOT NULL COMMENT 'COS存储地址',
    fileSize    BIGINT        NULL COMMENT '文件大小(字节)',
    fileType    VARCHAR(32)   NOT NULL COMMENT '文件类型:pdf/md/txt/docx',
    chunkCount  INT      DEFAULT 0 COMMENT '分块数量',
    contentHash VARCHAR(64)   NULL COMMENT '内容SHA-256哈希，用于去重',
    status      TINYINT  DEFAULT 0                 NOT NULL COMMENT '状态:0=处理中,1=已完成,2=失败',
    createTime  DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL COMMENT '创建时间',
    updateTime  DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
    isDelete    TINYINT  DEFAULT 0                 NOT NULL COMMENT '逻辑删除',
    INDEX idx_userId (userId),
    INDEX idx_status (status)
) COMMENT '知识库文档表' COLLATE = utf8mb4_unicode_ci;
