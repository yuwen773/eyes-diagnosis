/**
 * 后端契约封装。端点与请求体与现有 Java 服务保持一致：
 * 统一返回 { code: 0, data, msg }，会话走 Spring Session Cookie。
 */

import { fetchEventSource } from "@microsoft/fetch-event-source"

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

/* ── 新闻资讯 ───────────────────────────────────────────── */

export type NewsItem = {
  /** 后端把 Long 序列化成字符串（雪花 id 超出 JS 安全整数）。 */
  id?: string | number
  title?: string
  author?: string
  avatar?: string | null
  /** 富文本 HTML。 */
  content?: string
  summary?: string
  coverImage?: string
  /** "YYYY-MM-DD HH:mm:ss"，无时区。 */
  publishTime?: string
}

export type NewsPage = {
  records?: NewsItem[]
  total?: number
  size?: number
  current?: number
  pages?: number
}

export type NewsQuery = {
  current?: number
  pageSize?: number
  /** 按标题模糊检索。 */
  title?: string
  sortField?: string
  sortOrder?: string
}

/** 资讯分页。默认按发布时间倒序——不传 sortField 时后端不排序，返回的是主键升序。 */
export function listNews(query: NewsQuery = {}) {
  return request<NewsPage>("/news/list/page/vo", {
    method: "POST",
    body: JSON.stringify({
      current: 1,
      pageSize: 9,
      sortField: "publishTime",
      sortOrder: "descend",
      ...query,
    }),
  })
}

export function getNews(id: string | number) {
  return request<NewsItem>(`/news/get/${id}`, { method: "GET" })
}

/* ── Agent 智能对话 ─────────────────────────────────────── */

export type AgentSessionVO = {
  sessionId: string
  title: string
  lastMessage: string
  messageCount: number
  summaryContent: string
  createdTime: string
  updatedTime: string
  isPinned?: boolean
}

export type HistoryMessageVO = {
  id: number
  role: string
  subType: string
  content: string
  isSummary: boolean
  createdTime: string
}

export type ChatHistoryVO = {
  messages: HistoryMessageVO[]
  hasMore: boolean
  nextCursor: number | null
}

export function getSessions(beforeId?: string, limit = 20) {
  let path = `/agent/sessions?limit=${limit}`
  if (beforeId) path += `&beforeId=${beforeId}`
  return request<AgentSessionVO[]>(path)
}

export function deleteSession(sessionId: string) {
  return request<boolean>(`/agent/sessions/${sessionId}`, { method: "DELETE" })
}

export function batchDeleteSessions(sessionIds: string[]) {
  return request<number>("/agent/sessions/batch", {
    method: "DELETE",
    body: JSON.stringify({ sessionIds }),
  })
}

export function updateSessionTitle(sessionId: string, title: string) {
  return request<boolean>(`/agent/sessions/${sessionId}/title`, {
    method: "PUT",
    body: JSON.stringify({ title }),
  })
}

export function updatePinStatus(sessionId: string, pinned: boolean) {
  return request<boolean>(`/agent/sessions/${sessionId}/pin`, {
    method: "PUT",
    body: JSON.stringify({ pinned }),
  })
}

export function generateTitle(sessionId: string, firstMessage: string) {
  return request<boolean>(`/agent/sessions/${sessionId}/generate-title`, {
    method: "POST",
    body: JSON.stringify({ firstMessage }),
  })
}

export function getChatHistory(threadId: string, beforeId?: number, limit = 40) {
  let path = `/agent/history/${threadId}?limit=${limit}`
  if (beforeId) path += `&beforeId=${beforeId}`
  return request<ChatHistoryVO>(path)
}

export function exportSession(sessionId: string, format: "markdown" | "json") {
  return request<string>(`/agent/history/${sessionId}/export?format=${format}`)
}

export function uploadAgentImage(file: File) {
  const form = new FormData()
  form.append("file", file)
  return request<string>("/agent/image/upload", {
    method: "POST",
    body: form,
  })
}

export function deleteAgentImage(url: string) {
  return request<boolean>("/agent/image/upload/delete", {
    method: "POST",
    body: JSON.stringify({ url }),
  })
}

/* ── Agent SSE 流 ──────────────────────────────────────── */

/** 后端 MessageDTO 的流事件载荷。messageType 序列化自枚举，大小写不保证。 */
export type AgentStreamDTO = {
  messageType: string
  content?: string
  toolCalls?: { name: string; arguments: string }[]
  toolName?: string
}

export type StreamChatHandlers = {
  onEvent(dto: AgentStreamDTO): void
  onDone(): void
  onError(err: unknown): void
}

/**
 * SSE 流式对话。不能走 request<T>——它解 JSON 信封，会破坏事件流。
 * 未收到 done 事件就断流（网络闪断、服务重启）时抛「连接中断」，
 * 调用方据此回滚本回合上传的图片。
 */
export async function streamChat(
  body: { message: string; threadId: string; imageUrls?: string[] },
  handlers: StreamChatHandlers,
  signal: AbortSignal,
): Promise<void> {
  let completed = false
  await fetchEventSource(`${BASE_URL}/agent/chat/stream`, {
    method: "POST",
    headers: { Accept: "text/event-stream", "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
    credentials: "include",
    openWhenHidden: true,

    async onopen(response) {
      if (response.ok) return
      throw new ApiError(response.status, `服务返回 ${response.status}`)
    },

    onmessage(event) {
      if (event.event === "done") {
        completed = true
        return
      }
      if (event.event === "error") {
        throw new ApiError(-1, event.data || "对话服务出错")
      }
      if (!event.data) return
      try {
        const dto = JSON.parse(event.data) as AgentStreamDTO
        dto.messageType = (dto.messageType ?? "").toLowerCase()
        handlers.onEvent(dto)
      } catch (e) {
        // 单片解析失败不中断整条流
        console.error("SSE 数据解析失败", e)
      }
    },

    onclose() {
      if (!completed) {
        throw new ApiError(-1, "连接中断")
      }
      handlers.onDone()
    },

    onerror(err) {
      completed = false
      handlers.onError(err)
      throw err
    },
  })
}

export type ErrorDetail = {
  /** 机器可读的错误码：HTTP 状态码或后端业务码。 */
  code: number | null
  /** 给用户看的那句话——说清发生了什么、接下来怎么办。 */
  text: string
}

/**
 * 把传输层的错误翻成人话。
 *
 * 后端回的是错误码加一句技术描述（「服务返回 502」「请求数据不存在」）。
 * 页面要说的是另一回事：没读出来，还是没连上，还是这条已经不在了。
 */
export function describeError(cause: unknown): ErrorDetail {
  if (!(cause instanceof ApiError)) {
    return { code: null, text: "出了点意料之外的情况，这条内容没能读出来。" }
  }

  const { code } = cause
  if (code === -1) return { code, text: "连不上服务，请检查网络后再试一次。" }
  if (code === 40100) return { code, text: "这条内容需要登录后才能查看。" }
  if (code === 40101 || code === 40300) {
    return { code, text: "你没有查看这条内容的权限。" }
  }
  if (code === 40400 || code === 404) {
    return { code, text: "后端没有找到这条内容，它可能已经下架了。" }
  }
  if (code === 40000) return { code, text: "这次请求的条件不对，换个条件再试。" }
  if (code >= 500) {
    return { code, text: "服务这会儿没有响应，通常是临时的，过一会儿再试。" }
  }
  return { code, text: cause.message }
}
