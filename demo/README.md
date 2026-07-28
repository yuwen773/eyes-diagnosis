# Demo 演示环境（PR-12.5）

## 启动方式

```bash
# 1. 构建后端 jar（宿主机需要 JDK 21 + Maven）
mvn -DskipTests package

# 2. 启动全栈（默认 demo profile，自动执行 Flyway 迁移 + Demo 数据种子）
docker compose up -d --build
```

启动完成后：

| 服务 | 地址 |
|------|------|
| 前端 | http://localhost:8080 |
| 后端 API | http://localhost:8081/api |
| Prometheus | http://localhost:9090 |
| Grafana | http://localhost:3001 (admin/admin) |
| 指标端点 | http://localhost:8081/api/actuator/prometheus |

## 演示账号

| 账号 | 密码 | 角色 |
|------|------|------|
| demo_patient | demo12345 | 患者（USER） |
| demo_doctor | demo12345 | 医生（DOCTOR） |
| demo_admin | demo12345 | 管理员（ADMIN） |
| demo_auditor | demo12345 | 审计员（AUDITOR） |

## 演示案例

种子数据由 `DemoDataSeeder`（`@Profile("demo")` + `demo.seed.enabled=true`）幂等写入：

1. **Case 1 正常完成**（`cases/case-1-normal-completed.json`）
   状态 COMPLETED，解释快照 PUBLISHED，预测 AVAILABLE。演示患者端完整诊断结果。
2. **Case 2 人工复核**（`cases/case-2-human-review.json`）
   状态 WAITING_HUMAN_REVIEW，附一条 OPEN 的 FINAL_CLINICAL_REVIEW 任务。
   用 demo_doctor 登录审核工作台可 claim → submit，演示医生复核闭环。
3. **Case 3 OOD 拒识**（`cases/case-3-ood-rejected.json`）
   状态 REJECTED，stopReasonCode=OOD_DETECTED，预测 WITHHELD_BY_OOD。
   演示医疗安全策略：分布外输入被安全拒识，不向患者暴露任何预测。

## 环境隔离

- demo profile 仅在 `SPRING_PROFILES_ACTIVE=demo` 时激活；
- 生产使用 `SPRING_PROFILES_ACTIVE=prod`（`application-prod.yml`），凭据全部来自环境变量；
- `application-test.yml` 位于 `src/test/resources`，不会打入生产 jar，生产不可能读取 test 配置；
- `DemoDataSeeder` 通过 `@Profile("demo")` 与 `demo.seed.enabled` 双重开关隔离。
