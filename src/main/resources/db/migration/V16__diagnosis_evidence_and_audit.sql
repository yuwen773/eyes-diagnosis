-- ② 诊断证据归一 + ③ 复核事务边界的 schema 部分
--
-- ② 同一个 SHA-256 概念在两处宽度不一致：V5 给 t_diagnosis.weightSha256
--    VARCHAR(128)，V7 给 t_inference_cache.weightSha256 VARCHAR(64)。
--    归一为 64（十六进制 SHA-256 恰好 64 字符），与 V2 的 imageHash 一致。
--    现有值都是 64 字符哈希，缩短无数据丢失。
--
-- ③ recordHumanReview 是 read-modify-write 且无版本列，并发复核会丢失更新。
--    加 version 列，由 MybatisPlusConfig 的 OptimisticLockerInnerInterceptor
--    与 Diagnosis 实体上的 @Version 驱动。审计复用 V5 已建的 t_diagnosis_audit
--    及其 payload JSON 列，无需改表。
--
-- 不动 V1--V15。每条迁移由 Flyway 保证只执行一次，无需 information_schema
-- 幂等判断（V8 那种动态 DDL 是为「手动对齐过的旧库」准备的，此处无此情形）。

-- ② 归一权重哈希宽度
ALTER TABLE t_diagnosis
    MODIFY COLUMN weightSha256 VARCHAR(64) NULL COMMENT '权重 SHA-256（与 t_inference_cache 一致）';

-- ③ 诊断记录乐观锁
ALTER TABLE t_diagnosis
    ADD COLUMN version BIGINT NOT NULL DEFAULT 0 COMMENT '乐观锁版本' AFTER humanRecommendations;
