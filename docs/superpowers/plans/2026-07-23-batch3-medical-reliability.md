# 第三批 医疗可靠性 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让诊断结果在"图像质量不合格 / 分布外 / 模型不自信 / 类别有限 / 缺合规声明 / 缺人工复核"时具备可拒绝、可解释、可追溯的真实可靠性,并在前端与导出报告中明确告知用户 AI 结论的边界。

**Architecture:** 在 Python 推理侧新增前置质量门 + OOD 门 + 置信度校准 + 类别级指标 + 模型版本/权重指纹,把 `Diagnosis` 表拆出 `aiOutput` 与 `humanReview` 双通道,并在前端结果页、报告页、PDF/CSV 导出中固定显示医学免责声明;管理与后端按"AI 仅辅助,人工才作准"重新表达。所有新增字段通过 Flyway 迁移,老数据迁移策略为"AI 字段保持原值,复审状态置为 PENDING"。

**Tech Stack:** Java 21 / Spring Boot 3.5.6 / MyBatis Plus 3.5.12 / Flyway 10 / Python 3.10 / PyTorch 2 / torchvision / scikit-learn / Pillow / protobuf 4 / Vue 3 + TypeScript / Ant Design Vue 4 / jsPDF + papaparse。

## Global Constraints

- 当前分支为 `master`;执行前使用 `superpowers:using-git-worktrees` 创建隔离 worktree。
- 不得覆盖 `docs/superpowers/plans/2026-07-23-p0-security-lockdown.md`、`2026-07-23-batch2-stability.md`、`2026-07-23-repo-cleanup.md`。
- 每 Task 独立提交;提交信息遵循仓库已有中文 Conventional Commit 风格。
- 第一批已卸载随机 severity、改写 BCrypt、收敛 CORS 到白名单;第二批已经拆分推理缓存与用户诊断记录、引入 SHA-256 与 Flyway;本批继续遵循"AI 字段不跨用户复用、严重程度必须 NOT_ASSESSED(除非真正评估)"。
- 本批不引入新的 SaaS / 远程模型 / 第三方 LLM。所有"图像质量"判断必须可用 CPU、纯 OpenCV / Pillow / torchvision 推理完成;如不可避免地要引入额外包,必须在 commit message 中显式说明。
- 任何返回页面的 AI 字段必须经过 `aiOutput=false` 的人为检查在前端被识别为"未识别 / 拒识",不得再次被包装为"诊断结果"。
- 所有用户与 owner 隔离逻辑必须以参数或 Session 注入,绝不允许由请求体或工具入参控制 owner。
- 实现遵循 TDD:先写失败测试,确认失败原因,最小实现,确认通过,最后提交。
- 完成前运行占位扫描:`git diff --check`,并确保变更中无 `TODO`、`test.skip`、`.only`、空实现和未实现分支。

---

## 文件结构总览

### 新增

- `algorithm/eye_diagnosis/quality.py` — 图像质量评估
- `algorithm/eye_diagnosis/ood.py` — OOD 检测
- `algorithm/eye_diagnosis/calibration.py` — 温度缩放 + ECE
- `algorithm/eye_diagnosis/registry.py` — 模型版本 + SHA-256
- `algorithm/eye_diagnosis/metrics.py` — 类别级指标
- `algorithm/eye_diagnosis/frozen_eval.py` — 冻结验证集评估
- `algorithm/eye_diagnosis/abstain.py` — Reject / Abstain 决策器
- `algorithm/eye_diagnosis/tests/test_quality.py`
- `algorithm/eye_diagnosis/tests/test_ood.py`
- `algorithm/eye_diagnosis/tests/test_calibration.py`
- `algorithm/eye_diagnosis/tests/test_registry.py`
- `algorithm/eye_diagnosis/tests/test_metrics.py`
- `algorithm/eye_diagnosis/tests/test_abstain.py`
- `algorithm/eye_diagnosis/tests/test_frozen_eval.py`
- `algorithm/datasets/frozen_validation_manifest.example.json`
- `algorithm/checkpoints/registry.json`
- `src/main/java/com/csust/eyediagnosis/diagnosis/reject/AbstainReason.java`
- `src/main/java/com/csust/eyediagnosis/constant/HumanReviewStatus.java`
- `src/main/resources/db/migration/V5__medical_reliability.sql`
- `src/main/java/com/csust/eyediagnosis/model/vo/diagnosis/DisclaimerVO.java`
- `frontend/src/components/medical/MedicalDisclaimer.vue`
- `frontend/src/components/medical/AbstainNotice.vue`
- `frontend/src/components/medical/HumanReviewBadge.vue`
- `frontend/src/components/medical/ModelProvenance.vue`
- `frontend/src/components/medical/__tests__/MedicalDisclaimer.spec.ts`
- `frontend/src/components/medical/__tests__/AbstainNotice.spec.ts`
- `frontend/src/components/medical/__tests__/HumanReviewBadge.spec.ts`
- `algorithm/configs/calibration/efficientnet_b4_temperature.json`

### 修改

- `algorithm/grpc_server.py` — 接入质量门 + OOD + 校准 + 拒绝
- `algorithm/mcp_server/diagnosis.py` — 同步
- `algorithm/eye_disease_model.py` — `predict_with_provenance`
- `src/main/java/com/csust/eyediagnosis/service/impl/DiagnosisServiceImpl.java`
- `src/main/java/com/csust/eyediagnosis/model/entity/Diagnosis.java`
- `src/main/java/com/csust/eyediagnosis/controller/DiagnosisController.java`
- `src/main/java/com/csust/eyediagnosis/grpc/DiagnosisGrpcClient.java`
- `src/main/java/com/csust/eyediagnosis/service/DiagnosisService.java`
- `src/main/java/com/csust/eyediagnosis/model/dto/diagnosis/DiagnosisResultDTO.java`
- `src/main/java/com/csust/eyediagnosis/model/vo/diagnosis/DiagnosisResultVO.java`
- `src/main/java/com/csust/eyediagnosis/exception/ErrorCode.java`
- `frontend/src/components/diagnosis/DiagnosisResult.vue`
- `frontend/src/components/user/DiagnosisReportDetail.vue`
- `frontend/src/pages/admin/DiagnosisManagePage.vue`
- `frontend/src/utils/exportUtils.ts`
- `pom.xml`
- `algorithm/diagnosis.proto`
- `algorithm/requirements.txt`

(Full per-task steps follow; refer to handoff for verbatim code blocks.)