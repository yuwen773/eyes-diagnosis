# 用户指南（User Guide）

> 面向四类角色：患者 / 医生 / 管理员 / 审计员。演示环境见 Deployment.md 账号表。

## 1. 角色与权限矩阵

| 角色 | 可见/可执行 | 入口约束 |
|------|-----------|---------|
| 患者（USER） | 创建诊断、查看本人结果（仅白名单投影） | 不能查看原始 AI 预测 |
| 医生（DOCTOR） | 复核任务认领/提交、查看解释快照 | `/reviews/*` |
| 管理员（ADMIN） | 用户/新闻/诊断管理 | 后台管理 |
| 审计员（AUDITOR） | 只读审计事件网关 | `/audit/*` |

权限校验由 `AuthInterceptor.allowed()` 统一 switch 实现；审计网关为只读，无写接口。

## 2. 患者流程

1. 登录 demo_patient。
2. 进入诊断创建页，上传眼底图，提交。
3. 系统经多智能体流水线处理（SSE 实时推送进度）。
4. 完成后在结果页查看**白名单投影**（仅 `diseaseCode` + `calibratedProbability` + 通用说明），不含原始模型内部字段。

## 3. 医生复核流程（仅当系统判定需人工介入）

1. 登录 demo_doctor。
2. 进入 `/reviews/tasks` 查看待办（状态 OPEN）。
3. `claim` 认领 → 查看解释快照与证据 → 提交决策（approve / revise / reject）。
4. 提交后工作流 `Resume` 继续，结果按决策发布或回退。

## 4. 审计员流程

1. 登录 demo_auditor。
2. 进入审计网关，按 `workflowId` 查询该工作流的全部 append-only 审计事件
   （AI_INFERENCE_COMPLETED / EVIDENCE_VALIDATED / EXPLANATION_PUBLISHED /
   REVIEW_ASSIGNED / REVIEW_COMPLETED / RESULT_EXPOSED）。
3. 仅查看，无修改入口。

## 5. 安全发布说明

- 患者端结果经过「证据校验 → 解释校验 → 人工决策 → 发布」链条，绝不直接暴露 AI 原始预测。
- OOD（分布外）案例由模型拒识，结果按 LIMITED 通用文案下发给患者。

> 待补充：各角色截图、异常态（取消/失败/超时）处理说明、密码修改流程。
