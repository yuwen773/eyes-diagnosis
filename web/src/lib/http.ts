/**
 * 全站唯一的 HTTP 信封层。
 *
 * <p>业务域 API（`api.ts` / `adminApi.ts`）只描述端点与入参，信封解包、网络错误、
 * 未登录广播都在这里做一份。以前两处各写一份，40101 的广播行为都分叉了。
 *
 * <p>401 规则：**非 `silentAuth` 时，40100 与 40101 都广播**；跳不跳由
 * `App.tsx` 的 `AuthRedirect` 按 code + 当前登录态决定（40100 一律跳；
 * 40101 只在本就匿名时跳）。`silentAuth` 用于「匿名也是正常结果」的探测。
 */

import { ApiError } from "./api-error"

export { ApiError }

const BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "/api"

export { BASE_URL }

/**
 * 未登录 / 无权限事件。业务接口回 401xx 时广播，由路由层决定跳不跳。
 * 会话探测 getLoginUser 不广播——匿名访问是常态，不能把人一脚踢去登录。
 */
export const AUTH_EXPIRED_EVENT = "eye:auth-expired"

export type AuthExpiredDetail = { code: number }

/** 需要广播的认证类业务码。 */
const AUTH_CODES = new Set([40100, 40101])

export function notifyAuthExpired(code: number) {
  window.dispatchEvent(
    new CustomEvent<AuthExpiredDetail>(AUTH_EXPIRED_EVENT, { detail: { code } }),
  )
}

export type Envelope<T> = {
  code?: number
  data?: T
  msg?: string
}

export type RequestOptions = {
  /** 401xx 不广播未登录事件（用于会话探测这类「匿名也是正常结果」的调用）。 */
  silentAuth?: boolean
}

export async function request<T>(
  path: string,
  init: RequestInit = {},
  options: RequestOptions = {},
): Promise<T> {
  const isForm = init.body instanceof FormData
  let response: Response

  try {
    response = await fetch(`${BASE_URL}${path}`, {
      credentials: "include",
      ...init,
      headers: {
        Accept: "application/json",
        ...(isForm ? {} : { "Content-Type": "application/json" }),
        ...init.headers,
      },
    })
  } catch (error) {
    // 调用方主动取消（切账号 / 组件卸载）不是网络故障：原样抛出 AbortError，
    // TanStack Query 才能把它识别成取消而不是「网络不可用」。
    if (init.signal?.aborted) throw error
    throw new ApiError(-1, "网络不可用，请检查连接后重试")
  }

  if (!response.ok) {
    throw new ApiError(response.status, `服务返回 ${response.status}`)
  }

  const payload = (await response.json()) as Envelope<T>
  if (payload.code !== 0) {
    const code = payload.code ?? -1
    if (AUTH_CODES.has(code) && !options.silentAuth) {
      notifyAuthExpired(code)
    }
    throw new ApiError(code, payload.msg || "请求未完成")
  }

  return payload.data as T
}

/**
 * SSE 打开阶段遇到非流式响应（错误信封、意外 JSON、代理错误页）时的统一口径：
 * 解析响应体 → 认证类业务码广播未登录 → 抛出带真实 code 的 ApiError。
 * 响应体不是 JSON 时退回 HTTP 状态码，绝不把异常响应当成流继续读。
 */
export async function rejectNonStreamResponse(
  response: Response,
  fallback: string,
): Promise<never> {
  let payload: Envelope<unknown> | null = null
  try {
    payload = (await response.json()) as Envelope<unknown>
  } catch {
    // 响应体不是 JSON（代理错误页、空体）：退回 HTTP 状态码。
  }
  const code = payload?.code
  if (code !== undefined && AUTH_CODES.has(code)) notifyAuthExpired(code)
  throw new ApiError(code ?? response.status, payload?.msg || fallback)
}

/**
 * 分页信封。计数字段线上是字符串（后端全局 Long→String），
 * 统一转回 number，分页算术才不会踩到 "13" 这种值。
 */
export type RawPage<T> = {
  records?: T[]
  total?: number | string
  size?: number | string
  current?: number | string
  pages?: number | string
}

export type Page<T> = {
  records?: T[]
  total?: number
  size?: number
  current?: number
  pages?: number
}

export function toPage<T>(raw: RawPage<T>): Page<T> {
  const num = (value?: number | string) =>
    value === undefined || value === null ? undefined : Number(value)
  return {
    records: raw.records,
    total: num(raw.total),
    size: num(raw.size),
    current: num(raw.current),
    pages: num(raw.pages),
  }
}
