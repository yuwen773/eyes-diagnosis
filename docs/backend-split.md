# 后端双线分离约定

最后更新：2026-11-04。

同一个 Git 仓库里有两条互不合并的后端实现线。它们是**同一产品的两个后端**，不是两个项目；
共享目录各持一份，不做自动同步。

## 两条线

| | Java 线 | Python 线 |
|---|---|---|
| 分支 | `master` | `feature/python-backend` |
| 技术栈 | Spring Boot 3.5.6 / Java 21 | FastAPI + 独立 worker / Python 3.11 |
| 后端根 | `src/` + `pom.xml` | `algorithm/web/` + `algorithm/mcp_server/` + `pyproject.toml` |
| 数据库迁移 | Flyway `src/main/resources/db/migration/` | `deploy/python-migrations/`、`deploy/workflow-migrations/sql/` |
| 部署 | `Dockerfile` + `deploy/`（Java 探针） | `deploy/python/`（Dockerfile + compose.yml + nginx） |
| 契约 | `algorithm/diagnosis.proto` | `contracts/diagnosis.proto`（同一份 proto 的副本） |
| 生产 | 在跑（RC 基线） | 未切流 |

分叉点是 `d74784e`（`feat(p2-02a): add subprocess watchdog for CUDA probe cells`，2026-10-18 之前）。
从分叉点起两条线各自前进，**不再互相合并**。

## 历史锚点

| 标签 | 指向 | 用途 |
|---|---|---|
| `archive/java-before-python-retirement-2026-10-17` | `3eff163` | 去 Java 前的完整 Java 快照（Python 线内的祖先，2026-11-04 推送到 origin） |
| `v1.0.0-rc1` | `0a664f6` | Java 线的发布候选快照 |

## 共享目录

以下目录在两条线里**各有一份**，改动不会自动流到对面：

- `frontend/` —— Vue 3 前端
- `algorithm/` 下的 ML 与推理部分（`eye_diagnosis/`、`eye_diagnosis_p1/`、`p1/`、`train_model.py`、
  `grpc_server.py`、`eye_disease_model.py`、`mcp_server/`、`configs/`、`datasets/`、`checkpoints/`）
- `docs/`、`scripts/`、`.github/workflows/`

`algorithm/` 下两条线共有的文件目前有 126 个，差异只集中在 `algorithm/web/`（Python Web 层）
和 `requirements-web.*`。ML 与算法部分跨线改动时需要人工搬运。

`contracts/` 只在 Python 线存在。

## 约定

1. 跨线改动的搬运方向由改动主题决定：算法/ML 改动两边都要落；Web 层与迁移只落在所属线。
2. 一条线的合并请求不合并进另一条线。需要移植的改动单独做一次显式搬运，并写清来源提交。
3. 两条线各自独立跑 CI。Python 线的真实服务 CI 是 `.github/workflows/python-real-services.yml`。
4. 生产切流是独立决策，不随分支分离自动发生。本次（2026-11-04）不切流。

## 当前状态

- Java 线：正常推进，2026-10-21 的 P2-02c 真实 GPU fold-0 验收已合入（`af33fa1`）。
- Python 线：去 Java 迁移的工程验收已完成（工单 08 `PASS_WITH_LIMITATIONS` 4/4），
  但仍有 4 项真人验收阻塞未闭合（AC-08 补充说明、AC-09 拒绝/批准保存、AC-11 医生复核、
  AC-21 完整 UI 走查）。见 `docs/python-worktree-progress.md` 与 `docs/python-retirement.md`。

## 关联决策

`docs/adr/0001-complete-python-migration.md` 原定"最终收敛为一个无 Java 依赖的项目"。
2026-11-04 起该目标暂缓执行，改由本文件描述的双线并行取代；ADR 内已附修订记录。
