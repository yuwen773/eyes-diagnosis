import { collaborationFailure } from "./collaborationApi"

export type ImageTaskStatus =
  | "PROCESSING"
  | "WAITING_REVIEW"
  | "RESTRICTED"
  | "UNKNOWN"
export type ImageTask = {
  taskId: string
  status: ImageTaskStatus
}
const base = `${import.meta.env.VITE_API_BASE_URL ?? "/api"}/diagnosis-tasks`

async function request(path: string, signal: AbortSignal, body?: FormData) {
  const response = await fetch(`${base}${path}`, {
    method: body ? "POST" : "GET",
    credentials: "include",
    cache: "no-store",
    signal,
    headers: { Accept: "application/json" },
    ...(body ? { body } : {}),
  })
  // 错误响应体可能不是 JSON（代理错误页、空体）：按同一口径退回报错，
  // 不能让一次解析异常冒充成「网络故障」，也不能把它读成成功。
  let value: { code?: number; msg?: string; data?: unknown } | null = null
  try {
    value = await response.json()
  } catch {
    // 响应体不是 JSON：按同一口径退回报错，不冒充成功。
  }
  if (!response.ok || value?.code !== 0)
    throw collaborationFailure(
      response.status,
      value?.code,
      value?.msg || "TASK_UNAVAILABLE"
    )
  return value.data as unknown
}
const KNOWN_STATUSES: ImageTaskStatus[] = ["PROCESSING", "WAITING_REVIEW", "RESTRICTED"]
function task(value: unknown): ImageTask {
  if (
    !value ||
    typeof value !== "object" ||
    !("taskId" in value) ||
    typeof value.taskId !== "string" ||
    !value.taskId ||
    !("status" in value)
  )
    throw new Error("INVALID_TASK_RESPONSE")
  // 状态未知不等于就绪。降级成 UNKNOWN：形状合法但取值认不出时，
  // 既不当作推理中，也不当作已就绪——交给上层显式拦住受理。
  const raw = String(value.status)
  const status = KNOWN_STATUSES.includes(raw as ImageTaskStatus)
    ? (raw as ImageTaskStatus)
    : "UNKNOWN"
  return { taskId: value.taskId, status }
}
export const diagnosisTaskApi = {
  async create(file: File, key: string, signal: AbortSignal) {
    const body = new FormData()
    body.set("file", file)
    body.set("idempotencyKey", key)
    return task(await request("", signal, body))
  },
  async get(id: string, signal: AbortSignal) {
    return task(await request(`/${encodeURIComponent(id)}`, signal))
  },
  async list(signal: AbortSignal) {
    const value = await request("", signal)
    if (!Array.isArray(value)) throw new Error("INVALID_TASK_RESPONSE")
    return value.map(task)
  },
}
