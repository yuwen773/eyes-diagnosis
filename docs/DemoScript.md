# 演示脚本（Demo Script）

> 固定三案例，覆盖「正常完成 / 人工复核 / OOD 拒识」三类路径。演示环境用 demo_patient / demo_doctor 登录。

## Case A — 正常诊断（自动完成）

```
1. 登录 demo_patient
2. 诊断创建页上传一张合格眼底图 → 提交
3. 观察 SSE 进度：Image Agent → Vision Agent → Evidence Agent → Explanation Agent
4. 流水线自动完成（无需人工），状态 = COMPLETED
5. 结果页展示白名单投影（diseaseCode + calibratedProbability + 通用说明）
```

预期：`t_diagnosis_workflow` 新增一条 `COMPLETED`；审计事件含
`AI_INFERENCE_COMPLETED` → `EVIDENCE_VALIDATED` → `EXPLANATION_PUBLISHED` → `RESULT_EXPOSED`。

## Case B — 人工复核（医生介入）

```
1. 登录 demo_patient，提交一张「风险偏高/边界」影像
2. 系统判定需人工复核 → 状态 = WAITING_HUMAN_REVIEW
3. 切换 demo_doctor，进入 /reviews/tasks，看到 OPEN 任务
4. claim 认领 → 查看解释快照与证据
5. 提交决策（如 Confirm）→ 工作流 Resume
6. 回到 demo_patient 查看最终发布结果
```

预期：`t_human_review_task` 出现 1 条 `OPEN` 的 `FINAL_CLINICAL_REVIEW`；
`review_pending_count` 指标 0→1；审计事件含 `REVIEW_ASSIGNED` → `REVIEW_COMPLETED`。

## Case C — OOD 拒识（模型拒识）

```
1. 登录 demo_patient，提交一张分布外/低质量影像
2. 模型判定 OOD → 工作流终止，状态 = REJECTED
3. stopReasonCode = OOD_DETECTED
4. 患者端收到 LIMITED 通用说明，不展示任何 AI 预测
```

预期：`t_diagnosis_workflow` 状态 `REJECTED`，`stopReasonCode = OOD_DETECTED`；无发布类审计事件。

## 演示检查清单

- [ ] 三案例状态与预期一致
- [ ] 患者端不暴露 `rawPrediction`/`topK`/`modelScore`/`abstainReason`
- [ ] Prometheus `up=1` 抓取 backend
- [ ] Grafana 数据源就绪
- [ ] 审计网关（demo_auditor）可查 append-only 事件

> 待补充：每案例的示例影像来源、截图脚本、答辩 10 分钟讲稿对应时间轴。
