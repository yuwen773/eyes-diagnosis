-- ① Schema 完整性：把 schema 的 interface 收回一条迁移链。
--
-- 背景：README.md:169 声明「Flyway 迁移是唯一权威」，但 master 的 V1--V9 与
-- callback 只建了 7 张表；t_user / t_news / t_agent_session / t_knowledge_document
-- 这 4 张被实体直接使用的表原本依赖 git 历史里已删除的 db/schema.sql，
-- 或 release/v1.0.0 独有的 deploy/mysql/init/01_legacy_schema.sql。
-- 空库执行 migrate 会缺表，登录、资讯、Agent 会话、知识库全部无表可写。
--
-- 全部使用 CREATE TABLE IF NOT EXISTS：已存在的开发库/生产库不受影响；
-- 新库一次 migrate 即得到完整 schema。列名逐字对齐实体字段（小驼峰），
-- 因为 application.yml 配置了 map-underscore-to-camel-case: false。
--
-- 编号 V15：其它分支（release/v1.0.0、worktree-java-multi-agent-arch 等）
-- 已占用 V10--V14，避免合并时版本撞车。V1--V9 一律不动（CLAUDE.md 约定）。
--
-- 未重建 t_chatSession / t_chat_history / t_paragraph / t_attachment：
-- 它们只存在于旧 schema.sql，全树（src/）无任何引用。

CREATE TABLE IF NOT EXISTS t_user (
    id           BIGINT AUTO_INCREMENT PRIMARY KEY,
    userAccount  VARCHAR(256)                           NOT NULL COMMENT '账号',
    userPassword VARCHAR(512)                           NOT NULL COMMENT '密码',
    userName     VARCHAR(256)                           NULL COMMENT '用户昵称',
    userAvatar   VARCHAR(1024)                          NULL COMMENT '用户头像',
    userProfile  VARCHAR(512)                           NULL COMMENT '用户简介',
    userRole     VARCHAR(256) DEFAULT 'user'            NOT NULL COMMENT '用户角色：user/admin',
    editTime     DATETIME     DEFAULT CURRENT_TIMESTAMP NOT NULL COMMENT '编辑时间',
    createTime   DATETIME     DEFAULT CURRENT_TIMESTAMP NOT NULL COMMENT '创建时间',
    updateTime   DATETIME     DEFAULT CURRENT_TIMESTAMP NOT NULL ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
    isDelete     TINYINT      DEFAULT 0                 NOT NULL COMMENT '是否删除',
    UNIQUE KEY uk_userAccount (userAccount),
    INDEX idx_userName (userName)
) COMMENT '用户' COLLATE = utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS t_news (
    id          BIGINT AUTO_INCREMENT PRIMARY KEY,
    title       VARCHAR(255) NOT NULL COMMENT '新闻标题',
    userId      BIGINT       NOT NULL COMMENT '创建用户id',
    content     TEXT         NOT NULL COMMENT '新闻正文（富文本)',
    summary     VARCHAR(512) DEFAULT NULL COMMENT '摘要',
    coverImg    VARCHAR(512) NOT NULL COMMENT '封面图片 url',
    status      TINYINT(1)   DEFAULT 0 COMMENT '状态（0草稿/1已发布/2下架）',
    publishTime DATETIME     NOT NULL COMMENT '发布时间',
    editTime    DATETIME     DEFAULT CURRENT_TIMESTAMP NOT NULL COMMENT '修改时间',
    INDEX idx_title (title),
    INDEX idx_summary (summary),
    INDEX idx_userId (userId)
) COMMENT '新闻' COLLATE = utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS t_agent_session (
    id             BIGINT PRIMARY KEY AUTO_INCREMENT,
    sessionId      VARCHAR(64)  NOT NULL COMMENT '会话ID',
    userId         BIGINT       NOT NULL COMMENT '用户ID',
    title          VARCHAR(255) DEFAULT '新会话' COMMENT '会话标题',
    modelName      VARCHAR(100) COMMENT '模型名称',
    status         TINYINT      DEFAULT 1 COMMENT '状态:0结束,1活跃',
    lastMessage    VARCHAR(500) DEFAULT '' COMMENT '最后一条消息',
    messageCount   INT          DEFAULT 0 COMMENT '消息数量',
    summaryContent TEXT         COMMENT '摘要内容',
    summaryAt      DATETIME     COMMENT '摘要时间',
    checkpointData BLOB         COMMENT '检查点数据',
    createdTime    DATETIME     DEFAULT CURRENT_TIMESTAMP,
    updatedTime    DATETIME     DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    expiredTime    DATETIME     COMMENT '过期时间',
    isDelete       INT          DEFAULT 0 COMMENT '逻辑删除',
    pinned         TINYINT(1)   NOT NULL DEFAULT 0 COMMENT '是否置顶：0-否，1-是',
    pinTime        DATETIME     COMMENT '置顶时间',
    INDEX idx_userId (userId),
    UNIQUE KEY uk_agent_session_session_id (sessionId)
) COMMENT 'Agent会话表' COLLATE = utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS t_knowledge_document (
    id          BIGINT AUTO_INCREMENT PRIMARY KEY,
    userId      BIGINT        NOT NULL COMMENT '上传用户id',
    title       VARCHAR(255)  NOT NULL COMMENT '文档标题',
    fileName    VARCHAR(512)  NOT NULL COMMENT '原始文件名',
    fileUrl     VARCHAR(1024) NOT NULL COMMENT 'COS存储地址',
    fileSize    BIGINT        NULL COMMENT '文件大小(字节)',
    fileType    VARCHAR(32)   NOT NULL COMMENT '文件类型:pdf/md/txt/docx',
    chunkCount  INT           DEFAULT 0 COMMENT '分块数量',
    contentHash VARCHAR(64)   NULL COMMENT '内容SHA-256哈希，用于去重',
    status      TINYINT       DEFAULT 0 NOT NULL COMMENT '状态:0=处理中,1=已完成,2=失败',
    createTime  DATETIME      DEFAULT CURRENT_TIMESTAMP NOT NULL COMMENT '创建时间',
    updateTime  DATETIME      DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
    isDelete    TINYINT       DEFAULT 0 NOT NULL COMMENT '逻辑删除',
    INDEX idx_userId (userId),
    INDEX idx_status (status)
) COMMENT '知识库文档表' COLLATE = utf8mb4_unicode_ci;
