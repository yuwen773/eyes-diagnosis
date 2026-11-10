-- 健康资讯的业务建模：状态流、审核留痕、运营维度、软删除
--
-- 基点 fix/db-schema-deepening（含 V15 建的 t_news、V16）。编号 V17 避开
-- 其它分支占用的 V10--V14 与本线的 V15/V16。
--
-- 业务问题：
--   1) status 只有 0/1/2（草稿/已发布/下架），没有「待审核」。管理员一按
--      「发布」内容就对患者可见，医疗资讯缺少复核环节。
--   2) 没有任何审核留痕：谁在什么时间把文章从什么状态改成什么状态、
--      为什么下架，事后无从回答。
--   3) 前端 NewsPage.vue 的「精选」是取列表第一条硬编码的，运营无法指定；
--      库里没有分类字段，内容运营维度全靠正文里手写。
--   4) deleteNews 是物理 DELETE，删了连「曾经有过这篇文章」都查不到；
--      「下架」与「删除」在业务上是两件事，现在只有一行 status。
--
-- 设计决定：扩展既有 status 的数值词汇（3=待审核），不新增第二个状态列。
--   0/1/2/3 同属「发布生命周期」一个维度，并列两列正是诊断表里
--   reexamineStatus / humanReviewStatus 那种双写漂移。
--
-- 兼容性：
--   - 全部新列可空或带默认值，21 条生产数据无需回填即可读到。
--   - 不引入 CHECK：3306 是 MySQL 5.7，会解析但不执行；值域由 Java 侧守卫。
--   - isDelete 沿用 application.yml 全局 logic-delete-field: isDelete 的
--     小驼峰命名与 0/1 取值，与 t_user / t_diagnosis 一致；
--     ALTER 带 DEFAULT 0 NOT NULL，存量行自动为「未删」。
--   - 存量 status 值保持不变（0/1/2 语义未改），无需 UPDATE 回填。

-- P1：审核人/时间与审核意见
ALTER TABLE t_news
    ADD COLUMN submittedById BIGINT NULL COMMENT '提交审核人 id' AFTER status,
    ADD COLUMN submittedAt DATETIME NULL COMMENT '提交审核时间' AFTER submittedById,
    ADD COLUMN reviewedById BIGINT NULL COMMENT '审核人 id' AFTER submittedAt,
    ADD COLUMN reviewedAt DATETIME NULL COMMENT '审核时间' AFTER reviewedById,
    ADD COLUMN reviewNote VARCHAR(512) NULL COMMENT '审核意见 / 驳回理由' AFTER reviewedAt;

-- P2：运营维度、下架原因、软删除
ALTER TABLE t_news
    ADD COLUMN category VARCHAR(32) NULL COMMENT '内容分类（可空：生产库 21 条历史数据无分类）' AFTER reviewNote,
    ADD COLUMN source VARCHAR(255) NULL COMMENT '来源出处' AFTER category,
    ADD COLUMN featured TINYINT NOT NULL DEFAULT 0 COMMENT '是否精选：0-否 1-是' AFTER source,
    ADD COLUMN offlineReason VARCHAR(512) NULL COMMENT '下架原因' AFTER featured,
    ADD COLUMN isDelete TINYINT NOT NULL DEFAULT 0 COMMENT '逻辑删除：0-未删 1-已删' AFTER offlineReason,
    ADD INDEX idx_status (status),
    ADD INDEX idx_featured (featured),
    ADD INDEX idx_category (category);

-- P1：状态变更与内容变更的审计轨迹。
-- payload 只承载「改了哪些字段」的字段级摘要，不复制富文本正文全文。
CREATE TABLE IF NOT EXISTS t_news_audit (
    id           BIGINT PRIMARY KEY AUTO_INCREMENT,
    newsId       BIGINT       NOT NULL COMMENT '新闻 id',
    actorId      BIGINT       NULL COMMENT '操作人 id',
    actorRole    VARCHAR(24)  NULL COMMENT '操作人角色',
    action       VARCHAR(32)  NOT NULL COMMENT '动作: EDIT / SUBMIT_REVIEW / APPROVE / REJECT / PUBLISH / OFFLINE / DELETE',
    fromStatus   VARCHAR(24)  NULL COMMENT '变更前状态',
    toStatus     VARCHAR(24)  NULL COMMENT '变更后状态',
    payload      JSON         NULL COMMENT '变更摘要（字段级 diff，不含正文全文）',
    createdTime  DATETIME     DEFAULT CURRENT_TIMESTAMP COMMENT '发生时间',
    INDEX idx_news (newsId),
    INDEX idx_createdTime (createdTime)
) COMMENT '新闻状态与内容变更审计' COLLATE = utf8mb4_unicode_ci;
