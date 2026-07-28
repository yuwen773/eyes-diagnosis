/**
 * E2E Case 1 —— 患者完整流程：
 * 创建诊断 → 查看进度 → 收到 SSE（done）→ 查看结果。
 *
 * 同时执行患者暴露门禁：即使后端响应中混入敏感字段，
 * 患者页面 DOM 也不得出现 rawPrediction / topK / modelScore / abstainReason。
 */
import { expect, test } from '@playwright/test'
import { jsonOk, mockBase, PATIENT_USER, sseBody } from './support/mocks'

const WF_ID = 'wf-e2e-0001'

/** 运行中视图（患者投影：无 result） */
const runningView = {
  workflowId: WF_ID,
  status: 'RUNNING',
  segment: 'ai-analysis',
  progress: {
    current: 'ai-analysis',
    completed: ['created', 'queued', 'image-quality'],
  },
  resultAvailability: { patientVisible: false, doctorReviewRequired: false },
  result: null,
}

/**
 * 完成视图。故意在 result 里混入敏感字段，模拟“后端投影失守”的最坏情况 ——
 * 前端白名单投影 toPatientResult 必须把它们全部拦下。
 */
const completedView = {
  workflowId: WF_ID,
  status: 'COMPLETED',
  segment: null,
  progress: {
    current: null,
    completed: ['created', 'queued', 'image-quality', 'ai-analysis', 'evidence', 'explanation'],
  },
  resultAvailability: { patientVisible: true, doctorReviewRequired: false },
  result: {
    diseaseCode: 'DR_STAGE_2',
    calibratedProbability: 0.943,
    // —— 以下敏感字段绝不能出现在患者 DOM ——
    rawPrediction: 'SHOULD_NEVER_RENDER',
    topK: ['SHOULD_NEVER_RENDER'],
    modelScore: 0.999,
    abstainReason: 'SHOULD_NEVER_RENDER',
  },
}

const events = [
  { type: 'WORKFLOW_CREATED', time: '2026-07-28T10:00:00Z', segment: null },
  { type: 'WORKFLOW_QUEUED', time: '2026-07-28T10:00:01Z', segment: null },
  { type: 'SEGMENT_STARTED', time: '2026-07-28T10:00:02Z', segment: 'image-quality' },
  { type: 'SEGMENT_COMPLETED', time: '2026-07-28T10:00:05Z', segment: 'image-quality' },
  { type: 'WORKFLOW_COMPLETED', time: '2026-07-28T10:00:30Z', segment: null },
]

const FORBIDDEN_PATIENT_WORDS = ['rawPrediction', 'topK', 'modelScore', 'abstainReason']

test('患者：创建诊断 → 实时进度（SSE）→ 查看结果', async ({ page }) => {
  await mockBase(page, PATIENT_USER)

  await page.route(`**/api/diagnosis/workflows`, async (route) => {
    if (route.request().method() === 'POST') {
      await route.fulfill(jsonOk({ workflowId: WF_ID, status: 'CREATED' }))
      return
    }
    await route.fallback()
  })
  await page.route(`**/api/diagnosis/workflows/${WF_ID}`, async (route) => {
    await route.fulfill(jsonOk(completedView))
  })
  await page.route(`**/api/diagnosis/workflows/${WF_ID}/events`, async (route) => {
    await route.fulfill(jsonOk(events))
  })
  await page.route(`**/api/diagnosis/workflows/${WF_ID}/stream`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'text/event-stream',
      body: sseBody([runningView, completedView]),
    })
  })

  // ---- 创建诊断 ----
  await page.goto('/diagnosis/create')
  await page.getByTestId('question-input').fill('右眼近一周视物模糊')
  await page.getByTestId('symptom-vision-loss').check()
  await page.getByTestId('create-submit').click()

  await expect(page.getByTestId('create-success')).toBeVisible()
  await expect(page.getByTestId('created-workflow-id')).toHaveText(WF_ID)

  // ---- 进入进度页 ----
  await page.getByTestId('go-detail').click()
  await expect(page).toHaveURL(new RegExp(`/diagnosis/${WF_ID}$`))
  await expect(page.getByTestId('workflow-timeline')).toBeVisible()
  await expect(page.getByTestId('timeline-events')).toBeVisible()

  // ---- SSE done 驱动 UI（非前端状态机推断） ----
  await expect(page.getByTestId('done-hint')).toBeVisible()
  await expect(page.getByTestId('view-result')).toBeVisible()

  // ---- 查看结果 ----
  await page.getByTestId('view-result').click()
  await expect(page).toHaveURL(new RegExp(`/diagnosis/${WF_ID}/result$`))
  await expect(page.getByTestId('patient-result')).toBeVisible()
  await expect(page.getByTestId('disease-code')).toHaveText('DR_STAGE_2')
  await expect(page.getByTestId('calibrated-probability')).toHaveText('94.3%')

  // ---- 患者暴露门禁：敏感字段绝不进 DOM ----
  const dom = await page.content()
  for (const word of FORBIDDEN_PATIENT_WORDS) {
    expect(dom, `患者结果页 DOM 不得包含 ${word}`).not.toContain(word)
  }
  expect(dom).not.toContain('SHOULD_NEVER_RENDER')
})

test('患者：受限结果（COMPLETED_LIMITED）只展示通用说明', async ({ page }) => {
  await mockBase(page, PATIENT_USER)

  const limitedView = {
    workflowId: WF_ID,
    status: 'COMPLETED_LIMITED',
    segment: null,
    progress: { current: null, completed: ['created', 'queued', 'image-quality', 'ai-analysis'] },
    resultAvailability: { patientVisible: false, doctorReviewRequired: true },
    result: null,
  }
  await page.route(`**/api/diagnosis/workflows/${WF_ID}`, async (route) => {
    await route.fulfill(jsonOk(limitedView))
  })

  await page.goto(`/diagnosis/${WF_ID}/result`)
  await expect(page.getByTestId('limited-result')).toBeVisible()
  await expect(page.getByTestId('patient-result')).toHaveCount(0)

  const dom = await page.content()
  for (const word of FORBIDDEN_PATIENT_WORDS) {
    expect(dom, `受限结果页 DOM 不得包含 ${word}`).not.toContain(word)
  }
})
