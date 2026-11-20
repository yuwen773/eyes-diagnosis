# UI 门禁与冒烟修复（2026-11-15）

## 范围与来源

- Parent：PR #85 后的 `ui`，`7ec746fb8a82fc371a2818d5180177027dcc4cdd`。
- 候选：PR #86，`chore/agent-env-retro`；本轮代码提交 `b9659a446ac9e1571c0b056d8c6461349d324b59`。
- 代码提交相对 Parent：6 个提交、14 个变更文件；本报告随后作为文档增量加入。
- `git merge-base --is-ancestor ui b9659a4`：exit 0，继承 UI 基线。
- 冻结 tag `iris-ui-v2.1-freeze-20261115` 不移动；`AgentPage.tsx` 与 `tokens.css` 对冻结 tag 的 diff 为空。

## 已修复

1. #81 的三条 smoke 隔离恢复为执行：记录同时验证空态和合成记录展开，资讯按可访问名称定位，Agent 采用本地 SSE 并拦截自动标题请求。fixme 预算从 3 降为 0，登记清空。
2. fixme 登记必须包含非空文件、标题、原因和有效 issue；SHA 例外必须有合法引用及非空原因。无法解析的图片计数直接失败。新增实际执行脚本的 Node 正负例，接入 CI。
3. `CLAUDE.md` 与 `DESIGN.md` 删除易漂移的“当前 ui tip”副本，只保留冻结时的历史事实。

## 实跑验证

| 验证 | 结果 | 证据边界 |
|---|---|---|
| `npm test` | 51 文件、434/434 | Vitest |
| `npm run build` / `npm run lint` | PASS | build 包含 TypeScript；有既有大包体积提示 |
| `npm run check:e2e-fixme` | 0/0，exit 0 | 不再有隔离项 |
| `npm run check:gate-tests` | 3/3，零 skip | 三类缺口均先红后绿；临时仓库中执行实际脚本 |
| `npm run check:report` | exit 0 | 完整克隆，SHA 严格；图片计数与路径严格 |
| 有凭证的 `playwright test e2e/smoke.spec.ts` | 4/4，零 skip | 真 Spring 登录、独立 MySQL/Redis；记录、资讯与 SSE 是合成夹具 |
| Agent 结束状态断言加强后的定向检查 | 1/1 | 断言“发送”按钮恢复及输入框清空 |
| 缺凭证运行同一 smoke | 4 skipped | 保留原有整体 skip 契约，不记通过 |

首次浏览器执行为 2 passed / 2 failed，失败来自本轮新增定位与实际 DOM 不符：空态为“还没有属于你的判读”，资讯标题中的链接没有嵌套 heading。根据失败 DOM 与截图修正定位后，四条全部通过；没有更改产品代码或放宽内容断言。

本地浏览器使用已有 Chromium 修订号 1234，属于兼容回落证据；CI 标准浏览器仍须由匹配版本的 `playwright install` 安装。这里不宣称真实模型、完整推理或临床验收。

## 独立审查

- `1fca4e00..b9659a4`：Standards **PASS**，Spec **PASS**，两位只读审查员，发现数均为 0。
- 原 `7ec746fb..1fca4e00` 的三条 Spec 缺口与一条 Standards 文档问题已由上述增量处理。
- 该结论来自代码及规格核对，不以 CI 绿灯替代审查。

## 分支衔接

后续多 Agent 集成必须继承此候选，再在最终 UI 基线上做 ancestry 检查。此报告不授权将多 Agent 合并进 UI，也不构成部署或临床启用依据；两个候选仍通过各自 PR 交付。多 Agent 运行时、完整后端验证及其剩余项记录在该分支的独立报告中。
