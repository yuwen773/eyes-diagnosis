# Python 登录鉴权与前端接线（完整迁移工单 02）

2026-10-15，`worktree-py-rewrite`。本记录属于 `.scratch/python-project-migration`，
不同于历史 Python Agent 迁移的上传工单 02。依赖工单 01 的已验证数据库基线。

## 当前行为

三个会话端点和集中鉴权由 Python 提供。Nginx 不再将任何 user 路径固定到 Java。
默认 Cookie 为 `EYE_SESSION`，Path=/、HttpOnly、SameSite=Lax，浏览器最长保留 30 天；
Redis 使用 `eye:py:session:{sid}`，仅存字符串 userId，默认 1800 秒闲置超时。
有效访问刷新现存 key 的 TTL，已撤销/过期 key 不会重建。HTTPS 部署显式设置
`SESSION_COOKIE_SECURE=true`；本地 HTTP 默认为 false。

每请求从当前 `t_user` 解析身份与角色，逻辑删除立即失效；同步数据库读取在线程池
执行。原 BCrypt 与遗留 MD5 密码仍可登录，MD5 升级在成功响应前提交。
每次登录轮换随机会话 ID 并撤销旧 ID，退出删除 Redis key 和 Cookie。
旧 `SESSION` / `JSESSIONID` 不获得新身份，不读取 Spring 序列化对象。
`doctor` 是已有 Python 复核角色，仍不能访问管理员入口。

旧业务和 Agent 错误保持 HTTP 200 + code；工作流/复核的匿名、越权和基础服务故障
保持 HTTP 401/403/500。Redis 故障返回 50000，不降级为匿名或放行。
医生复核、冻结 AI 来源、用户保存授权未合并。

## OpenAPI 与前端

Python 提供 `/api/openapi.json`。五个业务 router 固定 operationId/tag，现有
控制器文件名、函数名、import 路径保持；页面及组件调用点没有修改。
`npm run openapi` 先在临时目录生成，保留六个手写控制器。上传/复诊签名保存在
`frontend/openapi/overrides.ts`；旧参数类型保存在 `src/api/compatibility.d.ts`。
旧 TypeScript 数字 Long、可选字段等声明保留客户端兼容身份；真实 HTTP Long
仍为字符串，不将旧声明当作服务端契约。Python-only 生成文件供后续使用，现有
页面继续使用手写适配器。相同 schema 重复生成的文件 SHA-256 一致。

## 验证与边界

- 受控身份/OpenAPI专项：45 passed，覆盖缺失/null 校验、慢身份查询并发响应、
  Cookie、轮换、续期/失效、角色/归属、故障与错误契约。
- 完整 Web 最终：778 passed / 28 skipped / 1 条依赖警告（第一轮 769 passed / 28 skipped）。结果见
  [最终日志](../.scratch/python-project-migration/evidence/issue02/web-tests-final.log)。
- 前端：Python schema 重新生成、vue-tsc/Vite build、12 个文件 / 47 项 Vitest 通过。
- MySQL 8.0.26 / Redis 3.2.100：新建隔离 schema，经 Python migration 初始化；
  独立 Redis、真实 TCP Uvicorn、合成账号/原稳定 Long ID。验证 BCrypt、MD5 升级、
  TTL 续期及过期、登出重放、删号、角色变化、两用户隔离、SSE 本人读取/非本人 403、
  Redis 进程停止后的登录/HTTP/SSE 拒绝。全程没有启动 Java。
- 原 Vue + headless Chromium：真实登录、历史数据查询、退出、会话过期引导通过；
  未拦截浏览器网络。截图保留既有 Invalid Date 与合成图片 URL 的显示限制，
  不宣称日期展示或图片服务已修复。
- 7 个核心修改模块 mypy 无错误；五个业务 router 检查仍有 10 处既有错误，已用
  HEAD 原文件复现相同错误，未借本票修改旧业务。参见
  [当前](../.scratch/python-project-migration/evidence/issue02/mypy.log)及
  [基点](../.scratch/python-project-migration/evidence/issue02/mypy-baseline.log)。
- 10 个历史 UI 辅助服务：启动、匿名拒绝和已登录身份探针通过；
  [探针结果](../.scratch/python-project-migration/evidence/issue02/helper-smoke.json)不代表其全部旧 UI 场景通过。
- Standards / Spec 发现已关闭；Java `src/`、`pom.xml` 零改动。

机器结果：[results.json](../.scratch/python-project-migration/evidence/issue02/results.json)。
截图：[原数据读取](../.scratch/python-project-migration/evidence/issue02/vue-original-history.png)、
[退出](../.scratch/python-project-migration/evidence/issue02/vue-logout.png)、
[过期引导](../.scratch/python-project-migration/evidence/issue02/vue-expiry-guidance.png)。

未验证：真实模型/供应商、临床、Linux、生产业务库升级/切流/回退、跨机器验收。
历史 `verify_real_services` / `cutover_browser` / `verify_workflow` / `verify_baseline`
已更新身份接线并编译检查，但其完整旧演练没有在本票重跑；新的身份验证不能替代
这些更广的验收。旧 Java 仅为独立比较/回退资产，移除与完整回退归后续工单。

## 重现

在 `algorithm` 目录，从本地秘密存储配置 `REAL_SERVICES_MYSQL_ADMIN_URL`
（本机 MySQL admin URL，不带 schema），再执行：

```powershell
& .venv-baseline/Scripts/python.exe -m web.verify_session_identity `
  --redis-server '<本机 redis-server 可执行文件绝对路径>' `
  --output-dir ../.scratch/python-project-migration/evidence/issue02-new-run
```

脚本只写新建的 `eye_session_issue02_*` schema，自行启动并结束所创建的 Redis/API/Vite
进程，不终止既有服务，不清理业务数据。JSON 和截图不包含密码、哈希或 Cookie；
本地 runtime 日志留在忽略目录。服务不可用时如实返回 NOT_RUN/FAIL，不用 SQLite
替代真实基础设施证据。
