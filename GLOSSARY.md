# GLOSSARY.md

领域词汇表。架构评审与模块设计以这里的名字为准；新增概念时先在此命名。

## 后端业务

| 术语 | 含义 | 代码位置 |
|---|---|---|
| 诊断记录（Diagnosis） | 一次图片推理的落库结果，自带医疗可靠性证据与人工复核字段，不引用共享推理缓存 | `model/entity/Diagnosis.java` |
| 推理缓存（InferenceCache） | 按图片哈希 + 部署指纹跨用户共享的一行推理结果；仅供复用，不是历史记录 | `model/entity/InferenceCache.java` |
| 证据快照（DiagnosisEvidence） | 从 gRPC 响应一次归一化出的证据，写入诊断记录 / 结果 VO / 推理缓存三处 | `service/DiagnosisEvidence.java` |
| 健康资讯（News） | 面向患者的文章；发布生命周期状态共用一个 `status` 列，不另设审核状态列 | `model/entity/News.java` |
| 发布生命周期 | 0 草稿 → 3 待审核 / 1 已发布 / 2 下架；合法迁移见 `NewsLifecycleService` | `constant/NewsStatus.java` |
| 资讯审计（NewsAudit） | 状态与内容变更留痕，payload 只记字段级 diff，不含富文本正文 | `model/entity/NewsAudit.java` |
| Agent 会话 | 一次智能对话的线程；消息写入由 `ChatMessageWriter` 承担事务 | `agent/service/` |
| MCP 服务 | 用户可启用的外部工具服务，会话覆盖 → 全局启用 → 禁用的解析优先级 | `agent/manager/MCPManager.java` |
| 知识库文档（KnowledgeDocument） | RAG 文档的上传、切块与向量化记录 | `model/entity/` |

## 两个流程状态不要混用

- `reexamineStatus`：**患者**申请复诊的流程状态。
- `humanReviewStatus`：**医生**人工复核结论的状态。

二者在 `t_diagnosis` 中共存但语义独立，合并会破坏已冻结的 API 契约。

## 双线后端

`master` 是 Java 线；`feature/python-backend` 是 FastAPI 线，两条线不再互相合并。
`frontend/` 与 `algorithm/` 下的共享目录各持一份，改动需人工搬运。详见 `docs/backend-split.md`。

## 前端设计

`web/`（React）是产品前端，唯一设计真源是仓库根 `DESIGN.md`（白色仪器 / 信号橙），
令牌实现在 `web/src/styles/tokens.css`；`frontend/`（Vue）是历史线，仍用旧青绿 `--iris-*`，
不再作为设计参考。详见 `DESIGN.md` 与 `docs/backend-split.md`。
