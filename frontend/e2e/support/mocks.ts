/**
 * PR-11 E2E 共享 mock：以确定性的后端替身覆盖 /api/**。
 *
 * 注意：mock 只是 PR-10 冻结契约的复读机，字段与真实后端逐字一致；
 * E2E 验证的是前端对契约的消费方式，而非后端行为本身。
 */
import type { Page } from '@playwright/test'

export interface MockUser {
  id: string
  userName: string
  userRole: 'user' | 'doctor' | 'admin'
  userAvatar?: string
}

export const PATIENT_USER: MockUser = {
  id: '1001',
  userName: 'E2E患者',
  userRole: 'user',
}

export const DOCTOR_USER: MockUser = {
  id: '2001',
  userName: 'E2E医生',
  userRole: 'doctor',
}

const ok = (data: unknown) =>
  JSON.stringify({ code: 0, msg: 'ok', data })

/**
 * 注册基础 mock：
 * 1. 兜底 /api/** → code 0 空数据（避免未覆盖端点导致悬挂）
 * 2. 登录态 /api/user/get/login → 指定角色
 */
export async function mockBase(page: Page, user: MockUser) {
  await page.route('**/api/**', async (route) => {
    // 只拦截真正的后端 API（路径以 /api/ 开头），
    // 放行 Vite 的源码模块请求（如 /src/api/xxx.ts）。
    const pathname = new URL(route.request().url()).pathname
    if (!pathname.startsWith('/api/')) {
      await route.fallback()
      return
    }
    await route.fulfill({ contentType: 'application/json', body: ok(null) })
  })
  await page.route('**/api/user/get/login', async (route) => {
    await route.fulfill({ contentType: 'application/json', body: ok(user) })
  })
}

export function jsonOk(data: unknown) {
  return { contentType: 'application/json', body: ok(data) }
}

/** 构造 SSE 响应体：若干 message 帧 + 结尾 done 帧 */
export function sseBody(frames: unknown[]): string {
  const parts = frames.map((frame) => `data: ${JSON.stringify(frame)}\n\n`)
  parts.push('event: done\ndata: {}\n\n')
  return parts.join('')
}
