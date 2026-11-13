# R5 真实模型预注册实验协议

2026-11-13 经用户显式授权。**本协议在首个真实请求前冻结**，实际候选绑定见 `docs/testing/product-acceptance-r5/live-preregistration.json`。

## 授权记录

- 授权人：仓库所有者（用户），2026-11-13 对话。
- 授权范围：针对 R5 预注册隔离实验的真实模型调用，限定模型、输入样本与实验单元格。
- **独立预算：16 次硬上限**（含失败、超时与并发已发出的请求；不自动重试；未花满不补齐）。
- 输入：**仅合成输入**（1px 合成 PNG + harness 内置合成工程来源文本）；不使用任何患者数据或未授权医学数据。
- 环境：本机 127.0.0.1 一次性隔离 MySQL 8 schema、独立 Redis、loopback HTTP；不触碰生产环境与业务数据库。
- 与 2026-11-12 实验（32 上限、已封存 `restartForbidden`）完全独立：新预注册、新私有目录、新 `RUN_STARTED`、新台账；历史额度永不续用。

## 固定范围

- 主流程单元格：`GRAPH` 与 `COORDINATOR`（各一次，顺序执行，不补跑）。
- 负例单元格：`OOD`、`QUALITY`（同一真实传输，但**必须 0 外部调用**；任一触发请求立即停止）。
- 每 run 产品上限：≤8 次角色请求、单次 20 秒、run 总时长 90 秒；两主流程合计最多 16，与授权硬上限一致。
- 进入 `REVIEW_READY` 时继续走浏览器门禁：管理员分配 → 合成工程医生账号批准 → 患者页面显式授权保存；明确声明这不是执业医生的医学批准。

## 模型与计量

- 模型：`qwen3.5-plus`，temperature=0.2，`enable_thinking=false`，max_tokens=4000，stream=false；保留实际返回模型名。
- 每次网络 I/O 前 CREATE_NEW 落盘 reservation + 请求正文哈希；之后记录 HTTP 状态、响应哈希、request id、usage、耗时、失败类型。
- 货币成本 NOT_AVAILABLE（不按未冻结价格计算）；usage 按实际响应累加；超时用量未知照实标注。
- 密钥只从用户级 `DASHSCOPE_API_KEY` 注入子进程；不入库、不输出、不记录 Authorization。
- 私有原始请求/响应留在忽略目录 `target/r5-provider-private/`；入库只有脱敏台账（哈希 + 元数据）。

## 停止条件

1. 预算达 16 立即停止（`LIVE_EXPERIMENT_STOPPED`）。
2. 提供方 401/403/429 → 停止新调用（已发出并发仍计入）。
3. 负例单元格出现任何真实请求 → 立即停止并记录失败。
4. 无自动重试：SDK/应用不重试；JVM 连接重试禁用、HTTP 重定向禁用。
5. 越界字段（objectKey/userId/taskId/responseProtobufBase64）出现于外发正文 → 立即停止（ledger 内建）。

## 结论边界

报告每单元格实际状态、请求数、usage、失败类型、正常/受限/失败分布；n=2 不外推成功率、性能或医学正确性。合成上游下 `CLINICAL_NOT_EVALUATED`、正常医学/OOD 链路保持独立门禁。

## 证据产物（`docs/testing/product-acceptance-r5/`）

`live-preregistration.json`（首个请求前冻结）· `real-provider-requests.json`（台账）· `real-provider-observations.json` · `real-provider-structure.json` · `real-provider-domain-audit.json` · `live-seal.json` · 截图 · `results.json`（确定性门禁汇总）。
