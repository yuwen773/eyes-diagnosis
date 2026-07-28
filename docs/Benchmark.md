# 性能基准（Benchmark）

> 采集时间：2026-07-28 ｜ 来源：运行中的 Docker 栈 Prometheus（localhost:9090）＋ MySQL 种子数据
> 采集方式：`RELEASE-001` 实机环境（docker compose 全栈），backend 健康、7 容器 Up。

## 1. 已实测指标（真实值）

| 指标 | 结果 | 说明 |
|------|------|------|
| 容器健康 | 7/7 Up（backend/mysql/redis healthy） | docker compose ps |
| Prometheus 抓取 backend | `up=1` | scrape 正常 |
| `/actuator/health` 平均延迟 | **9.33 ms**（117 次） | Spring Boot Timer 实测 |
| `/actuator/prometheus` 平均延迟 | **12.36 ms**（118 次） | 指标导出开销极低 |
| JVM 堆使用 / 上限 | **259.9 MB / 1024 MB（~25%）** | 空闲态，含 Grafana 抓取期 |
| JVM 活动线程 | 33 | 空闲态 |
| 进程 CPU 占用 | 0.1% | 空闲态 |
| 服务运行时长 | ~1665 s（约 28 min，截至采集） | process_uptime |
| `review_pending_count` | **1** | 真实 Gauge：种子 Case2 的 OPEN 复核任务已联动 |
| 种子工作流分布 | COMPLETED 1 / WAITING_HUMAN_REVIEW 1 / REJECTED(OOD) 1 | demo 三案例全部按预期落地 |
| 复核任务 | OPEN 1（FINAL_CLINICAL_REVIEW） | 与 review_pending 联动一致 |
| 审计事件数 | 0 | **预期**：种子不触发运行时装饰器，审计仅在真实执行时写入 |

## 2. 需真实推理运行的指标（当前环境限制）

以下指标由 `WorkflowMetrics`（PR-12.1）在**真实工作流执行**时派发，但当前 demo
profile 使用占位模型密钥（`DASHSCOPE_API_KEY=demo-placeholder-key`），**未发起真实推理**，
故 Prometheus 中尚无对应时序（`workflow_created_total` 系列数 = 0）。

| 指标（Prometheus 名） | 类型 | 触发点 |
|----------------------|------|--------|
| `workflow_created_total` | Counter | 工作流创建 |
| `workflow_completed_total{status}` | Counter | 终态完成 |
| `workflow_failed_total` | Counter | 终态失败 |
| `workflow_duration_seconds` | Timer | 端到端耗时 |
| `segment_execution_total{segment,disposition}` | Counter | 每段执行 |
| `segment_execution_latency_seconds{segment}` | Timer | 段耗时 |
| `segment_retry_total` / `segment_interrupt_total` | Counter | 重试/中断 |
| `inference_latency_seconds` | Timer | 视觉推理耗时 |
| `inference_timeout_total` / `model_abstain_total{reason}` | Counter | 超时/拒识 |
| `evidence_validation_failure_total` | Counter | 证据校验失败 |
| `review_duration_seconds` | Timer | 人工复核耗时 |
| `review_reject_total` | Counter | 复核驳回 |
| `audit_write_failure_total` | Counter | 审计写入失败 |

> **复现真实 Benchmark 的方法**：
> 1. 设置真实密钥：`export DASHSCOPE_API_KEY=<真实 key>`（Vision `qwen-vl-plus` / LLM `qwen-plus` / Embedding `text-embedding-v3`）。
> 2. `MYSQL_HOST_PORT=3308 DASHSCOPE_API_KEY=<key> docker compose up -d --build` 重启 backend。
> 3. 以 demo_patient 登录，上传眼底图发起诊断；以 demo_doctor 完成 Case B 复核。
> 4. 查询 Prometheus：`workflow_duration_seconds`（端到端）、`segment_execution_latency_seconds`（各段）、
>    `inference_latency_seconds`（视觉推理）、`review_duration_seconds`（复核）。
> 5. 成功率 = `workflow_completed_total / (completed+failed)`；失败恢复率 = `segment_retry_total / segment_execution_total`。

## 3. 结论

- 当前可证明：系统**可部署、可观测、可审计链路已闭环**，基础设施与 API 层开销极低（健康/指标接口 < 15 ms），
  资源占用健康（堆 25%、CPU 0.1%）。
- 业务级耗时/成功率需在**配置真实模型密钥**后复现——这是演示环境刻意隔离外部依赖的结果，
  不代表系统能力缺失（指标采集管线已随真实运行自动填充，见上表）。

> 待补充：真实推理密钥就位后的端到端耗时/成功率/失败恢复率实测值，填入第 2 节表格。
