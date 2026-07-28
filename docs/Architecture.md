# 系统架构（Architecture Frozen V1.1.1）

> 本文档描述多智能体眼科辅助诊断平台的整体架构。**架构已于 V1.1.1 冻结**，核心语义不可修改（见文末「冻结清单」）。

## 1. 定位

本平台是**多智能体协作的眼科辅助诊断系统**，而非多个 AI 模块的简单堆叠。AI 产出须经「证据校验 → 解释校验 → 人工决策 → 发布」安全链，绝不直接向患者展示原始预测。

## 2. 请求主链路

```
Patient
   │
   ▼
Workflow API  (/api/diagnosis/workflows)
   │
   ▼
Reliable Job（可靠任务调度，含检查点/重试）
   │
   ▼
Graph Segment Runtime（分段图执行）
   │
   ├──────────────┬──────────────┐
   ▼              ▼              ▼
Image Agent    Vision Agent   Evidence Agent
   │              │              │
   │              └──────┬───────┘
   │                     ▼
   │            Risk Explanation Agent
   │                     │
   │                     ▼
   │            Human Review Agent（可选）
   │                     │
   │                     ▼
   │            Final Publication（安全发布）
   │                     │
   └─────────┬───────────┘
             ▼
      Audit + Metrics（审计 + 可观测性，零侵入装饰器挂接）
```

## 3. 智能体职责矩阵

| Agent | 输入 | 输出 | 职责 |
|-------|------|------|------|
| Image Quality | 原始眼底图 Image | Quality Decision | 图像质量判定，不合格则阻断 |
| Vision | 影像包 Envelope | Prediction | 病灶/疾病预测 |
| Evidence | Prediction | Evidence Delta | 证据抽取与校验，产出可追溯 delta |
| Explanation | Evidence | Explanation Snapshot | 生成患者可读的解释快照 |
| Human Review | Snapshot | Decision | 医生复核决策（可选介入） |

## 4. 状态真相（单一来源）

运行时状态仅由以下来源持有，**不存在第二状态机**：

- MySQL：`t_diagnosis_workflow`（Workflow State）、Job State、Review State、`t_workflow_audit_event`（Audit Event）
- Graph Runtime：执行上下文、Checkpoint（仅执行态，非业务状态）

## 5. 安全发布链

```
AI Output → Evidence Validation → Explanation Validation → Human Decision → Publication
```

不存在 `AI预测 → 直接患者展示` 的路径。

## 6. 技术栈

- 后端：Spring Boot 3.5.6 + Java 21 + MyBatis Plus + Flyway（V1–V14）
- 前端：Vue 3 + Vite + Vitest + Playwright
- 基础设施：MySQL 8 / Redis 7 / Chroma / Prometheus / Grafana（docker-compose 全栈）
- 可观测性：Micrometer + Actuator（Prometheus 抓取）
- 审计：append-only 事件表，由运行时装饰器触发

## 7. 冻结清单（Architecture Frozen V1.1.1）

以下语义在 RC/GA 阶段**禁止修改**：

- `WorkflowStatus` / `ReviewDecision` / `GraphDefinition` / Segment 边界
- graph·runtime 路由与提交语义、API Contract、Review Decision Matrix
- 禁止新增 Agent / 业务流程 / 模型调用
- 禁止重构 Graph Runtime / Job Scheduler / Checkpoint
- 后端禁新增标识符：`nextNode` / `nextSegment` / `routeCondition` / `internal.Edge`
- 前端禁：`rawPrediction` / `topK` / `modelScore` / `abstainReason`
- 审计表 append-only（Repository 不暴露 update/delete）

> 待补充：各 Agent 内部 prompt/工具清单、Graph 版本演化记录、Checkpoint 存储格式细节。
