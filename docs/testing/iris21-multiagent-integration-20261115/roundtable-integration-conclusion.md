# Iris 多 Agent 集成 R1.3 + Roundtable 3.0 · 受控集成结论

- 集成时间：2026-11-17
- 范围：仅将 PR #93 合并到 PR #87 的集成分支 `feat/iris21-multiagent-integration`
- 终态：**ROUND TABLE INTEGRATED / #87 REVIEW_PENDING**
- 生产医疗协作：**BLOCKED（合并 ≠ 启用）**

---

## 一、Git 历史核对（全部由命令得出）

| 项 | 值 |
| --- | --- |
| PR #93 Head（冻结候选） | `3cad9514fef0f13a639dc3c7a6db4b38945e0a63` |
| PR #93 Base / #87 原 HEAD | `6ba65478b8c88d2ef1a019044bbd2232e1842961` |
| 合并方式 | Merge Commit（`merge_method=merge`，无 squash / rebase / force） |
| 合并提交 | `290d6f153a78b0c8b98871ced698e7cb6323b1ae` |
| 合并提交双亲 | `6ba65478…`（base）+ `3cad9514…`（head） |
| 合并后 #87 HEAD | `290d6f153a78b0c8b98871ced698e7cb6323b1ae` |
| 树一致性 | `3cad9514` 与 `290d6f15` 的 tree 同为 `ed9ac5fe…`，**逐字节相同** |
| #87 原有历史 | 完整保留（`7abfe50c`、`c94354b8`、`6ba65478` 等均在祖先链） |
| `ui` 分支 / 冻结 tag | 未触碰；未合并、未改写 |
| PR 状态 | #93 = **MERGED**；#87 = **OPEN / Draft** |

## 二、Roundtable 3.0 交付内容（PR #93）

- `/agent/collaboration` 升级为 Roundtable 3.0：四角色肖像、成员详情、阶段摘要、授权交接、核验、补证回流、活动与终态的事件卡；沿用共享 Iris 顶栏与双主题。
- 断线续读用既有游标；同授权投影下保留已观察事实，授权变化即清除；撤权后 SSE 正常结束，客户端重新鉴权并清理旧面板与影像 Blob。
- 末轮定向整改：折叠导航（901–1099px + 协作开关）下在共享抽屉账号区补齐仅管理员可见的「系统管理」入口（`user.userRole === "admin"` + `/admin`），折叠策略、全局权限与默认关闭开关均未改。

## 三、视觉验收证据

- 归档位置：`docs/testing/roundtable-evidence-20261117/`（12 张优化 WebP，约 310 KB，README 含元数据与复跑命令）。
- 截图基线：`4e465e12` 精确检出；修复仅动账号区入口，不影响工作台视觉。
- 覆盖：Light/Dark × 1440 桌面、360/390 移动、补证回流、1024 资料抽屉、连接中断、执行失败、医生复核。
- 验证方式：合成事件浏览器测试生成 + 人工逐张视觉核验；全尺寸 PNG 不入库，按 README 可复跑。

## 四、验证结果

### PR #93 Head（`3cad9514`）CI

**20/20 checks 全绿**（含 `web`、`frontend`、`backend-*`、`product-contract`、`collaboration-mysql`、各 issue MySQL 门禁）。首次运行曾因 Maven Central HTTP 429（surefire 依赖下载失败）导致两条 MySQL job 失败，`rerun --failed` 后全绿——非代码问题。

### 合并提交（`290d6f15`）本地实跑（树与已测 PR head 逐字节相同）

| 项 | 结果 |
| --- | --- |
| `typecheck` / `lint` / `build` | PASS（build 仍有既有 chunk>500kB 警告） |
| React 单元与组件 | **651/651**（67 文件） |
| 合成协作浏览器 | **43/43**（双主题、360–1920px） |
| 导航断点浏览器（flag-on） | **8/8**（360–1100px，管理员/普通用户/未登录） |
| 导航 flag-off | **1/1** |
| 协作默认关闭回归 | **1/1** |
| 协议契约 / fixme / gate | 16 事件/12 字段、0/0、6/6 |

### 合并提交 CI 说明

仓库 `verify.yml` 仅在 `pull_request` 与 `push` 到 `master` 时触发；向本集成分支（非 master）的 push/merge commit **不触发 CI**，因此 `290d6f15` 本身没有新的 check-runs。这不是失败：合并树与已获 20/20 绿、且经本地全套复跑的 `3cad9514` 完全相同（tree `ed9ac5fe`）。#87 最终合并到 `ui` 时会在 PR 事件上重新跑全套门禁。

## 五、与本轮集成同时发现的 `ui` 方向冲突（未处理）

- 会话开始时 `origin/ui` = `b5f37e5c`，PR #87 的 `mergeStateStatus` 为 `CLEAN`；会话期间 `origin/ui` 被另一条工作线推进到 `9d3c5317`（PR #91：Prism 首屏/统一滚动条等）。
- 当前 PR #87（head `d1a01b5`）对 `ui` 的 `mergeStateStatus` 变为 `CONFLICTING`。`git merge-tree origin/ui d1a01b5` 显示唯一冲突文件 `web/src/styles/app.css`；原 #87 head `6ba65478` 对当前 `ui` 仍可干净合并，说明冲突来自 #93 对 `app.css` 字标区的 4 行改动（同步 #88 光学虹膜字标）与 #91 对同区的改写。
- **本轮未解决该冲突**：解决需要改写 `app.css` 中与 `ui` 新内容相邻的区域，超出「仅将 #93 合并到 #87 集成分支、不合并到 ui、不修改冻结 tag」的授权范围。冲突留给后续单独授权的 #87→ui 集成处理；本分支内部（#93 合入 #87）完全干净，合并树与已测 head 一致。

## 六、授权边界与未覆盖能力（合并结论按此口径）

1. **冷刷新无法补读快照水位以前的完整时间线**，界面只按当前状态恢复，不伪造历史。
2. **SSE 重新鉴权期间（`connecting`/`loading`/`reconnecting`）会暂时隐藏受保护会话内容**，直到服务端重新签发快照；授权变化时旧事实被清除。
3. **隔离 Java HTTP/SSE/MySQL 联调中的模型与推理为合成测试接缝**（`/api/test/*`），不是真实大模型输出。
4. **真实模型提供方、临床效果与生产环境未验收**（NOT_RUN）。
5. 协作前端入口由 `VITE_COLLABORATION_ENABLED` 控制（未设为 `true` 时导航不出现），后端由 `eye-diagnosis.collaboration.*` 控制（默认全 false）；本分支**不开启、不部署**。

## 七、下一步

本集成分支保持 Draft / REVIEW_PENDING，等待正式 Review；后续是否合并到 `ui` 需单独授权，并且需先在上游 `ui` 新基线（`9d3c5317`）上处理 `app.css` 冲突、重跑全套门禁。合并 ≠ 生产启用；启用医疗协作需要另行验收真实模型与临床有效性。
