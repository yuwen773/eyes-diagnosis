# AGENTS.md

本仓库的项目指引以 [`CLAUDE.md`](CLAUDE.md) 为唯一真源：架构、API、数据库规范、
Navigation、验证命令、设计真源都读它，本文只补 Codex 侧的环境事实。改项目约定时只改真源。

## 本机环境（不入库）

- 数据库连接信息见 `src/main/resources/application-dev.yml`（已 gitignore）与
  `CLAUDE.local.md`；Codex 侧同一份在 `~/.codex/AGENTS.md`。改配置前先确认端口与账号属于哪套实例。
- Maven / Java 验证用 JDK 21：`C:\Users\yuwen\.jdks\corretto-21.0.7`。
  新 shell 里设 `JAVA_HOME` 指向它即可（POSIX shell：`JAVA_HOME=<path> mvn ...`）。
  后端全量验证直接跑 `scripts/verify.sh`，它自带 JDK 路径、一次性 MySQL 8 + Redis 与 ci profile。
