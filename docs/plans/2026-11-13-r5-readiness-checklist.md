# R5 真实模型验收 · Readiness Checklist

2026-11-13 起草。目标：在**单独获得用户授权之后**，以可复现、可审计、预算封闭的方式完成 R5 真实模型验收（评审报告 P0-04/R5）。本文档是**就绪清单与执行协议**，不是执行记录；执行时另立验收卡。

## 前置事实（不可协商的边界）

- **2026-11-12 基线实验已封存**：`docs/testing/product-acceptance-20261112/live-seal.json`（`experimentClosed: true`、`restartForbidden: true`），32 次授权预算实际消耗 11 次，台账与 `target/product-provider-private/RUN_STARTED` 保留。该实验**永不重开、额度永不续用**。
- 证据工具已隔离（2026-11-13）：`scripts/collect_product_acceptance.py` 拆为 `--verify-baseline`（只读校验封存证据）与新候选评估（`--out` 全新目录，拒绝写入/覆盖基线）。旧断言（硬编码 414/339/FAIL_BASELINE_MISMATCH）已移除。
- 2026-11-12 基线结果：Graph 5 请求 → `RESTRICTED/INSUFFICIENT_EVIDENCE`；Coordinator 6 请求 → `RESTRICTED/FEEDBACK_LIMIT`；**正常可复核候选 0/2**。R5 要回答的问题是：在正常合格医学输入下，同样的链路能否产出合法可发布候选——不是重跑基线。

## 1. 输入来源与使用授权

- [ ] **输入图像**：合成工程图像（1px PNG 等）继续用于链路冒烟；**正常医学图像评估**只能使用用户显式授权的公开学术数据集样本（引用出处入验收卡），禁止使用任何真实患者数据、禁止 `algorithm/datasets/DataSet/**`。
- [ ] **OOD/负例**：非医学图像从公开来源选取，逐张列清单并冻结哈希。
- [ ] **受控来源文档**：沿用合成工程文字；如需真实医学文献摘录，单独取得授权并记录出处。
- [ ] **密钥**：只从 Windows 用户级 `DASHSCOPE_API_KEY` 注入子进程；不输出、不入库、不写进任何文档或日志。
- [ ] **数据边界**：只写一次性测试 schema（MySQL 8 :3307 隔离库、独立 Redis、独立 Chroma collection）；不触碰本机业务库、生产库（3306/服务器）。

## 2. 模型配置

- [ ] 锁定模型与参数并在首个请求前冻结进预注册文件：模型 ID、temperature、`enable_thinking`、max_tokens、stream 开关——沿用 2026-11-12 协议口径（`qwen3.5-plus`、0.2、false、4000、false），如需变更须在预注册中显式记录理由。
- [ ] 保留实际返回模型名（`returnedModel`），不假设与请求一致。
- [ ] 推理/对象存储替身口径不变（明确工程替身，不冒充生产组件）。

## 3. 预注册预算

- [ ] 每单元格计划请求次数、负例 0 外呼约束、总硬上限——全部写进 `live-preregistration.json`（新实验目录下），首个请求前冻结。
- [ ] 参考规模：2026-11-12 用「2 主流程 × 每 run 最多 8 次 = 16，硬上限 32」。R5 按实际单元格数重新计算，**硬上限独立于基线 32**，由用户在授权时明确。
- [ ] 预注册文件冻结后，候选源文件（`src/`、`web/`、`pom.xml` 等）任何改动即实验作废——沿用 `freeze_product_acceptance_live.py` 的逐文件哈希校验（该脚本需按新实验目录参数化后再用）。

## 4. 计费与请求记录

- [ ] 每次网络 I/O 之前：CREATE_NEW 落盘独立 reservation + 请求正文哈希。
- [ ] 每次之后记录：发送时间、HTTP 状态、响应哈希、request id、usage、耗时、失败类型；超时请求 usage 未知照实标注。
- [ ] 货币成本：不按未冻结价格计算，报告口径 `NOT_AVAILABLE` + 累计 token usage。
- [ ] 唯一 `RUN_STARTED` 标记：新实验在自己目录下新建；禁止重开实验或重置额度。
- [ ] 私有原始请求/响应留忽略目录；不记录 Authorization，不公开系统提示词与完整模型正文；入库的只有脱敏台账（哈希 + 元数据，2026-11-12 台账形状即范本）。

## 5. 停止条件

- [ ] 预算用尽即停（未发生的调用不补齐）。
- [ ] 提供方 401/403/429 即停止新调用（并行已发送的仍计入）。
- [ ] 任一负例（OOD/质量拒识）触发真实请求立即停止。
- [ ] 无自动重试（SDK/应用层均禁用；JVM 连接重试禁用、HTTP 重定向禁用）。
- [ ] 任何真实医学数据被误用即立即终止并销毁中间产物。

## 6. 判定口径

- [ ] **正常（NORMAL）**：合法进入 `REVIEW_READY`，引用/来源门禁未放宽，事件投影完整。
- [ ] **受限（RESTRICTED）**：`INSUFFICIENT_EVIDENCE` / `FEEDBACK_LIMIT` 等安全终态——如实计数，**不得用受限终态顶替成功闭环**。
- [ ] **失败（FAILED）**：异常引用、校验拒绝、提供方错误、超时——保留原始失败类型分布。
- [ ] 报告成功率、反馈质量（REWRITE/SUPPLEMENT 是否自然发生，不注入冒充）、校验拒绝原因、每单元格请求数；**n 小样本不外推**稳定性/优越性/医学正确性结论。

## 7. 医生复核与患者授权闭环

- [ ] 进入 `REVIEW_READY` 的候选：真实 React 页面走完 医生批准/驳回 → 患者查看逐条依据 → 显式勾选授权 → 唯一保存回执 → 刷新回放一致。
- [ ] 口径：这是**浏览器/领域门禁检查**，不是执业医生的医学批准；验收卡必须原样声明。
- [ ] 未通过门禁时不分配/批准/保存，不补跑同种运行。

## 8. 就绪判定（READY / BLOCKED）

执行前逐项打勾，全绿才能申请真实模型授权：

| # | 项 | 状态 |
| --- | --- | --- |
| 1 | hosted CI 全绿且脱敏证据入库 | ✅ 2026-11-13（`44011b6c` 证据入库；20/20 checks @ `5ea31f1c`） |
| 2 | 证据工具隔离完成（基线只读校验通过、新候选目录护栏验证） | ✅ 2026-11-13（本文档 §前置事实） |
| 3 | 确定性回归全绿（后端全量 + Vitest + Playwright + skip 门禁契约一致） | ✅ 已随 TASK-08B 验证；R5 执行当日需复跑 |
| 4 | 输入清单（含授权来源与哈希）冻结 | ✅ 2026-11-13（仅合成输入，用户确认） |
| 5 | 预注册（预算/单元格/模型配置）冻结 | ✅ 2026-11-13（硬上限 16，`docs/plans/2026-11-13-r5-live-protocol.md`） |
| 6 | 隔离环境就绪（3307 测试库/独立 Redis/Chroma collection） | ✅ 2026-11-13（实验后已全部清理/ DROP） |
| 7 | **用户显式授权真实模型调用与预算** | ✅ 2026-11-13 对话授权（预算 16、仅合成输入） |

**当前结论：EXPERIMENT_CLOSED（2026-11-13 执行完毕，10/16 预算消耗，全部安全停止条件未触发；台账/封存/领域审计在 `docs/testing/product-acceptance-r5/`，报告 `docs/testing/2026-11-13-r5-real-provider-acceptance.md`）。正常可复核候选 0/2 为合成语料限制下的门禁正确行为，RESTART 禁止；如需推进合格语料评估，另立新预注册与新预算。**

离线验证命令（不发请求）：

```sh
python scripts/collect_product_acceptance.py --verify-baseline   # 封存证据只读校验
python scripts/product_acceptance_inputs.py                      # 八输入树不变性
python scripts/check_collaboration_fixture.py --backend-root . --output target/collaboration-contract.json
python -m unittest discover -s scripts/tests -p "test_check_*.py"   # 跳过门禁契约自测
```
