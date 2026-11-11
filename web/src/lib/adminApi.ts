/**
 * 管理域后端契约。端点与请求体对齐 Java Controller；统一 { code:0, data, msg } 信封、
 * 错误抛 ApiError、40100 广播未登录事件，与 lib/api.ts 保持同一套语义。
 *
 * 列表一律走非 /cache 端点——管理端改完要立刻看到新鲜数据，走缓存会让刚删/刚编辑的行
 * 还挂在表里（Vue 版踩过这个坑）。雪花 id 用 string，避免超出 JS 安全整数被截断。
 */

import {
  ApiError,
  AUTH_EXPIRED_EVENT,
  type AuthExpiredDetail,
  type DiagnosisResult,
} from "./api"

const BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "/api"

type Envelope<T> = {
  code?: number
  data?: T
  msg?: string
}

type RequestOptions = {
  /** 40100 不广播未登录事件；保留该参数是为了与 api.ts 的 request 签名逐字对齐。 */
  silentAuth?: boolean
}

function notifyAuthExpired(code: number) {
  window.dispatchEvent(
    new CustomEvent<AuthExpiredDetail>(AUTH_EXPIRED_EVENT, { detail: { code } }),
  )
}

/**
 * 与 lib/api.ts 的 request<T> 等价的封装。api.ts 里的 request 与 BASE_URL 都是模块私有、
 * 未导出，而本任务只新增 adminApi.ts、不得改动 api.ts；为让每个管理域函数仍是
 * 「一行 request<T>(...)」调用、且信封/40100/FormData 语义全站一致，在此照搬一份，
 * ApiError 与未登录事件复用 api.ts 的导出（不另起一套错误类型）。
 */
async function request<T>(
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
  } catch {
    throw new ApiError(-1, "网络不可用，请检查连接后重试")
  }

  if (!response.ok) {
    throw new ApiError(response.status, `服务返回 ${response.status}`)
  }

  const payload = (await response.json()) as Envelope<T>
  if (payload.code !== 0) {
    if (payload.code === 40100 && !options.silentAuth) {
      notifyAuthExpired(40100)
    }
    throw new ApiError(payload.code ?? -1, payload.msg || "请求未完成")
  }

  return payload.data as T
}

/**
 * 分页信封的计数字段线上是字符串：后端 JsonConfig 全局把 Long 序列化成 String，
 * total / size / current / pages 回来都是 "13" 这种形态。这里统一转成 number，
 * 让 Page<T> 的声明与运行时一致——分页算术（total / pageSize）不会踩到字符串。
 */
type RawPage<T> = {
  records?: T[]
  total?: number | string
  size?: number | string
  current?: number | string
  pages?: number | string
}

export type Page<T> = { records?: T[]; total?: number; size?: number; current?: number; pages?: number }

/**
 * 批量动作的回执：请求了几条、成了几条、败了几条、败的是哪些。
 *
 * 批量天然是「部分成功」形态，界面上要能把失败的条目如实报出来，
 * 而不是只回一个 boolean。
 */
export type BatchResult = {
  requested?: number; succeeded?: number; failed?: number
  failedIds?: string[]; message?: string
}

function toPage<T>(raw: RawPage<T>): Page<T> {
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

/* ── 用户管理 ─────────────────────────────────────────────── */

export type AdminUser = {
  id: string; userAccount?: string; userName?: string; userAvatar?: string
  userProfile?: string; userRole?: string; createTime?: string
}

/** 用户列表的筛选条件（空串 / undefined 表示不限）。 */
export type UserQuery = {
  current: number; pageSize: number
  userAccount?: string; userName?: string; userRole?: string
  startDate?: string; endDate?: string
}
export function listUsers(q: UserQuery): Promise<Page<AdminUser>> {
  return request<RawPage<AdminUser>>("/user/list/page/vo", { method: "POST", body: JSON.stringify(q) }).then(toPage)
}
export function deleteUser(id: string): Promise<boolean> {
  return request<boolean>(`/user/delete/${id}`, { method: "POST" })
}
/** 新建用户：账号必填、初始密码必填、角色限 user / ban / admin。返回落库后的 id。 */
export function createUser(body: { userAccount: string; userPassword: string; userName?: string; userProfile?: string; userRole?: string }): Promise<string> {
  return request<string>("/user/add", { method: "POST", body: JSON.stringify(body) })
}
/** 改用户资料（昵称 / 头像 / 简介 / 角色）。id 必填。 */
export function updateUser(body: { id: string; userName?: string; userAvatar?: string; userProfile?: string; userRole?: string }): Promise<boolean> {
  return request<boolean>("/user/update", { method: "POST", body: JSON.stringify(body) })
}
export function deleteUsers(ids: string[]): Promise<BatchResult> {
  return request<BatchResult>("/user/delete/batch", { method: "POST", body: JSON.stringify({ ids }) })
}
export function updateUserRole(ids: string[], userRole: string): Promise<BatchResult> {
  return request<BatchResult>("/user/update/role/batch", { method: "POST", body: JSON.stringify({ ids, userRole }) })
}

/* ── 新闻管理 ─────────────────────────────────────────────── */

export type AdminNews = {
  id?: string; title?: string; author?: string; summary?: string
  content?: string; coverImage?: string; publishTime?: string
  /** 发布状态：0 草稿 / 3 待审核 / 1 已发布 / 2 下架（NewsVO 自 2026-11-09 起暴露）。 */
  status?: number | null
  /** 下架原因（后端在状态转 2 且带 note 时写入；NewsVO 只读暴露）。 */
  offlineReason?: string | null
}
export function listAdminNews(q: { current: number; pageSize: number; title?: string; status?: number; category?: string; startDate?: string; endDate?: string }): Promise<Page<AdminNews>> {
  return request<RawPage<AdminNews>>("/news/list/page/vo", { method: "POST", body: JSON.stringify(q) }).then(toPage)
}
export function deleteNews(id: string): Promise<boolean> {
  return request<boolean>(`/news/delete/${id}`, { method: "POST" })
}
/** 批量软删资讯：逐条执行，部分失败如实回执。 */
export function deleteNewsBatch(ids: string[]): Promise<BatchResult> {
  return request<BatchResult>("/news/delete/batch", { method: "POST", body: JSON.stringify({ ids }) })
}
/** 批量改发布状态：逐条按状态迁移表校验，非法迁移的那条不执行。 */
export function changeNewsStatusBatch(ids: string[], status: number, note?: string): Promise<BatchResult> {
  return request<BatchResult>("/news/status/batch", { method: "POST", body: JSON.stringify({ ids, status, note }) })
}
export function getNews(id: string): Promise<AdminNews> {
  return request<AdminNews>(`/news/get/${id}`, { method: "GET" })
}
/**
 * 创建或编辑新闻。id 缺席即创建——后端返回落库后的 id（Long 全局序列化成 String），
 * 调用方据此回填路由；编辑时返回同一个 id。
 * note 是审核意见 / 下架原因，仅状态迁移时写入审核留痕。
 */
export function saveNews(body: { id?: string; title: string; content: string; status?: number; coverImage?: string; note?: string }): Promise<string> {
  return request<string>("/news/edit", { method: "POST", body: JSON.stringify(body) })
}

/**
 * 封面上传不能走 request<T>：id 要落在 query、file 走 multipart，而 request 会把 path
 * 与 body 分开处理、无法同时把 FormData 和 query 挂上。按契约直连 fetch、手写信封解包，
 * 信封/40100 逻辑照 api.ts 的 request 写，避免与全站错误处理分叉。
 */
export async function uploadNewsCover(id: string, file: File): Promise<string> {
  const form = new FormData()
  form.append("file", file)

  let response: Response
  try {
    response = await fetch(`${BASE_URL}/news/uploadCover?id=${id}`, {
      method: "POST",
      credentials: "include",
      headers: { Accept: "application/json" },
      body: form,
    })
  } catch {
    throw new ApiError(-1, "网络不可用，请检查连接后重试")
  }

  if (!response.ok) {
    throw new ApiError(response.status, `服务返回 ${response.status}`)
  }

  const payload = (await response.json()) as Envelope<string>
  if (payload.code !== 0) {
    if (payload.code === 40100) {
      notifyAuthExpired(40100)
    }
    throw new ApiError(payload.code ?? -1, payload.msg || "请求未完成")
  }

  return payload.data as string
}

/* ── 诊断管理 ─────────────────────────────────────────────── */

export type AdminDiagnosis = {
  id: string; url?: string; username?: string; result?: string | null
  /** AI 拒识的记录后端把置信度置空（null），不是 0——读数要显示「—」。 */
  confidence?: number | null
  severity?: string | null; reexamineStatus?: number; createTime?: string
  aiRejected?: boolean; abstainReason?: string; requiresReview?: boolean
}
/** 诊断列表的筛选条件：疾病名 + 复核状态 + AI 拒识 + 判读时间区间。 */
export type DiagnosisQuery = {
  current: number; pageSize: number; result?: string
  /** 复诊流程状态：1 未复审 / 2 复审中 / 3 已复审 */
  reexamineStatus?: number
  /** 人工复核状态：AWAITING_REVIEW / REVIEWED / OVERRIDDEN … */
  humanReviewStatus?: string
  /** 只看 AI 拒识的记录 */
  aiRejected?: boolean
  /** 只看需要人工复核的记录 */
  requiresReview?: boolean
  startDate?: string; endDate?: string
}
export function listDiagnoses(q: DiagnosisQuery): Promise<Page<AdminDiagnosis>> {
  return request<RawPage<AdminDiagnosis>>("/diagnosis/list/page/vo", { method: "POST", body: JSON.stringify(q) }).then(toPage)
}
export function getDiagnosis(id: string): Promise<DiagnosisResult> {
  return request<DiagnosisResult>(`/diagnosis/get/${id}`, { method: "GET" })
}
export function submitReview(body: { id: string; humanResult: string; humanSeverity?: string; humanRecommendations?: string; humanReviewNote?: string }): Promise<boolean> {
  return request<boolean>("/diagnosis/update", { method: "POST", body: JSON.stringify(body) })
}
export function deleteDiagnosis(id: string): Promise<boolean> {
  return request<boolean>(`/diagnosis/delete/${id}`, { method: "POST" })
}
/** 批量删除判读记录：逐条执行，部分失败如实回执。 */
export function deleteDiagnoses(ids: string[]): Promise<BatchResult> {
  return request<BatchResult>("/diagnosis/delete/batch", { method: "POST", body: JSON.stringify({ ids }) })
}

/* ── 知识库 ───────────────────────────────────────────────── */

// 后端 JsonConfig 全局 Long→String，KnowledgeDoc 字段线上均为 string（含非雪花 id）。
export type KnowledgeDoc = {
  id: string; userId: string; title: string; fileName: string; fileUrl: string
  fileSize: string; fileType: string; chunkCount: number
  status: number; createTime: string; updateTime: string
}

/** 知识库列表的筛选条件。 */
export type KnowledgeQuery = {
  current: number; pageSize: number
  fileName?: string; title?: string; status?: number; fileType?: string
  startDate?: string; endDate?: string
}

/** 一条切片：序号 + 正文 + 字符数。 */
export type KnowledgeChunk = { index: number; text: string; chars: number }

/** 文档详情：元信息 + 预览链接 + 切片清单。 */
export type KnowledgeDetail = {
  id: string; title: string; fileName: string; fileType: string
  /** 后端 JsonConfig 全局 Long→String，fileSize 线上是字符串 */
  fileSize: number | string; chunkCount: number; status: number; userId: string
  createTime: string; updateTime: string
  /** 限时签名链接（10 分钟有效） */
  previewUrl?: string | null
  /** 预览方式：pdf / text / none */
  previewKind?: string | null
  /** 纯文本直读内容（text 类文档） */
  textPreview?: string | null
  chunks: KnowledgeChunk[]
  chunksReadable: boolean
  chunksMessage?: string | null
}

/** 后端 KnowledgeUploadRequest 收 MultipartFile[] files + 可选 title，字段名照 Vue 先例逐个 append。 */
/** 线上返回的是 id 数组，JsonConfig 全局 Long→String，所以是 string[]。 */
export function uploadKnowledge(files: File[], title?: string): Promise<string[]> {
  const form = new FormData()
  files.forEach((file) => form.append("files", file))
  if (title) form.append("title", title)
  return request<string[]>("/knowledge/upload", { method: "POST", body: form })
}
export function listKnowledge(q: KnowledgeQuery): Promise<Page<KnowledgeDoc>> {
  return request<RawPage<KnowledgeDoc>>("/knowledge/list/page", { method: "POST", body: JSON.stringify(q) }).then(toPage)
}
/** DELETE 带 body，后端 DeleteRequest 收 {id}；不能塞进 query。 */
export function deleteKnowledge(id: string): Promise<boolean> {
  return request<boolean>("/knowledge/delete", { method: "DELETE", body: JSON.stringify({ id }) })
}
/** 批量删除知识文档：逐条鉴权与执行，部分失败如实回执。 */
export function deleteKnowledgeBatch(ids: string[]): Promise<BatchResult> {
  return request<BatchResult>("/knowledge/delete/batch", { method: "DELETE", body: JSON.stringify({ ids }) })
}
/** 改文档标题（只改人读的名字，不动文件本体与切片）。 */
export function updateKnowledgeTitle(id: string, title: string): Promise<boolean> {
  return request<boolean>("/knowledge/update", { method: "POST", body: JSON.stringify({ id, title }) })
}
/** 文档详情：元信息 + 限时预览链接 + 切片清单。 */
export function getKnowledgeDetail(id: string): Promise<KnowledgeDetail> {
  return request<KnowledgeDetail>(`/knowledge/get/${id}`, { method: "GET" })
}

/* ── 统计 ─────────────────────────────────────────────────── */

/** 统计总览（仪表盘与数据分析共用同一份口径）。 */
export type AdminStats = {
  days: number; rangeStart: string; rangeEnd: string
  userTotal: number; userNew: number; userAdmin: number
  diagnosisTotal: number; diagnosisInRange: number; diagnosisToday: number
  diagnosisAiRejected: number; diagnosisAwaitingReview: number; diagnosisReviewed: number
  /** 平均置信度（0–1）；无样本时为 null */
  avgConfidence: number | null
  knowledgeTotal: number; knowledgeChunks: number
  knowledgeByStatus: StatBucket[]
  newsTotal: number; newsByStatus: StatBucket[]
  trendDays: string[]
  diagnosisTrend: StatDayCount[]
  userTrend: StatDayCount[]
  diagnosisDistribution: StatBucket[]
  reviewDistribution: StatBucket[]
  diagnosisTrendByResult: StatDayNameCount[]
}
export type StatBucket = { name: string; value: number }
export type StatDayCount = { day: string; value: number }
export type StatDayNameCount = { day: string; name: string; value: number }

export function getAdminStats(days: number): Promise<AdminStats> {
  return request<RawAdminStats>(`/stats/admin/overview?days=${days}`, { method: "GET" }).then(toStats)
}

/**
 * 统计读数的数字归一。
 *
 * <p>后端 JsonConfig 全局把 Long / long 序列化成 String（为了雪花 id 不丢精度），
 * 所以这里的计数全是 "1234" 这种字符串形态。若不归一，rankDistribution 里的
 * `sum + row.value` 会变成字符串拼接（"0" + "12" = "012"），占比算出来是错的。
 * 这里统一转成 number，null / 非法值按 0 处理。
 */
function num(value: unknown): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

type RawAdminStats = Omit<AdminStats, "userTotal" | "userNew" | "userAdmin" | "diagnosisTotal"
  | "diagnosisInRange" | "diagnosisToday" | "diagnosisAiRejected" | "diagnosisAwaitingReview"
  | "diagnosisReviewed" | "knowledgeTotal" | "knowledgeChunks" | "newsTotal"
  | "knowledgeByStatus" | "newsByStatus" | "diagnosisTrend" | "userTrend"
  | "diagnosisDistribution" | "reviewDistribution" | "diagnosisTrendByResult"> & {
  userTotal?: number | string; userNew?: number | string; userAdmin?: number | string
  diagnosisTotal?: number | string; diagnosisInRange?: number | string
  diagnosisToday?: number | string; diagnosisAiRejected?: number | string
  diagnosisAwaitingReview?: number | string; diagnosisReviewed?: number | string
  knowledgeTotal?: number | string; knowledgeChunks?: number | string; newsTotal?: number | string
  knowledgeByStatus?: { name: string; value: number | string }[]
  newsByStatus?: { name: string; value: number | string }[]
  diagnosisTrend?: { day: string; value: number | string }[]
  userTrend?: { day: string; value: number | string }[]
  diagnosisDistribution?: { name: string; value: number | string }[]
  reviewDistribution?: { name: string; value: number | string }[]
  diagnosisTrendByResult?: { day: string; name: string; value: number | string }[]
}

function toStats(raw: RawAdminStats): AdminStats {
  const buckets = (rows?: { name: string; value: number | string }[]) =>
    (rows ?? []).map((row) => ({ name: row.name, value: num(row.value) }))
  const days = (rows?: { day: string; value: number | string }[]) =>
    (rows ?? []).map((row) => ({ day: row.day, value: num(row.value) }))
  return {
    days: num(raw.days),
    rangeStart: raw.rangeStart ?? "",
    rangeEnd: raw.rangeEnd ?? "",
    userTotal: num(raw.userTotal),
    userNew: num(raw.userNew),
    userAdmin: num(raw.userAdmin),
    diagnosisTotal: num(raw.diagnosisTotal),
    diagnosisInRange: num(raw.diagnosisInRange),
    diagnosisToday: num(raw.diagnosisToday),
    diagnosisAiRejected: num(raw.diagnosisAiRejected),
    diagnosisAwaitingReview: num(raw.diagnosisAwaitingReview),
    diagnosisReviewed: num(raw.diagnosisReviewed),
    avgConfidence: raw.avgConfidence == null ? null : num(raw.avgConfidence),
    knowledgeTotal: num(raw.knowledgeTotal),
    knowledgeChunks: num(raw.knowledgeChunks),
    knowledgeByStatus: buckets(raw.knowledgeByStatus),
    newsTotal: num(raw.newsTotal),
    newsByStatus: buckets(raw.newsByStatus),
    trendDays: raw.trendDays ?? [],
    diagnosisTrend: days(raw.diagnosisTrend),
    userTrend: days(raw.userTrend),
    diagnosisDistribution: buckets(raw.diagnosisDistribution),
    reviewDistribution: buckets(raw.reviewDistribution),
    diagnosisTrendByResult: (raw.diagnosisTrendByResult ?? []).map((row) => ({
      day: row.day,
      name: row.name,
      value: num(row.value),
    })),
  }
}
