# PR #68 合并前兼容性修复验收

日期：2026-11-14。本记录是提交前的本地验收快照，当时的候选为 `codex/realtime-product-acceptance` 上相对
`f7e0f81d672bf451eb28d0433babe60037ec7df0` 的未提交工作区变更。
本记录只验收本轮修复，不代替 `7c028b80` 之后整个增量的新 HEAD 最终合并审查。
PR 总体仍按 `REVIEW_FINDINGS` 管理，旧 `MERGE_READY` 不可沿用。

## 修复行为

- 新历史中的白名单标签恢复工具卡；一条消息中的多个调用各自成卡，同名调用保留顺序。
  旧 `toolName: JSON` 历史只恢复已知工具的固定标签，未知名称显示通用标签。
  历史工具调用参数（含损坏 JSON）不再进入展示消息，不恢复 `_raw`，不改数据库原文。
  没有执行结果或关联 ID 的历史卡不推断完成状态。
- 确认事件只按 `toolCallId` 关联请求；流结束保留 `awaiting-confirm`，无 ID 确认不按标签猜测。
  相同 ID 的请求和确认去重；状态先于请求到达时补齐卡片而不重置结果。
  成功、失败和取消终态不被重复或迟到事件覆盖；实际恢复执行或收到结果后移除对应暂停通知。
- `MessageDTO` 继续采用类级 `NON_NULL`，明确所有 null 字段（包括旧字段）均省略，
  不承诺字节兼容。Java 测试固定序列化形状；前端通过实际 SSE 消费入口验证显式 null 与字段省略。
- [发布手册](../collaboration-release-runbook.md) 补充 V28 缺失已应用迁移导致旧产物启动失败的限制；
  未实施旧二进制回退或数据库快照恢复演练。

## 本轮执行证据

所有输入与响应均为合成夹具，未调用真实模型或使用患者数据。

| 检查 | 结果 |
| --- | --- |
| 修复前反馈循环：`agentStream` reducer、hook、历史卡组件测试 | 35 项中 14 项失败，捕获标签退化、多步骤合并、确认误取消及终态覆盖；修复后 35/35 通过 |
| 产品前端 `typecheck` / `test` / `lint` / `build` | 全部通过；最终 39 files / 371 tests；构建仅有既有大 chunk 提示 |
| JDK 21 `scripts/verify.sh -B`，一次性 MySQL 8 + Redis | 两遍均成功，最终 `verify green`；73 suites / 565 tests / 0 failures / 0 errors / 297 skips |
| 其中 Flyway / UploadTaskMapper / ToolAudit MySQL 集成 | 7/7，0 skips；迁移到 V28；一次性容器已自动清理 |
| `check_surefire_skips.py` 的 backend-unit / flyway 契约 | 通过；297 skips 均为环境门控。第二遍集成覆盖后的报告按实际 `FLYWAY_TEST_URL` 已设置的语义检查 |
| `check_collaboration_fixture.py --backend-root .` | 16 类事件 / 12 个快照字段一致；前端全套包含协作事件消费与 reducer 回归 |
| `check_steering_docs.py` / `git diff --check` | 通过 |
| `collect_product_acceptance.py --verify-baseline` | `VERIFIED`，18 个证据文件，`experimentClosed=true`；未重新采集或重启 R5 |

后端 297 个环境门控跳过不等同于专项通过：本轮没有重跑协作 MySQL、Graph 跨进程、
真实提供方、完整浏览器或生产验收。Surefire 第一次汇总检查在未继承脚本内
`FLYWAY_TEST_URL` 时误按“应跳过集成用例”判定，按两遍验证实际环境校正后通过；
未修改门禁或重跑测试来掩盖该检查环境差异。

两路只读源码审查分别为 `STANDARDS_PASS` / `SPEC_PASS`，包含最后新增的 SSE 测试和回退说明；
审查报告不替代上述执行证据，也不构成合并放行。

## 保留边界与后续

- 本轮只处理历史工具调用卡的展示边界。实时 SSE 参数、旧确认/结果正文、存量记录清理及 C1 导出策略仍需独立明确，
  不能把本轮结果写成所有历史和导出均已脱敏。
- 审计与 B2 来源策略继续默认关闭；医疗协作生产启用仍为 `BLOCKED`。
  审计启用前先定义稳定执行身份和事件去重语义，再设计 V29+ 唯一约束；
  参数键名白名单/长度、独立密钥及审计写入失败的可观测性仍是独立治理工作。
  本轮未修改已应用迁移、审计实现或任何生产开关。
- 截至上述本地验收结束，尚未提交、推送、转换 Draft、合并或部署，也没有新提交 SHA 或对应 hosted CI；
  不能沿用旧 HEAD 的 CI 证明工作区候选。后续仍需提交后的完整 CI、按新 HEAD 的最终增量审查及正常合并审批。
- 两份原有未跟踪报告保留，R5 封存材料未改。
