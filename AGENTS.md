# AGENTS.md

> **本分支是 Python 线。** 仓库里另有一条 Java 后端线（Spring Boot），在 `master` 分支，
> 与本分支**不再互相合并**；共享目录各持一份，改动需人工搬运。约定见
> [docs/backend-split.md](docs/backend-split.md)。

## Current delivery (ticket 08, 2026-10-17)

The backend, Agent and durable Worker run in Python 3.11; the UI remains Vue 3.
Use root `pyproject.toml`, `.python-version`, `algorithm/requirements-web.lock`.
On Windows use PowerShell 7 (`pwsh.exe -NoLogo -NoProfile`), never Windows PowerShell.
Run `scripts/dev.ps1 install|start|status|stop`; it owns only registered process trees.
Run `python scripts/verify.py web|frontend|infrastructure` for local and CI checks.
The entry first scans active delivery dependencies with `scripts/verify_retirement.py`.
Linux delivery uses `deploy/python/compose.yml`; API and Worker stay independent.
See `docs/python-delivery.md` and `docs/python-retirement.md`.

Do not operate production business databases or push without explicit authorization.
Migrations are explicit: `python -m web.migrations baseline-check|inspect|upgrade`.
API/Worker startup never migrates. Frozen SQL lives in `deploy/python-migrations`;
never rewrite it or replay unknown histories. Columns remain camelCase.
Contracts come from `contracts/legacy-api.json`, not archived source files.
Auth uses revocable `EYE_SESSION` / Redis and fresh user-role checks for HTTP/SSE.
Long IDs serialize as strings; handled compatibility errors use `code/msg/data`.
Doctor review, immutable AI provenance and user save authorization remain separate.
Four human waits survive upgrades/restarts; legacy tasks require explicit rebuild.
DOC uses pinned local LibreOffice; DOCX uses Python. Tools do not download on requests.

Java sources/builds/probes were retired after checking ticket 07 and the frozen SQL.
The local tag `archive/java-before-python-retirement-2026-10-17` retains the complete
pre-removal tree. `docs/history/java/` and earlier ticket evidence are historical,
not current run instructions. Never delete private runtimes, datasets, weights,
ignored build artifacts or another contributor's edits to make checks pass.
Engineering, real infrastructure, providers/models and clinical gates are distinct.

## Design Context

### Users
混合用户群——眼科医生（临床检查）、医院管理员（记录管理/系统运维）、普通患者（AI 自助诊断）。三种角色技术熟练度和使用场景差异大，界面需根据角色调整复杂度。

### Brand Personality
**温暖、专业、关怀**。赤陶色(#c96442)主色调 + 米色背景传递人文关怀，Georgia 衬线标题传达医疗专业性，柔和圆角和暖色阴影营造被温柔对待的感受。

### Aesthetic Direction
浅色为主的暖色调界面，深色主题作为补充。当前 Codex-tokens.css 设计代币系统和 Ant Design Vue 主题定制方向正确，重构重点是提升精致度、优化排版层次、改善交互反馈、让深色主题达到同等完成度。

### Priority Areas
1. **诊断流程**：登录、首页、图片上传、诊断结果——用户最先接触的核心路径
2. **用户中心**：个人中心、诊断历史、通知——高频使用功能
3. **Agent 智能对话**：AI 对话、会话管理、资源面板——最复杂的交互界面

### Design Principles
1. **温度优先**：暖色调、柔和圆角、友善文案，让用户感到被关心
2. **角色自适应**：医生看专业数据，患者看通俗解读，同一系统不同复杂度
3. **克制之美**：赤陶色点缀而非铺满，每个视觉元素服务于信息或情感
4. **流畅过渡**：状态变化有流畅动效，传递系统响应性和可靠性
5. **双主题一致性**：浅色/深色传达相同品牌性格，非简单颜色翻转
