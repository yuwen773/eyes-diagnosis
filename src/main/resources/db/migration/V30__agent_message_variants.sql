-- 重新生成（消息版本）。
--
-- 同一轮用户提问可以有多份回答：每次重新生成写一条新的 variantId，
-- 旧版本整组保留，用户可在界面上切换。设计取舍：
--
--   * replyToId   —— 回答侧每一行指向本回合的用户消息行；null 表示旧数据。
--   * variantId   —— 同一次生成产生的 reasoning / tool-call / tool-* / text
--                    共用同一个值；整组一起显示或一起隐藏。
--   * selectedVariantId —— 只写在用户行上，表示当前显示哪一份。null = 旧数据
--                    （只有一份），读取时按「全部可见」处理。
--
-- 不加外键：历史行的清理依赖会话删除，跨表级联会把审计行一起带走。
ALTER TABLE t_agent_message
    ADD COLUMN replyToId BIGINT NULL COMMENT '回答侧行所属的用户消息 id；旧数据为 null',
    ADD COLUMN variantId VARCHAR(64) NULL COMMENT '同一次生成产生的一组行共用；旧数据为 null',
    ADD COLUMN selectedVariantId VARCHAR(64) NULL COMMENT '仅用户行：当前显示的回答版本';

CREATE INDEX idx_agent_message_reply ON t_agent_message (sessionId, replyToId);
