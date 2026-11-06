# Issue #17 隔离端到端验收记录

日期：2026-11-05。工作树 `worktree-java-multi-agent-arch`，HEAD `bfbb4d6`。
范围：GitHub issue #17「患者创建眼底图片分析任务并查看状态」四项验收准则。
本记录只覆盖隔离工程验收，不代表临床有效性、生产上线、真实患者数据授权或部署批准。

## 环境与隔离

| 项 | 值 |
|---|---|
| JDK | Corretto 21.0.7（`C:\Users\yuwen\.jdks\corretto-21.0.7`） |
| Maven | 3.9.9 |
| 数据库 | 一次性 Docker 容器 `mysql:8.0.36`（image `a53272402242`），端口 `127.0.0.1:33317` |
| 隔离库 | `issue17_test`（功能/恢复用例）、`diagnosis_ci`（Flyway 迁移门禁） |
| 隔离保证 | 测试代码强制 URL 匹配 `jdbc:mysql://127\.0\.0\.1:[0-9]+/issue17_test`；崩溃子进程同样校验；未匹配即抛错或跳过 |
| 本机 MySQL 3306 / 3307 | 未连接、未改动（实测两实例均无 `issue17*` / `diagnosis_ci` 库） |
| 前端 | Node 22.21.0 / npm 10.9.4 / Vitest 4.1.10 / `vue-tsc --build` |

容器命令与凭据仅属于一次性测试实例，运行结束后 `docker stop` 即销毁；未写入仓库配置。

## 验收矩阵

| #17 准则 | 结论 | 证据 |
|---|---|---|
| 已认证患者可创建并查询自己任务；其他用户无权读取 | 通过 | `DiagnosisTaskApiTest`：`unauthenticatedRequestCannotReachTaskService`、`patientCannotReadAnotherPatientsTask`、`actualDatabaseQueryRestrictsOwnerAndUnknownState`、`simultaneousIdenticalRequestsReturnOneTask`、`creationReplaysIdenticalRequestAndRejectsChangedImage`；服务按 `userId` 过滤，接口响应仅 `taskId`+安全状态 |
| 推理快照绑定输入身份与摘要，重复创建及重启不覆盖或重复推进结果 | 通过 | `DiagnosisTaskRecoveryTest`：崩溃恢复四相位、过期执行者、双执行者竞争、租约栅栏、调用额度上限；快照 JSON 绑定 `taskId`/`userId`/`objectKey`/`objectVersion`/`imageDigest`/`imageFormat`/响应 protobuf；`finish` 带 `inferenceSnapshot IS NULL` 与租约/版本 CAS |
| 无效图片、推理失败、拒识与未知状态进入受限路径，不展示疾病推测 | 通过 | `invalidImageIsRejectedAndMissingVersionCreatesRestrictedTask`、`changedObjectAndRejectionAreRestrictedWithoutRetry`、`explicitInvalidArgumentDoesNotRetry`、`unevaluatedOodIsRestrictedButPreservesBoundSnapshot`、`unknownInternalStatesAreNeverClaimed`、`failuresAndUncertainCallsRespectTheBudget`；`safeStatus` 默认 RESTRICTED，前端只映射三种安全文案 |
| 通过公开接口及隔离数据库验证故障、重复执行与恢复；真实 Python 服务未运行时明确标记 | 见下 | MockMvc 公开接口 + 独立 MySQL 8 容器；真实 Python gRPC 未运行 |

## 执行结果

| 命令 | 结果 |
|---|---|
| `mvn -Dtest=DiagnosisTaskApiTest,DiagnosisTaskRecoveryTest,CosDiagnosisTaskStorageTest test`（`ISSUE17_TEST_URL` 指向隔离库） | 17 run / 0 failures / 0 errors / 0 skipped，BUILD SUCCESS |
| `mvn -Dtest=FlywayMySqlIntegrationTest test`（全新 `diagnosis_ci`） | 1 run / 0 failures，V1–V10 全部执行，当前版本 v10 |
| `mvn '-Dtest=*,!EyeDiagnosisApplicationTests,!FlywayMySqlIntegrationTest' test`（项目既有隔离回归口径） | 114 run / 0 failures / 0 errors / 20 skipped，BUILD SUCCESS；17 个 #17 用例全部执行，跳过项均为 opt-in 外部服务门禁 |
| `npx vitest run src/pages/diagnosis/__tests__/DiagnosisTasksPage.test.ts` | 1 file / 4 tests passed |
| `npm run build`（`vue-tsc --build --force` + Vite） | 通过，25.68s，仅既有 chunk-size 警告 |

### 已知基线限制（非 #17 引入）

- 全量 `mvn test` 中 `EyeDiagnosisApplicationTests.contextLoads` 因 `CosClientConfig` 缺 `cos.client.secretId/secretKey` 报 `Access key cannot be null`；该失败在 HEAD `bfbb4d6` 即存在，`docs/testing/2026-10-19-test-audit.md` 已把此用例与 Flyway 门禁排除在隔离回归口径外。
- 同一全量运行中 `FlywayMySqlIntegrationTest` 曾报 `expected: <10> but was: <0>`：原因是此前单独跑门禁时已在 `diagnosis_ci` 建过 schema；对全新空库重跑即通过。该用例按设计只适用于空库。
- 20 个 skipped：`VectorStoreConfigTest`(1)、`RAGEvaluationTest`(2)、`CoordinationMySqlTest`(14，需 `COORDINATION_POC_URL`)、`UploadTaskMapperMySqlIntegrationTest`(3)。均非 #17 用例。

## 真实外部依赖标记（AC4 要求）

| 依赖 | 状态 | 说明 |
|---|---|---|
| 真实 Python gRPC 推理服务（`:50051`） | **未运行** | `netstat` 未监听 50051；全部用例使用 `mock(DiagnosisGrpcClient.class)`；隔离替身结果不得标为真实模型验收 |
| 真实 COS 对象版本读取 | **未运行** | `CosDiagnosisTaskStorageTest` 使用 mock `COSClient`；真实多版本配置需独立验收 |
| 真实浏览器/设备走查 | **未运行** | 仅有 jsdom 组件测试与生产构建 |
| 真实模型质量、领域评估、临床验收 | **未运行** | 超出本工单范围，按 `docs/diagnosis-task.md:12` 单独门禁 |
| 隔离 MySQL 8.0.36 事务/唯一约束/恢复/CAS | **已运行** | 一次性容器，结果如上 |
| Flyway V10 迁移门禁（真实 MySQL 8） | **已运行** | 全新空库，10 个迁移 |

`docs/diagnosis-task.md:12` 与 `docs/plans/2026-11-05-multi-agent-implementation-plan.md:30,58` 已书面声明真实 Python、COS、浏览器与临床验收需分别执行；本记录把「未运行」落入可核对表格，不把替身测试计为通过。

## CI 覆盖缺口与修复（已修复，GitHub 托管 CI 未运行）

初轮验收发现：`.github/workflows/verify.yml` 的 `backend-unit`（`mvn test`）与
`flyway-mysql` 作业都不设置 `ISSUE17_TEST_URL`，而 `DiagnosisTaskApiTest` /
`DiagnosisTaskRecoveryTest` 用 `Assumptions.assumeTrue(url matches ...)` 做隔离门槛。
实测未设置该变量时 `Tests run: 17, Failures: 0, Errors: 0, Skipped: 14 / BUILD SUCCESS`，
即 14 个数据库/恢复用例静默跳过，而 `FlywayMySqlIntegrationTest` 期望值已从 9 改为 10、
flyway-mysql 作业照样绿，容易被误读为 #17 恢复行为已在 CI 验证。按
`docs/plans/2026-11-05-coordination-recovery-poc.md` 的纪律，跳过数必须单独核对。

修复（2026-11-05，用户实施，本会话独立复核）：

- `.github/workflows/verify.yml` 新增 `issue17-mysql` 作业：独立 `mysql:8.0.36` 服务容器，
  `ISSUE17_TEST_URL=jdbc:mysql://127.0.0.1:3306/issue17_test`，凭据与测试内硬编码的
  `issue17/issue17` 一致，URL 匹配测试隔离正则；`timeout-minutes: 15`。
- 作业依次跑 `python3 -m unittest discover -s scripts/tests`（门禁自测）、
  `mvn -B -Dtest=DiagnosisTaskApiTest,DiagnosisTaskRecoveryTest,CosDiagnosisTaskStorageTest test`、
  `python3 scripts/check_issue17_reports.py target/surefire-reports`。
- `scripts/check_issue17_reports.py` 要求三个 suite 报告齐全、用例数不少于 6/10/1、
  汇总与每个 `<testcase>` 均无 skipped/failure/error，任一不满足返回 1（Actions 非零退出即失败）。
- `scripts/tests/test_check_issue17_reports.py` 4 项自测覆盖全通过、报告缺失、
  testcase 含 skip/failure/error（即使汇总计数为 0）、用例不足与坏 XML。

本会话独立复核结果（Windows 本地，Python 3.13 / JDK 21 / 一次性 MySQL 8.0.36 容器）：

| 场景 | 结果 |
|---|---|
| 门禁自测 4 项 | OK |
| workflow YAML 解析（PyYAML 6.0.3） | `jobs` 含 `issue17-mysql`；env、image、3 个 step 符合预期 |
| 全新隔离库跑三套件 | `17 run / 0 skipped / BUILD SUCCESS`，门禁返回 0 |
| 不设 `ISSUE17_TEST_URL` 复现旧行为 | `17 run / 14 skipped / BUILD SUCCESS`，**门禁返回 1**（正确拦下） |
| 空报告目录 / 含 skipped 的报告 | 门禁均返回 1 |
| `scripts` 命名空间包从仓库根导入 | OK（CI 的 `-m unittest` 工作目录为仓库根） |

**边界**：以上均为 Windows 本地模拟，GitHub 托管 CI（ubuntu-latest）尚未运行，
不能据此断言托管 CI 已绿；`backend-unit` 的既有跳过行为未改变，由新作业独立把关。
另：本机 `python3` 指向失效的 Anaconda 壳，复核改用 `D:\environment\python`（3.13.15）；
CI 用 ubuntu 自带 `python3`，不受影响。

修复后验收结论从「本地隔离实测通过，CI 未覆盖」更新为：
**本地隔离实测通过，CI 已接线且门禁逻辑经本地反证验证；托管 CI 结果待首次运行确认。**

## 复现步骤

```bash
# 一次性容器（凭据仅属该容器）
docker run -d --rm --name issue17-acceptance \
  -e MYSQL_RANDOM_ROOT_PASSWORD=yes -e MYSQL_DATABASE=issue17_test \
  -e MYSQL_USER=issue17 -e MYSQL_PASSWORD=issue17 \
  -p 127.0.0.1:33317:3306 mysql:8.0.36
# 等 mysqladmin ping 通过后（约 4s）
export JAVA_HOME=/c/Users/yuwen/.jdks/corretto-21.0.7   # Git Bash 路径
export PATH="$JAVA_HOME/bin:$PATH"
export ISSUE17_TEST_URL="jdbc:mysql://127.0.0.1:33317/issue17_test"
mvn -B -Dtest='DiagnosisTaskApiTest,DiagnosisTaskRecoveryTest,CosDiagnosisTaskStorageTest' test

# Flyway 门禁需另建空库（用容器日志里的 GENERATED ROOT PASSWORD）
docker exec issue17-acceptance mysql -uroot -p'<root-pwd>' \
  -e "CREATE DATABASE diagnosis_ci; GRANT ALL ON diagnosis_ci.* TO 'issue17'@'%';"
export FLYWAY_TEST_URL="jdbc:mysql://127.0.0.1:33317/diagnosis_ci"
export FLYWAY_TEST_USERNAME=issue17 FLYWAY_TEST_PASSWORD=issue17
mvn -B -Dtest=FlywayMySqlIntegrationTest test

# 前端
cd frontend
npm ci --cache ./.npm-cache && rm -rf .npm-cache
npx vitest run src/pages/diagnosis/__tests__/DiagnosisTasksPage.test.ts
npm run build
# 收尾
docker stop issue17-acceptance
```

注意：`ISSUE17_TEST_URL` 只能是不带额外参数的 `jdbc:mysql://127.0.0.1:<port>/issue17_test`，
带 `?useSSL=...` 等参数会被测试代码的隔离正则拒绝；本机默认 JDK 23 也不符合项目 Java 21 要求，
必须显式设置上面的 `JAVA_HOME`。
