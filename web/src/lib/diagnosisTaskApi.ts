import { CollaborationHttpError } from "./collaborationApi"

export type ImageTask = {
  taskId: string
  status: "PROCESSING" | "WAITING_REVIEW" | "RESTRICTED"
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
  const value = await response.json()
  if (!response.ok || value?.code !== 0)
    throw new CollaborationHttpError(
      response.status,
      value?.msg || "TASK_UNAVAILABLE"
    )
  return value.data as unknown
}
function task(value: unknown): ImageTask {
  if (
    !value ||
    typeof value !== "object" ||
    !("taskId" in value) ||
    typeof value.taskId !== "string" ||
    !value.taskId ||
    !("status" in value) ||
    !["PROCESSING", "WAITING_REVIEW", "RESTRICTED"].includes(
      String(value.status)
    )
  )
    throw new Error("INVALID_TASK_RESPONSE")
  return { taskId: value.taskId, status: value.status as ImageTask["status"] }
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
