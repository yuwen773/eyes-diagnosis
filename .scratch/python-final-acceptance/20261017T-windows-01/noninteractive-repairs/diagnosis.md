# 非人工修复记录

目标工作树：`worktree-py-rewrite`；本轮 runId 沿用 `20261017T-windows-01`。
人工环节按用户最新要求搁置，没有自动提交医生决定或保存授权。
修改前材料/实现快照：`../20261017T115952Z-preflight-926694/`。

## 结构化解释超时

- 原生产请求包含 JSON 模式与正确格式提示，但未明确禁用思考模式。
- 仅为测量，在共用计数器后以原请求字节、较长诊断读取预算调用真实供应商：50.375 秒才收到响应，usage 中 reasoning_tokens=1811，正文 11,497 字节。诊断未作为原生产适配器通过证据；原 10 秒读取超时、15 秒期限与 Worker 30 秒租约仍有效。完整元数据见本目录 `*-provider-timing.json`，未保留密钥或供应商正文。
- `test_structured_explanation_uses_non_thinking_provider_mode` 在原 HTTP→Worker 场景先失败为 QUEUED；将请求改为 `enable_thinking:false`、一条短引用、max_tokens=512，并对显式配置的供应商地址禁用隐式环境代理。没有扩大超时、租约或请求重试次数。
- 相关 31 项回归通过，包含超时/连接/限流/服务失败/期限耗尽与恶意、数字、不支持来源等校验。RED/GREEN 见 `explanation-red.*` 和 `explanation-green.*`。
- 修复后的真实生产适配器预检通过：`../20261017T120326Z-providers-25d849/`。一份草稿、原文引用及引用 ID 校验通过；供应商参数依据：[Model Studio Chat API](https://www.alibabacloud.com/help/en/model-studio/qwen-api-via-openai-chat-completions)、[结构化输出](https://www.alibabacloud.com/help/en/model-studio/qwen-structured-output)。

## 真实已审核资料的检索与解释

以原 EvidenceRetriever、真实 MySQL/Chroma/embedding/ExplanationModel 和声明校验验证，使用既有真实推理包只读绑定；不执行图恢复、解释发布、复核或保存。

- 首次：`../20261017T120702Z-reference-explanations-0fa8bf/`。白内障通过；正常/近视引用或数值内容被安全校验拒绝，原记录保留。
- 提示词明确现有的原文引用 ID、无数值声明和无治疗指示要求，校验器本身未放宽。一次受影响场景复验：`../20261017T120802Z-reference-explanations-58285e/`。
- 最后一次正常资料 2.953 秒、白内障 2.203 秒，均 VALIDATED 且引用为原文；近视 2.828 秒，原文抽取仍含数值声明，REJECTED / UNSUPPORTED_NUMERIC_CLAIM。超时已消除，但近视可发布解释仍阻塞；遵守计划的一次复验限制，不继续反复调用或降低规则。
- 两次取证前后 8 张业务表摘要均一致，临时 Chroma 进程均按登记身份停止。没有把适配器/检索取证冒称完整生产图及人工闭环。

## 全量测试的空 JSON 响应

- 历史失败：`../windows-web-final/web.xml`，原重复复核提交在 Worker 前进后收到空正文，`.json()` 失败。同项原样单独重跑通过：`restart-baseline.*`（31.02 秒）。
- 当前机器 HTTPX 默认客户端实际装载了指向本机系统代理的 http/https transports；本机 API 测试没有设置 trust_env=False。
- 新增本机可控代理，只在原场景第三次提交（Worker 前进之后）返回 HTTP 200 空正文；其余请求转发至真实测试 API。原测试在历史同一行复现 JSONDecodeError，见 `proxy-red.*`。这是受控因果复现，历史缺少响应头，不能声称捕获了历史代理原包。
- RestartCase 的本机 HTTP 客户端显式 `trust_env=False` 后，代理测试证明无请求经过代理；原质量/最终复核重启场景保持全部断言，无重试、放宽、skip 或 xfail。
- 新代理回归及原两项重启用例共 3 passed，84.60 秒，见 `proxy-green.*`。

## 后续验证

Windows Web 通过原 `scripts/verify.py web` 运行，输出到 `../windows-web-repaired/`，历史全量不覆盖。
最终结果：824 passed、43 skipped、1 条既有警告，0 failed，768.63 秒；原验证入口退出码 0。依赖检查、冻结迁移 baseline-check、退休扫描及入口要求的 7 文件类型检查一并通过。修改文件另行类型检查通过。
前端重新执行 build（包含类型检查）及测试：49 项通过，见本目录 `frontend-result.json` 与日志。
调用累计 LLM 14/50，embedding 37/500；后续不再外发供应商请求。

两项指定缺陷的修复验证完成。整体验收仍因人工搁置、近视资料声明扣留等保持 BLOCKED，第 21 票不关闭。
