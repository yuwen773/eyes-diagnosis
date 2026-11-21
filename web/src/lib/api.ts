/**
 * 后端契约封装。端点与请求体与现有 Java 服务保持一致：
 * 统一返回 { code: 0, data, msg }，会话走 Spring Session Cookie。
 */

import {
  ApiError,
  BASE_URL,
  rejectNonStreamResponse,
  request,
  toPage,
  type RawPage,
} from "./http"

export { ApiError, AUTH_EXPIRED_EVENT, type AuthExpiredDetail } from "./http"
export type { Page as RecordPage } from "./http"

/* ── 用户 ─────────────────────────────────────────────── */

export type LoginUser = {
  /** 后端 JsonConfig 全局 Long→String，雪花 id 线上是字符串。 */
  id?: string
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
  return request<string>("/user/register", {
    method: "POST",
    body: JSON.stringify(body),
  })
}

export function getLoginUser() {
  // 匿名是正常结果，不触发跳登录
  return request<LoginUser>("/user/get/login", { method: "GET" }, { silentAuth: true })
}

export function logout() {
  // 登出时可能本来就没登录，同样不触发跳登录
  return request<boolean>("/user/logout", { method: "POST" }, { silentAuth: true })
}

/* ── 诊断 ─────────────────────────────────────────────── */

export type Disease = {
  name?: string
  probability?: number
}

export type DiagnosisResult = {
  /** 雪花 id，线上是字符串。 */
  id?: string
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
  preprocessVersion?: string
  inferencePolicyVersion?: string
  calibratedProbability?: number
  calibrationStatus?: string
  oodStatus?: string
  oodScore?: number
  /**
   * 来源与复核的只读投影（仅详情接口下发；列表接口**不带**）。
   *
   * <p>缺省有两种含义：老记录走的是没有投影的接口，或投影读取失败——
   * 后者后端仍会下发一个只有 `imageArchivalState: "UNKNOWN"` 的对象。
   * 两种情况都不能当成「没有授权、没有归档」。
   */
  source?: DiagnosisSource
}

/**
 * 来源投影：把库里**本来分开存着**的三件事并排摆出来，不让报告页再互相猜。
 *
 * <p>草稿是否被批准、患者是否授权保存、有没有做过人工复核——三者不能互相替代。
 * 全部字段只读，后端不接受它们作为写入参数。
 */
export type DiagnosisSource = {
  /** DIRECT = 本人上传直接判读；COLLABORATION_DRAFT = 由协作草稿生成（不代表草稿已获批）。 */
  recordSource?: string | null
  /** 关联的影像任务 id；直接判读为 null。 */
  patientTaskId?: string | null
  /** 协作草稿审核状态 PENDING / APPROVED / REJECTED；无关联草稿为 null。 */
  draftReviewState?: string | null
  /** 患者授权状态 OFFERED / APPROVED / EXPIRED；无授权记录为 null。 */
  authorizationState?: string | null
  /** 授权时间：ISO-8601 **UTC**（带 Z）。展示层负责转本地时间并标注时区。 */
  authorizedAt?: string | null
  /** 回执号**前缀**（前 8 位 + 省略号）；完整回执未开放。 */
  authorizationReceipt?: string | null
  /** 复核人**账号角色**（admin / doctor / user）；不是临床资质证明。 */
  reviewerRole?: string | null
  /** ARCHIVED / ARCHIVED_NOT_PUBLIC / NOT_ARCHIVED / UNKNOWN。 */
  imageArchivalState?: string | null
  /**
   * 授权细节是否按最小权限被隐去（非本人查看时为 true）。
   *
   * <p>为 true 表示「不给看」，**不是**「没有授权」——展示层不得退化成「无授权记录」。
   */
  authorizationDetailsRestricted?: boolean | null
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
  id: string
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
  finishReason?: string
  /** 雪花 id，线上是字符串。 */
  id: string
  role: string
  subType: string
  content: string
  isSummary: boolean
  createdTime: string
  /** Server-authorized upload references, revalidated when history is read. */
  images?: string[]
}

export type ChatHistoryVO = {
  messages: HistoryMessageVO[]
  hasMore: boolean
  nextCursor: string | null
  /**
   * 本会话存在未提交的消息终态（写入失败或待恢复）。
   * 历史仍会返回，但**不完整**——界面必须显式说明，不能装作完整。
   */
  uncommittedTerminal?: boolean
}

export function getSessions(beforeId?: string, limit = 20) {
  let path = `/agent/sessions?limit=${limit}`
  if (beforeId) path += `&beforeId=${beforeId}`
  return request<AgentSessionVO[]>(path).then((sessions) =>
    sessions.map((session) => ({
      ...session,
      createdTime: chatDate(session.createdTime),
      updatedTime: chatDate(session.updatedTime),
    }))
  )
}

/** Java Long 经 JsonConfig 序列化为字符串；兼容工具直接给数字。 */
function chatDate(value: string | number | null) {
  return typeof value === "number" ? new Date(value).toISOString() : (value ?? "")
}

/** 协作受理前创建所属会话；沿用现有 HTTP 信封与身份失效处理。 */
export function createAgentSession(sessionId: string, signal: AbortSignal) {
  return request<{ sessionId: string }>("/agent/sessions", {
    method: "POST",
    body: JSON.stringify({ sessionId }),
    signal,
    cache: "no-store",
  })
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

export function getChatHistory(threadId: string, beforeId?: string, limit = 40) {
  let path = `/agent/history/${threadId}?limit=${limit}`
  if (beforeId) path += `&beforeId=${beforeId}`
  return request<ChatHistoryVO>(path).then((history) => ({
    ...history,
    messages: history.messages.map((message) => ({
      ...message,
      createdTime: chatDate(message.createdTime),
    })),
  }))
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

/* ── 用户中心：资料 / 头像 / 我的判读记录 ───────────────── */

export type UserVO = {
  /** 后端 JsonConfig 全局 Long→String，id 线上是字符串。 */
  id?: string
  userAccount?: string
  userName?: string
  userAvatar?: string
  userProfile?: string
  userRole?: string
  createTime?: string
}

/** 本人资料更新（/user/update/userCenter）。空字段后端按原值跳过。 */
export function updateProfile(body: {
  userName?: string
  userProfile?: string
}) {
  return request<boolean>("/user/update/userCenter", {
    method: "POST",
    body: JSON.stringify(body),
  })
}

/** 头像上传。返回最新 UserVO；调用方负责随后刷新会话同步全站头像。 */
export function uploadAvatar(file: File) {
  const form = new FormData()
  form.append("file", file)
  return request<UserVO>("/user/upload/avatar", { method: "POST", body: form })
}

/**
 * 我的判读分页。行对象是 DiagnosisManageVO——列表接口不做详情级脱敏补全，
 * 人工复核结论等完整字段要点开走 /diagnosis/get/{id}。
 * AI 拒识的行 result/confidence/severity 是 null，不是 0。
 */
export type DiagnosisManage = {
  /** 雪花 id，线上是字符串。 */
  id: string
  url?: string
  username?: string
  result?: string | null
  confidence?: number | null
  severity?: string | null
  /** 复诊状态：0 未复审（历史值 1 同义）/ 2 复审中 / 3 已复审 */
  reexamineStatus?: number
  createTime?: string
  status?: string
  aiRejected?: boolean
  abstainReason?: string
  requiresReview?: boolean
}

export function listMyDiagnoses(
  q: { current?: number; pageSize?: number; result?: string } = {},
  signal?: AbortSignal,
) {
  return request<RawPage<DiagnosisManage>>(
    "/diagnosis/list/page/my",
    {
      method: "POST",
      body: JSON.stringify({ current: 1, pageSize: 10, ...q }),
      signal,
    },
  ).then(toPage)
}

export type MyDiagnosisStats = {
  total: number
  /** 有真实严重度分级的条数；缺了它，highRisk=0 无法与「未评估」区分。 */
  assessed: number
  highRisk: number
  awaitingReview: number
  lastReadAt: string | null
}

/** 服务端聚合。接口未上线时返回 404，调用方据此降级到当前页口径。 */
export function getMyStats(signal?: AbortSignal) {
  return request<MyDiagnosisStats>("/diagnosis/stats/my", { method: "GET", signal })
}

/** 本人判读详情（后端做归属校验）。返回完整记录纸字段。 */
export function getMyDiagnosis(id: string | number, signal?: AbortSignal) {
  return request<DiagnosisResult>(`/diagnosis/get/${id}`, { method: "GET", signal })
}

/**
 * 申请复诊。后端 DTO 无 @RequestBody，id 走 query；只允许本人记录，
 * 提交后 reexamineStatus 置为 2（复审中）。
 */
export function requestReexamine(id: string) {
  return request<boolean>(`/user/diagnosis/reexamine?id=${id}`, { method: "POST" })
}

/* ── Agent SSE 流 ──────────────────────────────────────── */

/** 后端 MessageDTO 的流事件载荷。messageType 序列化自枚举，大小写不保证。 */
/**
 * 工具结果里携带的结构化资源（目前只有知识库检索命中）。
 * 三个字段都由后端从真实检索结果取值：`documentId` 是文档主键，
 * `score` 是检索相关度，`snippet` 是命中片段原文。
 */
export type ResourceRefDTO = {
  id?: string
  /** image | document | link */
  kind?: string
  title?: string
  /** upload | assistant | tool | knowledge-base */
  source?: string
  url?: string
  documentId?: string
  score?: number
  /** 原始检索分：rerank 生效时与 score（重排序分）分开记录。 */
  retrievalScore?: number
  snippet?: string
  /** 产生这条资源的工具调用。 */
  toolCallId?: string
}

export type AgentStreamDTO = {
  messageType: string
  content?: string
  toolCalls?: { name: string; arguments: string; id?: string; stepLabel?: string }[]
  toolName?: string
  /* ── 普通聊天工具步骤契约：全部可选，历史消息与旧后端不带这些字段。 ── */
  toolCallId?: string
  toolStatus?: string
  stepLabel?: string
  finishReason?: string
  errorCategory?: string
  /** 服务端时间点，带时区偏移的 ISO-8601。 */
  timestamp?: string
  /** 工具结果携带的结构化资源；失败或没有命中时缺省。 */
  resources?: ResourceRefDTO[]
}

export type StreamChatHandlers = {
  onEvent(dto: AgentStreamDTO): void
  onDone(): void
  onError(err: unknown): void
  /**
   * 服务端已受理：拿到了 2xx 的 SSE 响应头。
   *
   * <p>只到「请求已被接受、用户消息已入队」为止，**不**等于已经落库：
   * `AgentController` 调 `ChatHistoryService.saveUserMessage`，后者把写库任务
   * 提交进 `SessionMessageQueue` 就返回（没有等待 Future）。控制器方法体确实在
   * 响应头之前执行完，但落库是后台任务，可能还没写、也可能写失败。
   *
   * <p>所以：`onAccepted` 之前失败 **不能**推断服务端没收到；`onAccepted` 之后
   * 失败也不能断言「服务端一定有这条」。两端都只能说到「受理」或「不知道」。
   */
  onAccepted?(): void
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
  // 按需加载：SSE 客户端只有 /agent 用，静态引入会把它塞进所有路由的首屏包。
  const { fetchEventSource } = await import("@microsoft/fetch-event-source")
  await fetchEventSource(`${BASE_URL}/agent/chat/stream`, {
    method: "POST",
    headers: { Accept: "text/event-stream", "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
    credentials: "include",
    openWhenHidden: true,

    async onopen(response) {
      const contentType = response.headers.get("content-type") ?? ""
      // 匿名访问时后端抛 BusinessException(NO_AUTH_ERROR)，返回的是 200 + JSON 信封，
      // 而不是 SSE 流——把它当流读会一直等到超时。识别出来并转成未登录事件。
      // 错误响应体同样要解析：否则 401/403 的信封不会广播未登录，会话也不会失效。
      if (contentType.includes("application/json")) {
        await rejectNonStreamResponse(response, "对话服务拒绝了这次请求")
      }
      if (!response.ok) {
        await rejectNonStreamResponse(response, `服务返回 ${response.status}`)
      }
      // 走到这里说明服务端已经受理这次请求（拿到 2xx 流响应头）。
      // 注意口径：受理 = 用户消息已**入队**，落库是会话队列里的异步任务，
      // 未必此刻已经写进 t_agent_message——所以「没有助手内容」推不出「没收到」。
      handlers.onAccepted?.()
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
      let dto: AgentStreamDTO
      try {
        dto = JSON.parse(event.data) as AgentStreamDTO
      } catch (e) {
        // 单片解析失败不中断整条流
        console.error("SSE 数据解析失败", e)
        return
      }
      dto.messageType = (dto.messageType ?? "").toLowerCase()
      // 事件处理放在 try 外：handler 里的 setState updater 在渲染期才执行，
      // 包进 try 只会把它的异常误报成「数据解析失败」。
      handlers.onEvent(dto)
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
