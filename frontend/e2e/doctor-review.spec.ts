/**
 * E2E Case 2 —— 医生审核流程：
 * 登录医生 → 查看任务 → claim → 提交确认 → 任务完成。
 *
 * 同时验证操作面板完全由 allowedActions（镜像后端动作矩阵）驱动：
 * FINAL_CLINICAL_REVIEW + VALID_PREDICTION 只渲染
 * 确认 / 修正 / 无法确认 三个动作，绝无质量审核动作。
 */
import { expect, test } from '@playwright/test'
import { DOCTOR_USER, jsonOk, mockBase } from './support/mocks'

const TASK_ID = 'task-e2e-9001'
const WF_ID = 'wf-e2e-9001'

/** 医生视图：后端 DoctorInferenceView 投影（含证据 / 解释 / 溯源材料） */
const doctorView = {
  workflowId: WF_ID,
  status: 'WAITING_HUMAN_REVIEW',
  segment: 'human-review',
  progress: {
    current: 'human-review',
    completed: ['created', 'queued', 'image-quality', 'ai-analysis', 'evidence', 'explanation'],
  },
  resultAvailability: { patientVisible: false, doctorReviewRequired: true },
  result: {
    inferenceOutcomeType: 'VALID_PREDICTION',
    qualityOutcome: 'PASS',
    qualityScore: '0.91',
    imageObjectReference: 'oss://fundus/e2e-9001.jpg',
    inferredAt: '2026-07-28T10:20:00Z',
    predictionSnapshot: 'DR_STAGE_2 (calibrated 0.87)',
    confidenceSnapshot: '0.87',
    calibrationSnapshot: 'temperature=1.18',
    oodSnapshot: 'in-distribution (score 0.03)',
    modelVersion: 'fundus-cls-v3.1',
    modelWeightFingerprint: 'sha256:ab12cd34',
    preprocessVersion: 'prep-2.4',
    inferencePolicyVersion: 'policy-7',
  },
}

test('医生：任务列表 → claim → allowedActions 驱动提交 → 完成', async ({ page }) => {
  await mockBase(page, DOCTOR_USER)

  await page.route('**/api/reviews/tasks', async (route) => {
    await route.fulfill(
      jsonOk([{ taskId: TASK_ID, workflowId: WF_ID, reason: 'FINAL_CLINICAL_REVIEW' }]),
    )
  })
  await page.route(`**/api/diagnosis/workflows/${WF_ID}`, async (route) => {
    await route.fulfill(jsonOk(doctorView))
  })

  let claimCalled = false
  await page.route(`**/api/reviews/tasks/${TASK_ID}/claim`, async (route) => {
    claimCalled = true
    await route.fulfill(jsonOk(null))
  })

  let submittedBody: Record<string, unknown> | null = null
  await page.route(`**/api/reviews/tasks/${TASK_ID}/submit`, async (route) => {
    submittedBody = route.request().postDataJSON() as Record<string, unknown>
    await route.fulfill(
      jsonOk({
        taskId: TASK_ID,
        workflowId: WF_ID,
        committedWorkflowVersion: 7,
        resumeJobId: 'resume-job-42',
      }),
    )
  })

  // ---- 任务列表 ----
  await page.goto('/doctor/reviews')
  await expect(page.getByTestId('tasks-table')).toBeVisible()
  const row = page.locator(`[data-task-id="${TASK_ID}"]`)
  await expect(row).toContainText(WF_ID)
  await expect(row).toContainText('最终临床审核')

  // ---- 打开详情：AI 材料齐备 ----
  await row.getByTestId('open-task').click()
  await expect(page).toHaveURL(new RegExp(`/doctor/reviews/${TASK_ID}`))
  await expect(page.getByTestId('evidence-card')).toBeVisible()
  await expect(page.getByTestId('explanation-card')).toBeVisible()
  await expect(page.getByTestId('evidence-card')).toContainText('DR_STAGE_2')
  await expect(page.getByTestId('explanation-card')).toContainText('fundus-cls-v3.1')

  // 未认领前只有提示，无操作面板
  await expect(page.getByTestId('claim-hint')).toBeVisible()
  await expect(page.getByTestId('review-action-panel')).toHaveCount(0)

  // ---- claim ----
  await page.getByTestId('claim-task').click()
  await expect(page.getByTestId('review-action-panel')).toBeVisible()
  expect(claimCalled).toBe(true)

  // ---- allowedActions 驱动：只出现动作矩阵允许的三个按钮 ----
  const actions = page.locator('[data-testid="review-action-panel"] [data-action]')
  await expect(actions).toHaveCount(3)
  await expect(page.locator('[data-action="CONFIRM_AI_ASSESSMENT"]')).toBeVisible()
  await expect(page.locator('[data-action="CORRECT_AI_ASSESSMENT"]')).toBeVisible()
  await expect(page.locator('[data-action="INCONCLUSIVE"]')).toBeVisible()
  // 质量审核动作绝不能出现在最终临床审核里
  await expect(page.locator('[data-action="APPROVE_CONTINUE"]')).toHaveCount(0)
  await expect(page.locator('[data-action="REJECT_RESUBMIT"]')).toHaveCount(0)

  // 未选择动作前提交按钮禁用
  await expect(page.getByTestId('review-submit')).toBeDisabled()

  // ---- 提交确认 ----
  await page.locator('[data-action="CONFIRM_AI_ASSESSMENT"]').click()
  await page.getByTestId('review-comment').fill('影像与 AI 结论一致，予以确认。')
  await page.getByTestId('review-submit').click()

  // ---- 完成回执（Workflow Resume 已触发） ----
  await expect(page.getByTestId('submission-done')).toBeVisible()
  await expect(page.getByTestId('submission-done')).toContainText('resume-job-42')
  expect(submittedBody).not.toBeNull()
  expect(submittedBody!.decision).toBe('CONFIRM_AI_ASSESSMENT')
})
