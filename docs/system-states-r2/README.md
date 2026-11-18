# Iris System States R2 · 证据与验收说明

> 分支：`fix/system-states-r2`，基线 `b805377f`（`origin/ui`，含 PR #97）。
> 本目录只记录已实际运行的结果；合成故障与真实后端数据严格区分。

## 1. 证据目录

- `evidence/before/`：从基线提交 `b805377f` 导出 UI 源码后，用相同 Playwright 脚本
  `web/scripts/evidence/system-states-r2.mjs` 在真实浏览器截取。共 30 张
  （登录 502、资讯首次 502、资讯空态 × Light/Dark × 375/768/1024/1440/1920）。
- `evidence/after/`：当前 R2 分支同一矩阵 30 张，加上合成网络失败、后台刷新失败、
  页面渲染错误、注册 5xx 8 张（Light/Dark × 1440）。共 38 张。
- `evidence/compare/`：18 张并排对照（三类共同场景 × Light/Dark × 375/1440/1920），
  只做等比缩放与排版，不合成、不伪造 before。

取证日期：2026-11-18。浏览器：Chromium 1234（Playwright headless，真实渲染）。
主题通过 `localStorage.theme` 注入，每张截图前断言 `html.dark` 与目标主题一致。

## 2. 合成故障边界

以下画面来自浏览器内 `page.route` 拦截或 lazy chunk 注入，不是真实后端故障，
文件名/脚本注释已标注：

- `login-5xx-*`、`news-first-502-*`：HTTP 502 JSON。
- `login-network-*`：Playwright `abort('internetdisconnected')`。
- `news-cached-refresh-502-*`：首屏真实 JSON 数据后切换为 502，通过受控缓存失效入口
  触发 TanStack Query 后台刷新；保留缓存内容，显示非阻断恢复提示。
- `register-5xx-*`：注册接口 502（合成），表单级提示不提供盲重试，保留输入。
- `page-error-*`：拦截 `NewsPage.tsx` lazy chunk 注入抛错模块，验证 ErrorBoundary。
- `news-empty-*`：后端成功返回空分页数据（合成夹具，不是错误）。

R1 已确认本机 502 根因是后端 `:8081` 未启动，Vite 代理返回 502；
本轮不把环境故障伪造成业务缺陷，也不改 Java 后端代码。

## 3. 状态分层

| 层 | 组件 | 用法 |
|---|---|---|
| Inline / Form | `IrisFormAlert` | 登录/注册字段与表单级错误；不展示 NET/AUTH/CHECK 与端点 |
| Section / Content | `IrisSectionError`、`IrisRefreshNotice` | 资讯列表与详情；首次失败只替换内容区，有缓存时保留内容并给非阻断重试 |
| Page / Fatal | `IrisErrorState` | 404、RouteErrorBoundary、整页失败；保留只读读数 |

验证码/凭据只通过 Playwright route 内的合成值传入，未写入仓库、日志或截图文案。

## 4. 已运行验证（2026-11-18）

- `npm run typecheck`：PASS
- `npm run lint`：PASS
- `npm run build`：PASS（仅既存 `AdminNewsEditPage` 大 chunk 警告）
- `npm run test -- --run`：PASS，70 files / 645 tests（新增 3 条安全重定向边界测试）
- `npm run check:e2e-fixme`：PASS，0/0
- `npm run check:gate-tests`：PASS，3/3
- `npm run test:e2e -- --grep "Iris System States R2"`：PASS，14 passed / 0 skipped
  （受控缓存失效替代 31 秒固定等待；约 33s 完成）
- GitHub Actions：7/7 completed + success（PR head `ae4f46ef` 记录；最新 head CI 待本轮推送后复核）
  （`watchdog` / `python` / `frontend` / `backend-unit` / `flyway-mysql` / `backend-compile` / `web`）

R1 的 14 条 E2E 与本轮 14 条运行在同一个 Playwright 配置；本轮没有运行全量 E2E，
因此不声称全量 E2E PASS。

### 真实 Java 后端 Smoke（收尾轮）

本机 Spring Boot 3.5.6（`:8081`，profile `local,dev` + MySQL 5.7 `diagnosis` + Redis `:6380`）
已启动并跑通以下链路，全部为真实后端响应，非 route 合成：

- 注册：新临时账号经 `POST /api/user/register` 返回 `code:0`
- 登录：同账号经 `POST /api/user/login` 返回会话用户；`GET /api/user/get/login` 确认
- 资讯读取：`POST /api/news/list/page/vo` 返回真实条目
- 浏览器 UI：Vite `:5197` 经代理读资讯、在 `/login` 真实登录并落到 `/diagnosis`

临时账号已删除，gitignored 本地 profile 未提交，服务已停止。未扩大到医学推理 / 多 Agent 链路。

## 4.1 收尾轮（closeout）

- 安全重定向：抽取 `web/src/lib/redirect.ts`，拒绝 `//`、`/\`、控制字符与空白嵌套；
  补 3 条单测与 1 条浏览器 E2E（反斜杠 redirect 落到 `/diagnosis`）。
- 注册页：删除 `authFormMessage` 在 `intent=register` 下永不启用的 `onRetry` 死路径；
  E2E 标题改为「不提供盲重试」并断言无重试按钮。
- 缓存刷新：改用只在 `VITE_E2E_REFRESH_HOOK=1` 时挂载的受控失效入口，
  不再固定等 31 秒；生产构建不包含该钩子。
- CI：`.github/workflows/verify.yml` 新增 `web-e2e-system-states` job，
  安装 Chromium、启动 Vite、只跑 `Iris System States R2` 的 14 条。

## 5. 冻结范围

本轮不改 `pages/admin/*`、AdminGate、`tokens.css`、DESIGN.md 或 Java 后端。
认证页把 R2 状态面映射到 `auth.css` 已有的玻璃字段令牌，未修改根级令牌。
新增 CSS 全部在 `system-states.css`，无字面色，且 `.is-admin` 下 `FaultNote` /
`FaultPanel` 的 R1 冻结恢复块保持原样。
