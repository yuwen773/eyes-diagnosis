-- 判读运行的取消状态（#135）。
--
-- 判读是同步接口：一次 POST 里做完推理、上传对象、落库。用户点「取消判读」时
-- 服务端往往正跑到一半。没有一张表记住「这次运行被取消了」，「取消」就只能
-- 是前端的谎言：记录照样落库、COS 里照样留原图，用户刷新 /records 还能看到。
--
-- 为什么独立成表，而不是给 t_diagnosis 加 status 列：
--   1. t_diagnosis 的 url 是 NOT NULL，PENDING 行没有 url 可写；
--   2. 加了状态列之后，列表、统计、复核队列、审计的**每一条**查询都要补
--      「status <> 'CANCELLED'」——漏一条就会把取消掉的判读算进总数，
--      风险落在医疗读数上；
--   3. 本表只承载「这次运行还算不算数」，正式结果仍然只在 t_diagnosis 里，
--      医疗记录表的语义不变。
--
-- 状态机（全部走条件更新，不做读-改-写）：
--   PENDING --claim()--> DONE        合法；claim 与落库在同一个事务里
--   PENDING --cancel()--> CANCELLED  合法；取消赢，本次不落库、原图删除
--   DONE    --cancel()--> 拒绝       结果已生成，不静默删除医疗记录
CREATE TABLE t_diagnosis_run (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    runId VARCHAR(64) NOT NULL COMMENT '客户端为一次判读生成的 UUID；取消时用它定位',
    userId BIGINT NOT NULL COMMENT '发起人；取消只允许本人',
    status VARCHAR(16) NOT NULL DEFAULT 'PENDING' COMMENT 'PENDING / DONE / CANCELLED',
    diagnosisId BIGINT NULL COMMENT 'DONE 时指向 t_diagnosis.id',
    createTime DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updateTime DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uk_diagnosis_run_runId (runId),
    INDEX idx_diagnosis_run_userId (userId, createTime)
) ENGINE = InnoDB
  DEFAULT CHARSET = utf8mb4 COMMENT '判读运行与取消状态';
