# R3 Agent 验收证据

这些截图由 `web/scripts/evidence/r3-agent-acceptance.mjs` 在真实 Chromium 里生成，
复跑：

```bash
cd web
# 1) 另开终端起前端（无需后端也能跑：会话/历史/SSE 全部合成）
VITE_PROXY_TARGET=http://localhost:18081 npx vite --port 5199 --strictPort
# 2) 采集
ACCEPT_BASE=http://localhost:5199 node scripts/evidence/r3-agent-acceptance.mjs
```

**边界**：SSE 分片由页面内补丁的 `fetch` 按时间逐条吐出，会话与历史接口由 Playwright
拦截；渲染、滚动、停止、主题、视口、时区换算走产品代码。真实模型链（真 SSE + 真工具）
由 `r3-agent-real-backend.mjs` 单独验证，两者不互相代替。

| 文件 | 场景 | 看什么 |
| --- | --- | --- |
| `light-rich-streaming-1440.jpg` | 流式中 | 标题/列表已成形，光标仍在，表格还没出现（不过早显示半张表） |
| `light-rich-final-1440.jpg` | 流结束 | 标题、列表、表格、引用、代码块的层级与行距 |
| `dark-rich-final-1440.jpg` | 深色同上 | 深色下同一套层级与对比 |
| `dark-rich-final-375.jpg` | 375px | 窄屏不横向溢出，正文仍是读物宽度 |
| `dark-tool-error-1440.jpg` | 工具失败 | 状态「失败」+ 一句「不能当作医学证据」，结果与参数分层 |
| `light-tool-multi-1440.jpg` | 两工具乱序返回 | 两步各自配对，都显示「完成」，不串结果 |
| `light-tool-missing-1440.jpg` | 无回执 | 「未确认」只陈述事实，不承诺回执、不谎报完成 |
| `light-history-1440.jpg` | 历史恢复 | 工具结果回放为「完成」；UTC 10:20 显示为本地 18:20 |

完整断言表与全部截图在 `web/test-results/r3-acceptance/report.json`（不提交，可复跑再生）。
