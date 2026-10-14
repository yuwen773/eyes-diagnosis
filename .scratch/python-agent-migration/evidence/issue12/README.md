# 工单 12 受控验收记录

日期：2026-10-14。目标：`worktree-py-rewrite`，开始 HEAD：`15d29698974f24ec327cd4e3727a8d22610d7d72`。已有工单 9–11 等未提交改动，测试在该工作区上执行，提交仅纳入工单 12 自身的增量。

| 验证 | 结果 | 边界 |
| --- | --- | --- |
| `pytest web/tests/test_supplement.py -q` | 13 passed | 真实 HTTP/SSE/图及 SQLite；Java 身份与模型为替身 |
| `pytest web/tests -q` | 585 passed, 1 skipped | 使用指定 Corretto JDK 21，受控 Web 全量 |
| 前端 `npm run test -- --run` | 42 passed | 11 个测试文件 |
| 前端 `npm run build` | PASS | 含 Vue 类型检查；已有大 chunk 提示，不阻止构建 |
| 定向 mypy | PASS | `chat/supplement.py`、`chat/session.py`、`schemas/supplement.py`、`routers/agent.py`、`routers/review.py`、`schemas/review.py` 六个模块 |
| Chromium 实际页面 | PASS | `issue12-ui-results.json`，真实后端进程重启和网络回执丢失 |

全仓直接运行 mypy 曾报告 user/news/diagnosis/mcp_server 及相关测试的现有诊断；本票没有修改这些模块，六模块定向通过不等于全仓类型检查通过。首次全量运行漏设 JDK 21，导致两个 Word 解析测试失败；设置项目指定 JDK 后，失败项和最终全量均通过。新增的两个 HTTP 路由已登记在精确端点契约清单中，未放宽契约断言。

## Standards

独立只读审查：0 项可操作发现。变更范围、Vue Composition API、身份检查、会话/请求锁顺序、等待版本 CAS、checkpoint 与业务状态事务以及异步 UI 关联防护符合本票范围。审查没有验证真实 MySQL 锁行为。

## Spec

独立只读审查：0 项可操作发现。五项判据有对应实现；显式补充入口属于工单允许的实现选择，未增加模型追问识别或自由文本临床路由。待补充交互与临床任务/医生复核分别保持原语义。

总计：Standards 0、Spec 0，无阻塞问题。

## 证据与限制

- `issue12-waiting.png`：桌面等待和回复入口。
- `issue12-dark.png`：深色等待表单。
- `issue12-mobile.png`：窄屏独立回复表单；聊天页原有侧栏布局不属于本票重构范围。
- `issue12-resumed.png`：回复持久化后刷新恢复。
- `issue12-ui-results.json`：四组浏览器验证，页面脚本错误 0。

真实 MySQL V21 迁移/并发锁、Java/Redis 集成、真实模型及生产部署/回滚均未执行。工单状态为 `ready-for-human`；不能将这些受控结果当作完整迁移验收。
