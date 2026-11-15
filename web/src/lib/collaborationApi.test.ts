// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest"
import { collaborationApi, CollaborationHttpError } from "./collaborationApi"
import {
  CollaborationProtocolError,
  type CollaborationFrame,
} from "./collaborationProtocol"
import { rawEvent, snapshot } from "./collaborationTestFixtures"

afterEach(() => {
  vi.unstubAllGlobals()
})
const ok = (data: unknown) => Response.json({ code: 0, data, msg: "ok" })

describe("collaborationApi", () => {
  it("creates only by explicit POST with the supplied idempotency key and session credentials", async () => {
    const fetch = vi.fn().mockResolvedValue(ok(snapshot()))
    vi.stubGlobal("fetch", fetch)
    const body = {
      taskId: "task-a",
      threadId: "thread-a",
      idempotencyKey: "user-action-key",
    }
    await collaborationApi.create(body, new AbortController().signal)
    expect(fetch).toHaveBeenCalledExactlyOnceWith(
      "/api/agent/collaboration-runs",
      expect.objectContaining({
        method: "POST",
        credentials: "include",
        cache: "no-store",
        body: JSON.stringify(body),
      })
    )
  })
  it("reads a snapshot with an encoded run id and no request body", async () => {
    const fetch = vi.fn().mockResolvedValue(ok(snapshot()))
    vi.stubGlobal("fetch", fetch)
    await collaborationApi.snapshot("run/a", new AbortController().signal)
    expect(fetch).toHaveBeenCalledWith(
      "/api/agent/collaboration-runs/run%2Fa",
      expect.objectContaining({ method: "GET" })
    )
    expect(fetch.mock.calls[0][1]).not.toHaveProperty("body")
  })
  it.each([400, 403, 409, 410, 429, 503])(
    "retains HTTP %s and the server's classified reason",
    async (status) => {
      vi.stubGlobal(
        "fetch",
        vi
          .fn()
          .mockResolvedValue(
            Response.json(
              { code: status * 100, msg: "CLASSIFIED_REASON" },
              { status }
            )
          )
      )
      await expect(
        collaborationApi.snapshot("run-a", new AbortController().signal)
      ).rejects.toMatchObject({ status, message: "CLASSIFIED_REASON" })
    }
  )
  it("rejects a success HTTP status with a failed BaseResponse", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(Response.json({ code: 40100, msg: "NOT_LOGIN" }))
    )
    await expect(
      collaborationApi.snapshot("run-a", new AbortController().signal)
    ).rejects.toBeInstanceOf(CollaborationHttpError)
  })
  it("posts cancellation to the selected run without treating the acknowledgement as a clinical result", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue(
        ok({ status: "SUCCEEDED", outcome: "ALREADY_TERMINAL" })
      )
    vi.stubGlobal("fetch", fetch)
    expect(
      await collaborationApi.cancel("run-a", new AbortController().signal)
    ).toEqual({ status: "SUCCEEDED", outcome: "ALREADY_TERMINAL" })
    expect(fetch.mock.calls[0][0]).toBe(
      "/api/agent/collaboration-runs/run-a/cancel"
    )
    expect(fetch.mock.calls[0][1].method).toBe("POST")
  })
  it("uses the real SSE parser across split UTF-8 chunks, applying facts before the heartbeat cursor", async () => {
    const wire = new TextEncoder().encode(
      `id: opaque-2\nevent: run.started\ndata: ${JSON.stringify(rawEvent("run.started", 2))}\n\nid: opaque-scanned\nevent: run.heartbeat\ndata: {"schemaVersion":1}\n\n`
    )
    const fetch = vi.fn().mockResolvedValue(
      new Response(
        new ReadableStream({
          start(c) {
            for (let i = 0; i < wire.length; i += 7)
              c.enqueue(wire.slice(i, i + 7))
            c.close()
          },
        }),
        { headers: { "Content-Type": "text/event-stream;charset=UTF-8" } }
      )
    )
    vi.stubGlobal("fetch", fetch)
    const frames: CollaborationFrame[] = []
    await collaborationApi.stream(
      "run-a",
      "opaque-snapshot",
      new AbortController().signal,
      (frame) => frames.push(frame)
    )
    expect(frames.map((f) => [f.cursor, f.event?.type])).toEqual([
      ["opaque-2", "run.started"],
      ["opaque-scanned", undefined],
    ])
    expect(fetch.mock.calls[0][1]).toMatchObject({
      credentials: "include",
      headers: expect.objectContaining({ "Last-Event-ID": "opaque-snapshot" }),
    })
    expect(fetch).toHaveBeenCalledTimes(1)
  })
  it.each([409, 410])(
    "exposes SSE preflight %s to the hook without automatic library retries",
    async (status) => {
      const fetch = vi
        .fn()
        .mockResolvedValue(
          Response.json(
            { code: status * 100, msg: "SNAPSHOT_REQUIRED" },
            { status }
          )
        )
      vi.stubGlobal("fetch", fetch)
      await expect(
        collaborationApi.stream(
          "run-a",
          "opaque",
          new AbortController().signal,
          vi.fn()
        )
      ).rejects.toMatchObject({ status })
      expect(fetch).toHaveBeenCalledTimes(1)
    }
  )
  it("rejects unknown critical SSE types before delivering or persisting their cursor", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue(
        new Response(
          `id: opaque-bad\nevent: run.future\ndata: ${JSON.stringify(rawEvent("run.started", 2, { type: "run.future" }))}\n\n`,
          { headers: { "Content-Type": "text/event-stream" } }
        )
      )
    vi.stubGlobal("fetch", fetch)
    const receive = vi.fn()
    await expect(
      collaborationApi.stream(
        "run-a",
        "opaque",
        new AbortController().signal,
        receive
      )
    ).rejects.toBeInstanceOf(CollaborationProtocolError)
    expect(receive).not.toHaveBeenCalled()
    expect(fetch).toHaveBeenCalledTimes(1)
  })
})
