// @vitest-environment jsdom
import { StrictMode, type ReactNode } from "react"
import { act, cleanup, renderHook } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { collaborationApi, CollaborationHttpError } from "@/lib/collaborationApi"
import {
  CollaborationProtocolError,
  type CollaborationFrame,
} from "@/lib/collaborationProtocol"
import { frame, snapshot } from "@/lib/collaborationTestFixtures"
import {
  useCollaborationRun,
  type CollaborationScope,
} from "./useCollaborationRun"

vi.mock("@/lib/collaborationApi", async (original) => {
  const actual = await original<typeof import("@/lib/collaborationApi")>()
  return {
    ...actual,
    collaborationApi: {
      create: vi.fn(),
      snapshot: vi.fn(),
      cancel: vi.fn(),
      stream: vi.fn(),
    },
  }
})

const scope: CollaborationScope = {
  identityKey: 1,
  threadId: "thread-a",
  runId: "run-a",
  enabled: true,
}
type Stream = {
  signal: AbortSignal
  cursor: string
  emit(frame: CollaborationFrame): void
  close(): void
  fail(error: unknown): void
}
let streams: Stream[]
const flush = async () => {
  await act(async () => {
    await Promise.resolve()
  })
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.resetAllMocks()
  streams = []
  vi.mocked(collaborationApi.snapshot).mockResolvedValue(
    snapshot({ executionStatus: "RUNNING" })
  )
  vi.mocked(collaborationApi.cancel).mockResolvedValue({
    status: "CANCELLED",
    outcome: "CANCELLED",
  })
  vi.mocked(collaborationApi.stream).mockImplementation(
    (_id, cursor, signal, receive, opened) =>
      new Promise<void>((resolve, reject) => {
        opened?.()
        streams.push({
          signal,
          cursor,
          emit: receive,
          close: resolve,
          fail: reject,
        })
        signal.addEventListener("abort", () => resolve(), { once: true })
      })
  )
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe("useCollaborationRun", () => {
  it.each([{ enabled: false }, { identityKey: null }, { runId: null }])(
    "does not read or create when scope is inactive %j",
    async (patch) => {
      const { result } = renderHook(() =>
        useCollaborationRun({ ...scope, ...patch })
      )
      await flush()
      expect(result.current.run).toBeNull()
      expect(collaborationApi.snapshot).not.toHaveBeenCalled()
      expect(collaborationApi.create).not.toHaveBeenCalled()
      expect(collaborationApi.stream).not.toHaveBeenCalled()
    }
  )
  it("starts at the snapshot cursor and replays filtered gaps and duplicate facts", async () => {
    const { result } = renderHook(() => useCollaborationRun(scope))
    await flush()
    expect(streams[0].cursor).toBe("opaque-snapshot")
    act(() => {
      streams[0].emit(frame("agent.started", 4))
      streams[0].emit(frame("agent.completed", 8))
      streams[0].emit(frame("agent.started", 4))
    })
    expect(result.current.run?.snapshot.roles.VISION).toBe("COMPLETED")
    expect(result.current.run?.events).toHaveLength(2)
  })
  it.each([{ threadId: "thread-b" }, { identityKey: 2 }, { runId: "run-b" }])(
    "hides the prior run immediately and ignores late frames on scope change %j",
    async (patch) => {
      const { result, rerender } = renderHook((s) => useCollaborationRun(s), {
        initialProps: scope,
      })
      await flush()
      const old = streams[0]
      vi.mocked(collaborationApi.snapshot).mockImplementation(
        () => new Promise(() => {})
      )
      rerender({ ...scope, ...patch })
      expect(result.current.run).toBeNull()
      expect(old.signal.aborted).toBe(true)
      act(() => old.emit(frame("run.completed", 22)))
      expect(result.current.run).toBeNull()
      expect(collaborationApi.cancel).not.toHaveBeenCalled()
    }
  )
  it("ignores a late snapshot from a previous identity", async () => {
    let late!: (s: ReturnType<typeof snapshot>) => void
    vi.mocked(collaborationApi.snapshot).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          late = resolve
        })
    )
    const { result, rerender } = renderHook((s) => useCollaborationRun(s), {
      initialProps: scope,
    })
    rerender({ ...scope, identityKey: 2, runId: null })
    await act(async () => {
      late(snapshot())
    })
    expect(result.current.run).toBeNull()
    expect(streams).toHaveLength(0)
  })
  it("rejects a snapshot for another thread before opening SSE", async () => {
    vi.mocked(collaborationApi.snapshot).mockResolvedValue(
      snapshot({ threadId: "another-thread" })
    )
    const { result } = renderHook(() => useCollaborationRun(scope))
    await flush()
    expect(result.current.connection).toBe("forbidden")
    expect(result.current.run).toBeNull()
    expect(streams).toHaveLength(0)
  })
  it("unmount only disconnects; it never cancels the persistent task", async () => {
    const { unmount } = renderHook(() => useCollaborationRun(scope))
    await flush()
    unmount()
    expect(streams[0].signal.aborted).toBe(true)
    expect(collaborationApi.cancel).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })
  it("reconnects from the last applied heartbeat cursor without creating or rerunning a task", async () => {
    const { result } = renderHook(() => useCollaborationRun(scope))
    await flush()
    act(() => {
      streams[0].emit(frame("agent.completed", 8))
      streams[0].emit({ cursor: "opaque-scanned-12", event: null })
      streams[0].close()
    })
    await flush()
    expect(result.current.connection).toBe("reconnecting")
    expect(result.current.run).toBeNull()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000)
    })
    expect(streams[1].cursor).toBe("opaque-scanned-12")
    expect(collaborationApi.snapshot).toHaveBeenCalledTimes(1)
    expect(collaborationApi.create).not.toHaveBeenCalled()
  })
  it.each([409, 410])(
    "replaces projection/snapshot after %s and never POSTs a new run",
    async (status) => {
      const { result } = renderHook(() => useCollaborationRun(scope))
      await flush()
      vi.mocked(collaborationApi.snapshot).mockResolvedValue(
        snapshot({
          executionStatus: "RUNNING",
          snapshotSequence: 30,
          resumeCursor: "opaque-new",
          projectionVersion: "v1:doctor:review-b",
        })
      )
      act(() =>
        streams[0].fail(new CollaborationHttpError(status, "SNAPSHOT_REQUIRED"))
      )
      await flush()
      expect(streams[1].cursor).toBe("opaque-new")
      expect(result.current.run?.sequence).toBe(30)
      expect(result.current.run?.events).toEqual([])
      expect(collaborationApi.create).not.toHaveBeenCalled()
    }
  )
  it("clears protected state and stops after permission revocation", async () => {
    const { result } = renderHook(() => useCollaborationRun(scope))
    await flush()
    act(() => streams[0].fail(new CollaborationHttpError(403, "ACCESS_DENIED")))
    await flush()
    expect(result.current).toMatchObject({ run: null, connection: "forbidden" })
    act(() => streams[0].emit(frame("run.completed", 30)))
    expect(result.current.run).toBeNull()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000)
    })
    expect(streams).toHaveLength(1)
  })
  it("refreshes once on an incompatible protocol, then stops instead of looping", async () => {
    const { result } = renderHook(() => useCollaborationRun(scope))
    await flush()
    act(() => streams[0].fail(new CollaborationProtocolError()))
    await flush()
    act(() => streams[1].fail(new CollaborationProtocolError()))
    await flush()
    expect(result.current).toMatchObject({
      run: null,
      connection: "error",
      error: "PROTOCOL_MISMATCH",
    })
    expect(collaborationApi.snapshot).toHaveBeenCalledTimes(2)
  })
  it("cancels only the selected run, deduplicates clicks and re-reads the winning terminal state", async () => {
    let acknowledge!: () => void
    vi.mocked(collaborationApi.cancel).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          acknowledge = () =>
            resolve({ status: "SUCCEEDED", outcome: "ALREADY_TERMINAL" })
        })
    )
    const { result } = renderHook(() => useCollaborationRun(scope))
    await flush()
    act(() => {
      void result.current.cancel()
      void result.current.cancel()
    })
    expect(collaborationApi.cancel).toHaveBeenCalledTimes(1)
    expect(collaborationApi.cancel).toHaveBeenCalledWith(
      "run-a",
      expect.any(AbortSignal)
    )
    expect(result.current.cancelling).toBe(true)
    expect(result.current.run?.snapshot.executionStatus).toBe("RUNNING")
    vi.mocked(collaborationApi.snapshot).mockResolvedValue(
      snapshot({
        executionStatus: "SUCCEEDED",
        reviewStatus: "PENDING",
        snapshotSequence: 30,
      })
    )
    await act(async () => {
      acknowledge()
    })
    expect(result.current.run?.snapshot.executionStatus).toBe("SUCCEEDED")
    expect(result.current.run?.snapshot.reviewStatus).toBe("PENDING")
    expect(result.current.connection).toBe("closed")
  })
  it("never cancels a new selection through a retained old callback", async () => {
    const { result, rerender } = renderHook((s) => useCollaborationRun(s), {
      initialProps: scope,
    })
    await flush()
    const oldCancel = result.current.cancel
    rerender({ ...scope, runId: null })
    await act(async () => {
      await oldCancel()
    })
    expect(collaborationApi.cancel).not.toHaveBeenCalled()
  })
  it("ignores late cancellation acknowledgement after switching accounts", async () => {
    let acknowledge!: () => void
    vi.mocked(collaborationApi.cancel).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          acknowledge = () =>
            resolve({ status: "CANCELLED", outcome: "CANCELLED" })
        })
    )
    const { result, rerender } = renderHook((s) => useCollaborationRun(s), {
      initialProps: scope,
    })
    await flush()
    act(() => {
      void result.current.cancel()
    })
    rerender({ ...scope, identityKey: 2, runId: null })
    await act(async () => {
      acknowledge()
    })
    expect(result.current.run).toBeNull()
    expect(collaborationApi.snapshot).toHaveBeenCalledTimes(1)
  })
  it("keeps cancellation failure unconfirmed and never invents CANCELLED", async () => {
    vi.mocked(collaborationApi.cancel).mockRejectedValue(new Error("network"))
    const { result } = renderHook(() => useCollaborationRun(scope))
    await flush()
    await act(async () => {
      await result.current.cancel()
    })
    expect(result.current.error).toBe("CANCELLATION_UNCONFIRMED")
    expect(result.current.run?.snapshot.executionStatus).toBe("RUNNING")
  })
  it("uses an authoritative terminal snapshot without opening a live stream or treating approval as execution", async () => {
    vi.mocked(collaborationApi.snapshot).mockResolvedValue(
      snapshot({ executionStatus: "SUCCEEDED", reviewStatus: "APPROVED" })
    )
    const { result } = renderHook(() => useCollaborationRun(scope))
    await flush()
    expect(result.current.connection).toBe("closed")
    expect(result.current.run?.snapshot.reviewStatus).toBe("APPROVED")
    expect(streams).toHaveLength(0)
  })
  it("supports React StrictMode cleanup without duplicate active subscriptions", async () => {
    const wrapper = ({ children }: { children: ReactNode }) => (
      <StrictMode>{children}</StrictMode>
    )
    const { result, unmount } = renderHook(() => useCollaborationRun(scope), {
      wrapper,
    })
    await flush()
    expect(result.current.connection).toBe("live")
    expect(streams.filter((s) => !s.signal.aborted)).toHaveLength(1)
    unmount()
    expect(streams.every((s) => s.signal.aborted)).toBe(true)
  })
  it("does not redisplay a stale projection before reconnect authorization succeeds", async () => {
    const { result } = renderHook(() => useCollaborationRun(scope))
    await flush()
    act(() => streams[0].close())
    await flush()
    vi.mocked(collaborationApi.stream).mockImplementation(
      () => new Promise(() => {})
    )
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000)
    })
    expect(result.current.connection).toBe("connecting")
    expect(result.current.run).toBeNull()
  })
})
