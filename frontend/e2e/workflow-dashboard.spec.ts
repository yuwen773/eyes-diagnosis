/**
 * E2E Case 3 —— 诊断运营 Dashboard 冒烟：
 * 访问 /workflow/dashboard，确认页面渲染且统计请求
 * 走同源 /api/workflow/stats/summary（被 mock 兜底为 code 0 / data null），
 * 加载失败时优雅降级显示「暂无数据」。
 */
import { expect, test } from '@playwright/test'
import { mockBase, PATIENT_USER } from './support/mocks'

test('运营看板：可达且加载失败时降级显示「暂无数据」', async ({ page }) => {
  await mockBase(page, PATIENT_USER)

  await page.goto('/workflow/dashboard')

  await expect(page.getByRole('heading', { name: '诊断运营看板' })).toBeVisible()
  // mock 兜底返回 code 0 / data null → 优雅降级
  await expect(page.getByTestId('dashboard-empty')).toBeVisible()
  await expect(page.getByText('暂无数据')).toBeVisible()
})
