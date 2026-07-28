# 开发者指南（Developer Guide）

> 面向需要在本仓库上继续维护/扩展（非功能新增）的开发者。

## 1. 环境

- JDK 21（本机：`C:\Users\yuwen\.jdks\corretto-21.0.7`）
- Maven 启动器（pr-12 工作树）：`C:\Users\yuwen\mvn_pr12.sh`
  > 注意：旧 `mvn_local.sh` 指向错误旧目录，**勿用**。
- 前端 Node 22（构建时走 npmmirror 源；本地代理 7892 已死，须 `HTTP_PROXY= HTTPS_PROXY=` 清空）

## 2. 构建与测试

后端：
```bash
bash /c/Users/yuwen/mvn_pr12.sh test          # 门禁：≥268 绿
bash /c/Users/yuwen/mvn_pr12.sh -DskipTests package
```

前端（frontend/ 目录）：
```bash
HTTP_PROXY= HTTPS_PROXY= npm install --registry=https://registry.npmmirror.com
npm test        # Vitest ≥71
npx playwright test   # E2E ≥4
npm run build
```

## 3. 测试门禁基线（RELEASE-001）

| 项 | 基线 |
|----|------|
| mvn test | ≥ 268（Skipped 3） |
| Vitest | ≥ 71 |
| Playwright E2E | ≥ 4 |
| npm run build | 成功 |
| 违禁标识符扫描 | 零命中 |
| docker compose up | 实机 7 容器 Up |

## 4. 扩展约束（冻结期间）

- **禁止**修改冻结清单中的类/语义（见 Architecture.md §7）。
- 可观测性/审计如需增强，必须沿用 **`@Primary` 装饰器零侵入** 模式挂接到已冻结类，
  不得改动 `graph`/`runtime` 核心。
- 审计表 append-only：Repository 不暴露 update/delete。
- 新增指标应从业务 delta 派发，不侵入运行时。

## 5. 数据库迁移纪律

- 演进表走 Flyway（V1–V14），新增迁移必须 append-only，不得 `DROP`/`ALTER` 破坏存量。
- 存量业务表（非 Flyway）变更须同步 `deploy/mysql/init/01_legacy_schema.sql`。
- workflow 表列名为驼峰（`workflowId` / `reviewTaskId` / `eventType`）。

## 6. 分支策略

- 功能开发：`codex/pr-XX-*` 工作树。
- 发布：`release/v1.0.0` 分支 + `v1.0.0-rcN` 标签（RC 阶段）。
- 当前阶段：**RC 冻结**，不再接受 PR-13 功能开发。

> 待补充：本地 IDE 调试配置、Chroma 数据初始化、CI 配置示例、贡献 PR 模板。
