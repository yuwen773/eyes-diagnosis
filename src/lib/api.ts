/**
 * 后端契约封装。端点与请求体与现有 Java 服务保持一致：
 * 统一返回 { code: 0, data, msg }，会话走 Spring Session Cookie。
 */

const BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "/api"

export class ApiError extends Error {
  readonly code: number

  constructor(code: number, message: string) {
    super(message)
    this.name = "ApiError"
    this.code = code
  }
}

type Envelope<T> = {
  code?: number
  data?: T
  msg?: string
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
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
  } catch {
    throw new ApiError(-1, "网络不可用，请检查连接后重试")
  }

  if (!response.ok) {
    throw new ApiError(response.status, `服务返回 ${response.status}`)
  }

  const payload = (await response.json()) as Envelope<T>
  if (payload.code !== 0) {
    throw new ApiError(payload.code ?? -1, payload.msg || "请求未完成")
  }

  return payload.data as T
}

/* ── 用户 ─────────────────────────────────────────────── */

export type LoginUser = {
  id?: number
  userAccount?: string
  userName?: string
  userAvatar?: string
  userProfile?: string
  userRole?: string
  createTime?: string
}

export function login(body: { userAccount: string; userPassword: string }) {
  return request<LoginUser>("/user/login", {
    method: "POST",
    body: JSON.stringify(body),
  })
}

export function register(body: {
  userAccount: string
  userPassword: string
  checkPassword: string
}) {
  return request<number>("/user/register", {
    method: "POST",
    body: JSON.stringify(body),
  })
}

export function getLoginUser() {
  return request<LoginUser>("/user/get/login", { method: "GET" })
}

export function logout() {
  return request<boolean>("/user/logout", { method: "POST" })
}

/* ── 诊断 ─────────────────────────────────────────────── */

export type Disease = {
  name?: string
  probability?: number
}

export type DiagnosisResult = {
  id?: number
  url?: string
  result?: string
  probability?: number
  confidence?: number
  recommendations?: string
  details?: string
  severity?: string
  createTime?: string
  otherDisease?: Disease[]
  /* 负责任 AI 字段 */
  aiRejected?: boolean
  abstainReason?: string
  modelVersion?: string
  weightSha256?: string
  humanReviewStatus?: string
  humanResult?: string
  humanSeverity?: string
  humanRecommendations?: string
  humanReviewNote?: string
  disclaimer?: string
  requiresReview?: boolean
  qualityScore?: number
  qualityReasons?: string
  calibratedProbability?: number
  calibrationStatus?: string
  oodStatus?: string
  oodScore?: number
}

export type UploadedPicture = {
  id?: number
  url?: string
  status?: string
}

export function uploadPicture(file: File) {
  const form = new FormData()
  form.append("file", file)
  return request<UploadedPicture>("/diagnosis/upload", {
    method: "POST",
    body: form,
  })
}

export function runDiagnosis(file: File) {
  const form = new FormData()
  form.append("file", file)
  return request<DiagnosisResult>("/diagnosis/diagnosis", {
    method: "POST",
    body: form,
  })
}
