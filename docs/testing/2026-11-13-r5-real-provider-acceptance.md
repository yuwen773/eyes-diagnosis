# R5 真实模型预注册实验报告

2026-11-13 · 协议 `docs/plans/2026-11-13-r5-live-protocol.md`（首个请求前冻结）· 预注册 `live-preregistration.json`（825 文件哈希）
授权：用户显式授权，**独立预算 16 次硬上限**（与 2026-11-12 的 32 次历史额度完全独立，历史实验未重开）。

## 结论（先读）

**两个主流程单元格（GRAPH、COORDINATOR）均为 RESTRICTED / INSUFFICIENT_EVIDENCE，正常可复核候选 0/2**；负例单元格 OOD/QUALITY 如约束保持 0 外部请求。实验按停止条件自然结束，预算消耗 **10/16**，未花满不补齐。

**这个受限结果是证据门禁的正确行为，不是失败事故**：根因是合成语料库仅 2 个 chunk（"Synthetic glaucoma follow-up requires an eye examination." / "Synthetic monitoring is individualized by an ophthalmologist."），而真实模型 CRITIC 如实指出每条 claim 的引用不足以支撑具体论断（如「引用文本未包含图像质量评分信息」「摘录未提及概率校准」），SUPPLEMENT 重检索后候选引用集合无法增长，`INSUFFICIENT_EVIDENCE` 门禁拒绝发布。**不得为了变绿放宽引用/来源门禁**（评审 P0-04 明文约束）。与 2026-11-12 基线结论一致且方向相同：合成上游下模型行为可信，正常医学语义评估（CLINICAL_NOT_EVALUATED）仍是独立未决门禁。

## 实验事实

| 项 | 值 |
| --- | --- |
| 模型 | `qwen3.5-plus`（请求固定；每次响应 returnedModel 一致），temperature 0.2、`enable_thinking=false`、max_tokens 4000、stream=false |
| 真实请求 | **10/16**（GRAPH 5 + COORDINATOR 5），全部 HTTP 200，全部 `RETURNED` |
| 自动重试 | 0（ledger `automaticRetries: 0`；JVM 重试禁用、重定向禁用） |
| usage | 累计 6,929 tokens（按响应实际累加）；货币成本 NOT_AVAILABLE |
| 耗时 | 单请求 1.4s–11.3s |
| 负例 | OOD/QUALITY 各 1 run，均 RESTRICTED，**0 次外部请求**（隔离传输验证通过） |
| 密钥 | 仅从用户级环境变量注入；31 个私有文件 + 全部入库证据 sk- 扫描 CLEAN；台账无 Authorization |

### 结构化输出质量（真实模型，合成上下文）

- 10/10 响应为合法 JSON，键形与角色 schema 完全一致：VISION `{summary, limitations, reanalysisSuggestion}`、EVIDENCE `{query}`、EXPLANATION `{evidenceVersion, claims}`、CRITIC `{action, objections}`。
- 两次 CRITIC 均输出 `SUPPLEMENT`（3/5 条 objections），objection 指向具体 claim/引用——**反馈是自然发生**（协议禁止注入冒充，实际未注入）。
- VISION 摘要带 limitation 计数（3 条），与 `agent.summary` 投影联动（`VISION_REVIEW_QUALITY:RECAPTURE, limitationCount 3`）。

### 事件投影（70 事件 / 2 run）

`agent.summary`（患者面）8 条全部为受控标记；`agent.readable`（医生面）14 条为已校验结构化输出——TASK-08B 双投影在真实模型输出下工作正常。患者面未见任何临床正文，`run.restricted` 终态如实呈现。

## 审计证据链（`docs/testing/product-acceptance-r5/`）

- `live-preregistration.json`（冻结于首个请求前；运行后逐文件哈希复核 **NONE drifted**）
- `real-provider-requests.json`（脱敏台账，10 行：哈希、request id、usage、耗时、状态）
- `live-seal.json`（`experimentClosed + restartForbidden`；ledger/预注册哈希自校验通过）
- `real-provider-observations.json` / `real-provider-structure.json` / `real-provider-domain-audit.json`（领域副作用：review/authorization/diagnosis 全部 0——受限终态未产生任何越权写入）
- `real-graph.png` / `real-coordinator.png`（真实浏览器终态截图）
- 私有原始请求/响应 31 文件在 `target/r5-provider-private/`（不入库，含唯一 `RUN_STARTED`）

## 执行备注（如实记录）

1. 首次 server 启动被**历史实验的 stop-file 残留**（`target/product-real-server-stop`）立即终止：0 请求发出，空 `RUN_STARTED` 在验证台账 0/16 后替换——预算从未被触碰。
2. 预注册第一次冻结后因候选源修改（stop-file 前缀修正）触发哈希护栏拒绝启动；因当时仍为 0 请求，**合法重新冻结**（协议允许：作废零成本实验）。护栏本身按设计工作。
3. 实验结束后清理：live server / Vite / 一次性 Redis :16379 全部停止，隔离 schema `product_provider_test`、`product_acceptance_test` 已 DROP。生产库（3306 业务库、服务器）未触碰。

## 门禁状态

| 门禁 | 状态 |
| --- | --- |
| 真实模型链路（受理→四角色→事件→安全终态） | ✅ PASS（n=2，合成上游） |
| 正常可复核候选（REVIEW_READY → 医生批准 → 患者保存） | ❌ 0/2——受合成语料限制，属门禁正确行为；需合格语料才能评估 |
| 正常医学输入 / OOD 真实样本 / 临床评估 | NOT_EVALUATED（独立门禁） |
| hosted CI / 生产部署 | 不在本轮范围 |

## 下一步（不自动执行）

1. 若要评估「合格语料下能否 REVIEW_READY」：需扩充受控来源语料（新的授权范围），**新预算、新预注册**，不重开本轮。
2. 正常医学语义评估需授权的公开医学数据集（用户已选择本轮仅合成输入）。
3. 本轮结果已封存（`restartForbidden`），任何复现须走全新预注册。
