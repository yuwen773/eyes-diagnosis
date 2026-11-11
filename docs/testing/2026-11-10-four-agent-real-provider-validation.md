# 四 Agent 真实提供方协作验证

日期：2026-11-10。Java 工作树基点 `74cf7d8246c6fb30ad58bd0497f8e08f94be749f`；工作区仍有前阶段未提交改动。本次按用户明确要求验证四 Agent，实际执行当前 `PatientDraftCoordinator`、`DraftAgents` 和 `ControlledEvidenceRetriever`，没有修改产品协调器、角色提示词、门禁或预算。

## 结论

**真实 `qwen3.5-plus` 的四角色链路已完整成功运行 1 次。最终配置下共 2 个场景：1 个为 `REVIEW_READY`，1 个因无效引用受限；总体为 PARTIAL，不是全部通过。**

本次专门验证四角色协作，以合成推理快照和明确标注的资料资格夹具作为上游，在真实隔离 MySQL 中运行产品协调器和检索器，四个角色均调用真实提供方。输入没有真实患者资料，没有使用模型替身伪造该次四角色输出。

这不是浏览器到真实图像推理再到四角色的联合验证，也不是合格医学资料、医生、患者授权或临床验收。合成快照中的 `IN_DISTRIBUTION` 仅为测试初始状态，不能补作真实 OOD 产物或声称真实图片已通过上游门禁。

## 实际结果

| 验证 | 结果 | 实际范围 |
|---|---|---|
| 既有 `PatientDraftTest` | 27/27，0 failures/errors/skipped | 真实隔离 MySQL，提供方为确定性替身；报告零跳过门禁通过 |
| 当前配置、未显式禁用 thinking | 2/2 在 Vision 超时 | 用户级密钥，沿用单次 20 秒预算；不能计作成功四角色链路 |
| `enable_thinking=false` 的真实提供方运行 | 2 个场景，1 个完整成功、1 个受限 | 相同四角色提示词、检索和校验、8 次/90 秒/单次 20 秒预算 |
| 实际网络请求 | 7/7 返回 HTTP 200 | 受限场景 3 次，完整场景 4 次；不是 7 个独立患者任务 |
| 返回用量 | 输入 4,364，输出 1,490 tokens | 仅这 7 次已返回用量的调用；未估算费用，也不覆盖此前超时等请求 |
| 同任务重放 | 两个场景均未增加提供方请求，冻结报告不变 | 通过 `run` 后的 `inspect` 核对 |
| 未评估 OOD 负向输入 | `RESTRICTED / INVALID_INFERENCE`，0 次调用 | 合成负向快照；未放松实际产品门禁 |

### 完整四角色场景

taskId：`aa36c409-a36b-4c41-9469-921f5dea8c52`。合成输入标签为 `cataract`，总观察耗时约 16.84 秒。

1. **Vision**：真实提供方生成现有推理摘要和限制。
2. **Evidence**：真实提供方生成查询，产品 `ControlledEvidenceRetriever` 从隔离库读取资格夹具，冻结版本 1。
3. **Explanation**：真实提供方生成 6 条声明，包含六个要求区段，逐条引用与冻结片段一致，形成草稿版本 1。
4. **Critic**：真实提供方检查这份实际冻结草稿与证据，返回 `NONE`。协调器最终记录 `REVIEW_READY`。

四条消息均为 `COMPLETED`。独立读取已保存报告，核对同一推理摘要、Vision 结果传入后续角色、Critic 实际收到的草稿和证据、六区段及精确引用，全部一致。Critic 的 `NONE` 不构成医生批准或发布权限。

### 受限场景

taskId：`abed3278-b030-42ff-bdb8-e9541d4d71e4`。合成输入标签为 `glaucoma`。

Vision、Evidence、Explanation 均实际调用模型并返回 HTTP 200。Explanation 将不相邻原文片段用省略号或直接拼接为单条 quote，违反必须为精确连续子串的契约。产品返回 `INVALID_CITATION`，没有保存草稿，也没有继续调用 Critic。本次保留该真实失败，没有自动修补引用、替换模型响应或手动改成成功。

这说明真实模型的引用输出仍存在可靠性问题；安全校验正确拒绝了无效输出。单次完整成功不能据此认定正常流程已具备稳定成功率。

## 连接排查与运行配置

最初按本地 profile 读取凭据时，两个场景各在 Vision 收到 HTTP 401。用户随后指出密钥位于 Windows 用户级 `DASHSCOPE_API_KEY`；最初检查仅覆盖进程环境，漏掉用户级环境。修正一次性运行脚本显式继承用户级变量后继续验证，没有修改用户环境变量或本地 profile，未打印密钥。

独立连通探针仅用于诊断，不属于 Agent 调用计数。旧 profile 凭据在北京及另外三个官方地域端点均返回 `invalid_api_key`；新用户级凭据的 `qwen-plus` 探针返回 `AllocationQuota.FreeTierOnly`，因此没有把它当作可用的替代模型。地域/地址排查依据 [官方 Base URL 文档](https://www.alibabacloud.com/help/en/model-studio/base-url)。本次真正完成四角色的模型是 `qwen3.5-plus`。

用户级密钥下，未显式禁用思考模式的两次四角色尝试均触发单次 20 秒上限。随后仅在验收模型配置增加 `enable_thinking=false`，保留产品预算和提示词，得到上表 1/2 的真实结果。没有通过延长超时或放宽校验取得成功。

## 证据与复跑

- [机器汇总及源码摘要](four-agent-live-20261110/results.json)
- [逐角色独立核对与上下文/输出摘要](four-agent-live-20261110/independent-trace-check.json)
- [实际请求、HTTP 状态与 token 用量](four-agent-live-20261110/http-calls.json)
- [两个场景结果](four-agent-live-20261110/scenario-results.json)
- [各阶段失败与成功的历史](four-agent-live-20261110/attempt-history.json)
- [27 项工程专项结果](four-agent-live-20261110/engineering-suite.json)

原始结构化业务材料、日志和临时运行器位于本工作树忽略目录 `tmp/four-agent-live-20261110/`，不向患者页面返回。没有公开提供方原始思考内容。仓库证据只保存脱敏计数、合成 taskId、角色、摘要和独立核对结果。

运行器最初对 Java 时间数值节点的内存类型做了过严比较，误报成功场景的 Critic 上下文不匹配；独立从同一批 JSON 重读后确认材料逐字段一致。已将临时运行器改为相同 JSON 归一化比较，保留原始报告，没有据此重新触发模型或改写产品状态。初始运行器的总体失败结论仍成立，因为另一个场景确实未完成链路。

现有本地构建与 classpath 下，可执行以下命令创建/复用专用容器并复跑；脚本重新读取用户级密钥，真实发送模型请求并产生费用，失败会返回非零退出码：

```text
pwsh.exe -NoLogo -NoProfile -File tmp/four-agent-live-20261110/run-live.ps1 -DisableThinking
```

本轮专用容器在归档后删除，生成的明文凭据副本已删除；原始模型与数据集未改动。没有提交、推送、修改远端工单、合并或部署。

## 剩余边界

本次没有观察到真实 Critic 提出补证/重写；这些分支的证据仍来自本轮通过的确定性工程专项。真实输入质量、OOD、医学来源资格、医生决定、患者授权保存、临床/生产和真实协作效果比较分别保留原有未完成状态。#15 仍为 PARTIAL。
