# 部署指南（Deployment）

> 基于 docker-compose 全栈一键部署。源码 → 构建 → 可访问系统 已闭环验证。

## 1. 服务拓扑

| 服务 | 镜像 | 容器内端口 | 宿主机端口 | 说明 |
|------|------|-----------|-----------|------|
| mysql | mysql:8.0 | 3306 | `${MYSQL_HOST_PORT:-3307}` | 业务库（含 Flyway + 存量表） |
| redis | redis:7-alpine | 6379 | 6379 | 缓存/会话 |
| chroma | ghcr.io/chroma-core/chroma:1.0.0 | 8000 | 8000 | 向量库 |
| backend | 本地构建（eclipse-temurin:21-jre） | 8081 | 8081 | Spring Boot |
| frontend | 本地构建（nginx:1.27-alpine） | 80 | 8080 | Vue SPA + 反代 |
| prometheus | prom/prometheus:v2.53.0 | 9090 | 9090 | 指标抓取 |
| grafana | grafana/grafana:11.1.0 | 3000 | 3001 | 可视化（admin/admin） |

## 2. 环境变量

- `BACKEND_PROFILE`：Spring profile，默认 `demo`（可选 `dev`/`test`/`prod`）。**生产不得读 test 配置。**
- `MYSQL_HOST_PORT`：MySQL 宿主机映射端口（默认 3307，冲突时改 3308）。
- 生产 profile（`application-prod.yml`）：数据库/Redis/Chroma 凭据**全部环境变量化**，关闭 SQL stdout 日志。
- demo profile（`application-demo.yml`）：启用 `demo.seed.enabled: true` 幂等种子。

## 3. 数据库初始化（双生命周期）

1. **Flyway V1–V14**：管理 workflow 演进表（含 V14 审计表）。
2. **存量表**：`t_user` 等 8 张早期业务表不在 Flyway 链内，由
   `deploy/mysql/init/01_legacy_schema.sql`（幂等 `IF NOT EXISTS`）经
   `docker-entrypoint-initdb.d` 在 **mysql 数据卷首次初始化时** 自动建表。
   - 若复用旧数据卷导致缺表：手动灌入后 `docker compose restart backend` 重跑种子：
     ```bash
     docker exec -i <mysql容器> mysql -uroot -p<密码> diagnosis < deploy/mysql/init/01_legacy_schema.sql
     ```

## 4. 启动

```bash
# 构建并启动全栈（本机 mysqld 占 3307 时用 3308）
MYSQL_HOST_PORT=3308 docker compose up -d --build
```

## 5. 访问入口

| 服务 | 地址 |
|------|------|
| 前端 | http://localhost:8080 |
| 后端 API | http://localhost:8081/api |
| Prometheus | http://localhost:9090 |
| Grafana | http://localhost:3001（admin/admin） |

## 6. 演示账号（demo profile）

| 账号 | 密码 | 角色 |
|------|------|------|
| demo_patient | demo12345 | 患者（USER） |
| demo_doctor | demo12345 | 医生（DOCTOR） |
| demo_admin | demo12345 | 管理员（ADMIN） |
| demo_auditor | demo12345 | 审计员（AUDITOR） |

## 7. 本机注意

- Docker Desktop 直连 docker.io 超时：已配置 `~/.docker/daemon.json` registry-mirrors
  （docker.m.daocloud.io + hub-mirror.c.163.com）。
- 后端健康检查：`/api/actuator/health`；指标：`/api/actuator/prometheus`。

> 待补充：生产 TLS/反向代理建议、备份策略、回滚步骤、资源配额。
