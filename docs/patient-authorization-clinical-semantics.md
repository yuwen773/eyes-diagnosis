# ADR：患者授权保存 与 临床人工复核 的语义拆分（D-01）

- 状态：**Proposed（待医学 owner 批准）**
- 日期：2026-11-18
- 关联：`docs/patient-authorization.md`、`docs/doctor-review.md`、`docs/reviews/iris-r3-final-integration-readiness.md` §7.4 D-01
- 影响面：`PatientAuthorizationService.approve()`、`DiagnosisResultVO`、`web/src/components/RecordSheet.tsx`

## 1. 问题（事实陈述）

`PatientAuthorizationService.approve()` 在患者确认保存后，向正式表 `t_diagnosis` 写入一行，
其中 `humanReviewStatus` **硬编码为 `'AI_ONLY'`**（`PatientAuthorizationService.java:83`），
同时写入 `patientTaskId` 与 `t_patient_authorization.receiptId / authorizedAt`。

产品后果：

| 界面 | 显示的 | 真实发生的 |
|---|---|---|
| 协作工作台 | 「医生已批准」「患者已授权已保存」 | 确实发生了 |
| 判读记录纸 `/records/:id` | 人工复核 · **待复核** | 临床人工复核**没有**发生（这一半是真的） |
| 记录纸正文 | 「签字前不得作为诊疗依据」 | 患者已经签字保存 |
| 记录纸 `details` | 「完整冻结内容可追溯至任务回执」 | VO **不暴露** `patientTaskId` / `receiptId`，无法追溯 |

矛盾不在「待复核」三个字，而在**把两件不同的事压进同一个词**：
患者授权保存一份经医生批准的**辅助说明**，与这份**正式诊断记录**是否完成临床人工复核，
是两条独立的流程。

## 2. 决定

**不把 `humanReviewStatus` 改成 `REVIEWED`。**

理由：患者授权 ≠ 医生对这名患者的临床诊断做过复核。把状态改成 `REVIEWED` 等于在数据库里
伪造一次从未发生的医疗行为；而 `humanReviewStatus` 在管理端、复核队列、统计口径里有 10 处消费者，
污染它的语义会连带污染这些读数。

**也不新增 `PATIENT_AUTHORIZED` 到 `humanReviewStatus` 的取值域。**

理由：`HumanReviewStatus` 表达的是「谁来复核过这份记录」。把「来源」塞进「复核状态」，
以后每加一种来源就要扩一次状态机，且会让「待复核」与「已授权」在同一字段里互斥——它们并不互斥。

### 2.1 三个事实，三个字段

| 事实 | 载体 | 谁写 |
|---|---|---|
| ① 协作草稿是否经医生审核批准 | `t_doctor_review`（既有） | 医生 |
| ② 患者是否授权保存辅助说明 | `t_patient_authorization.status='APPROVED'` + `receiptId` + `authorizedAt`（既有） | 患者 |
| ③ 正式诊断记录是否完成临床人工复核 | `t_diagnosis.humanReviewStatus` + `humanReviewerId` + `humanReviewedAt`（既有） | 医生 |

本轮**不改任何一张表**、**不改任何状态机**。缺口只在于 ② 没有出现在面向患者的报告上。

### 2.2 新增只读投影（`DiagnosisResultVO`）

```java
/** 来源任务 id；非协作保存的记录为 null */
private String patientTaskId;
/** 记录来源：PATIENT_AUTHORIZED_NOTE = 患者授权保存的辅助说明；其他为 null */
private String recordSource;
/** 授权回执号（仅本人可读） */
private String authorizationReceiptId;
/** 患者授权时间 */
private Date authorizedAt;
/** 该说明在保存时的草稿复核状态（DOCTOR_APPROVED） */
private String draftReviewState;
```

三条硬性约束：

1. **只在 `getOwnedDiagnosis` 的 owner 路径上填充**。管理端列表（`DiagnosisManageVO`）不新增字段，
   避免把患者授权回执扩散到管理员视图。
2. 字段全部**只读投影**，不接受任何写入；`voToObj` 不认识它们。
3. `humanReviewStatus` 原样返回 `AI_ONLY`，`requiresReview` 原样返回 `false`。
   **报告仍然说「未完成临床人工复核」——这是真的。**

### 2.3 报告页的呈现（`RecordSheet`）

`recordSource === "PATIENT_AUTHORIZED_NOTE"` 时，在「人工复核」读数下方追加一个**来源区块**：

```
本次报告来源 · SOURCE
  患者已授权保存协作说明 · 回执 9f2c…（授权时间 2026-11-17 22:41）
  协作草稿曾经医生批准 · 草稿复核：医生已批准
  临床人工复核 · 待复核 ← 与上面的草稿复核不是同一条流程
```

未授权的历史记录不显示该区块，措辞与现在完全一致。

正文里「签字前不得作为诊疗依据」改为条件句：仅当 `recordSource == null` 时保留；
协作保存的记录改为「本说明已由患者授权保存，仍不代表完成临床人工复核」。

## 3. 被明确拒绝的做法

| 做法 | 为什么不做 |
|---|---|
| 保存即写 `REVIEWED` + 复核人/时间 | 伪造一次没有发生的临床复核；管理端复核队列会少掉一条真正待办 |
| 新增 `PATIENT_AUTHORIZED` 状态值 | 把「来源」塞进「复核状态」，两者不互斥，后续每加一类来源就要扩状态机 |
| 前端只改文案、后端不动 | 「可追溯至任务回执」仍然无法自证；改文案等于把不可核验的说法换个说法 |
| 把 `imageSrc` 为空解释成「未归档」 | 见 D-06：原图在 `t_diagnosis_task` 里，医生可经 `/doctor-reviews/{id}/image` 回放 |

## 4. D-06 联动：影像归档状态

当前报告用 `imageSrc` 是否有值推断「原图已归档」。这两个命题不等价：

- 原图确实未保存（存储失败，`/diagnosis` 路径会中止判读，不应产生记录）
- 原图已保存但隐私策略不允许直接展示（`/diagnosis-tasks` 的 `RESTRICTED` 任务，`t_diagnosis.url` 为空）
- 影像读取权限不足（不是 owner、没有授权）
- 影像当前不可获取（后端故障）
- 来源状态未知（老数据）

**决定**：在上述 §2.2 投影里增加 `imageArchivalState`，取值
`ARCHIVED` / `ARCHIVED_NOT_PUBLIC` / `NOT_ARCHIVED` / `UNKNOWN`。
后端能判定才填，判不了就填 `UNKNOWN`。前端三态渲染：

| 值 | 文案 |
|---|---|
| `ARCHIVED` | 原图 · 已随记录归档（可展示时给图） |
| `ARCHIVED_NOT_PUBLIC` | 原图 · 已归档，按隐私策略不在此处展示 |
| `NOT_ARCHIVED` | 原图 · 未保存（本次未归档） |
| `UNKNOWN` / null | 原图 · 归档状态未确认 / 影像访问受限 |

**不允许**继续用 `imageSrc` 空值反推「未归档」。

## 5. 验收测试（实现时必须全部有）

| # | 场景 | 断言 |
|---|---|---|
| 1 | 医生批准协作草稿 | `t_doctor_review` 记录状态为批准，且**不改** `humanReviewStatus` |
| 2 | 患者授权保存 | 产生 `t_diagnosis` 行；`humanReviewStatus='AI_ONLY'`；`patientTaskId` 有值 |
| 3 | 重复授权（同任务再次 approve） | 幂等：仍只有一条 `t_diagnosis`，回执不变 |
| 4 | 授权过期后保存 | 拒绝（`SaveConflict`），不落库 |
| 5 | 来源撤销后保存 | 拒绝；任务置 `RESTRICTED` |
| 6 | 预览后审核材料变化（版本/摘要不符） | 拒绝，不落库 |
| 7 | 正式诊断未复核 | VO 返回 `AI_ONLY`、`requiresReview=false`、`recordSource=PATIENT_AUTHORIZED_NOTE` |
| 8 | 跨账号读取 | 非 owner 取 `/diagnosis/get/{id}` → 拒绝；回执字段不外泄 |
| 9 | 报告页区分两种「复核」 | 页面同时出现「协作草稿：医生已批准」与「临床人工复核：待复核」，且写明不是同一条流程 |
| 10 | 回执可查 | 页面回执号 == `t_patient_authorization.receiptId` |
| 11 | 有私有影像但无公开 URL | `imageArchivalState=ARCHIVED_NOT_PUBLIC`，文案不是「未归档」 |
| 12 | 无影像记录 | `imageArchivalState=NOT_ARCHIVED` 或 `UNKNOWN`，不虚构 |

## 6. 未关闭的问题（必须由医学 / 产品 owner 决定）

1. **业务口径**：「患者授权保存辅助说明」在产品上是否需要在报告页显式出现？还是应当只在协作工作台可见？
2. **回执范围**：回执号对患者本人可见是否合适（可截图传播）？还是只显示「已授权 + 时间」？
3. **管理端可见性**：管理员是否需要看到「这条记录来自患者授权保存」？（本轮默认**不**给管理端）
4. **临床人工复核队列**：这些 `AI_ONLY` 记录是否应当进入医生复核队列？当前**不**入队
   （`AWAITING_REVIEW` 才入队）。若业务上应该入队，那是状态机的改动，需另开 ADR。

**在 1–4 得到答复前，D-01 保持 `P1 BLOCKED`，#87 不做远端合并。**
本 ADR 给出的是「不伪造、可回退、不动状态机」的实现路径，不等于医疗口径已被批准。
