import { fetchEventSource } from "@microsoft/fetch-event-source"
import {
  CollaborationProtocolError,
  executionStatuses,
  parseFrame,
  parseSnapshot,
  type CollaborationFrame,
  type CollaborationSnapshot,
  type ExecutionStatus,
} from "./collaborationProtocol"

const base = `${import.meta.env.VITE_API_BASE_URL ?? "/api"}/agent/collaboration-runs`
export class CollaborationHttpError extends Error {
  readonly status: number
  constructor(status: number, reason: string) {
    super(reason)
    this.status = status
  }
}
export type CreateCollaboration = {
  taskId: string
  threadId: string
  idempotencyKey: string
}
export type Cancellation = {
  status: ExecutionStatus
  outcome: "CANCELLED" | "REQUESTED" | "ALREADY_TERMINAL" | "ALREADY_CANCELLED"
}
export type CollaborationApi = {
  create(
    body: CreateCollaboration,
    signal: AbortSignal
  ): Promise<CollaborationSnapshot>
  snapshot(runId: string, signal: AbortSignal): Promise<CollaborationSnapshot>
  cancel(runId: string, signal: AbortSignal): Promise<Cancellation>
  stream(
    runId: string,
    cursor: string,
    signal: AbortSignal,
    receive: (frame: CollaborationFrame) => void,
    opened?: () => void
  ): Promise<void>
}

async function envelope(response: Response): Promise<unknown> {
  let body: { code?: number; data?: unknown; msg?: string }
  try {
    body = await response.json()
  } catch {
    throw new CollaborationHttpError(response.status, "INVALID_RESPONSE")
  }
  if (!body || !response.ok || body.code !== 0)
    throw new CollaborationHttpError(
      response.status,
      body?.msg || "INVALID_RESPONSE"
    )
  return body.data
}
async function request(
  path: string,
  signal: AbortSignal,
  body?: CreateCollaboration | null
) {
  return envelope(
    await fetch(`${base}${path}`, {
      method: body === undefined ? "GET" : "POST",
      credentials: "include",
      cache: "no-store",
      signal,
      headers: {
        Accept: "application/json",
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    })
  )
}

/** One connection per call. The scoped hook owns retries, never the transport library. */
export const collaborationApi: CollaborationApi = {
  async create(body, signal) {
    return parseSnapshot(await request("", signal, body))
  },
  async snapshot(runId, signal) {
    return parseSnapshot(await request(`/${encodeURIComponent(runId)}`, signal))
  },
  async cancel(runId, signal) {
    const value = await request(
      `/${encodeURIComponent(runId)}/cancel`,
      signal,
      null
    )
    if (
      !value ||
      typeof value !== "object" ||
      !("status" in value) ||
      !("outcome" in value) ||
      !executionStatuses.some((s) => s === value.status) ||
      ![
        "CANCELLED",
        "REQUESTED",
        "ALREADY_TERMINAL",
        "ALREADY_CANCELLED",
      ].includes(String(value.outcome))
    )
      throw new CollaborationProtocolError()
    return value as Cancellation
  },
  async stream(runId, cursor, signal, receive, opened) {
    if (!cursor) throw new CollaborationProtocolError()
    await fetchEventSource(`${base}/${encodeURIComponent(runId)}/events`, {
      method: "GET",
      credentials: "include",
      cache: "no-store",
      signal,
      openWhenHidden: true,
      headers: { Accept: "text/event-stream", "Last-Event-ID": cursor },
      async onopen(response) {
        if (!response.ok) {
          await envelope(response)
          throw new CollaborationHttpError(response.status, "INVALID_RESPONSE")
        }
        if (
          response.headers
            .get("content-type")
            ?.split(";")[0]
            .trim()
            .toLowerCase() !== "text/event-stream"
        )
          throw new CollaborationProtocolError()
        opened?.()
      },
      onmessage(message) {
        receive(parseFrame(message.event, message.id, message.data))
      },
      onerror(error) {
        throw error
      },
    })
  },
}
