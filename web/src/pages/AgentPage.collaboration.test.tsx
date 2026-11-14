// @vitest-environment jsdom
import { useContext } from "react"
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react"
import { MemoryRouter } from "react-router-dom"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { collaborationApi } from "@/lib/collaborationApi"
import { getChatHistory, getSessions } from "@/lib/api"
import { snapshot } from "@/lib/collaborationTestFixtures"
import { CollaborationRunContext } from "@/hooks/useCollaborationRun"
import { saveThreadId } from "@/lib/threadStorage"
import { AgentPage } from "./AgentPage"

const identity = vi.hoisted(() => ({
  status: "authed",
  user: { id: 1 } as { id: number } | null,
}))
vi.mock("@/lib/session", () => ({ useSession: () => identity }))
vi.mock("@/components/SiteHeader", () => ({ SiteHeader: () => null }))
vi.mock("@/components/agent/MessageList", () => ({
  MessageList: function Probe() {
    const run = useContext(CollaborationRunContext)
    return (
      <>
        <output data-testid="run">{run?.run?.snapshot.runId ?? "empty"}</output>
        <button onClick={() => void run?.cancel()}>取消选定协作</button>
      </>
    )
  },
}))
vi.mock("@/lib/api", async (original) => ({
  ...(await original<typeof import("@/lib/api")>()),
  getSessions: vi.fn().mockResolvedValue([]),
  getChatHistory: vi
    .fn()
    .mockResolvedValue({ messages: [], hasMore: false, nextCursor: null }),
}))
vi.mock("@/lib/collaborationApi", async (original) => ({
  ...(await original<typeof import("@/lib/collaborationApi")>()),
  collaborationApi: {
    create: vi.fn(),
    snapshot: vi.fn(),
    stream: vi.fn(),
    cancel: vi.fn(),
  },
}))

let signals: AbortSignal[]
beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(getSessions).mockResolvedValue([])
  vi.mocked(getChatHistory).mockResolvedValue({
    messages: [],
    hasMore: false,
    nextCursor: null,
  })
  vi.stubEnv("VITE_COLLABORATION_ENABLED", "true")
  identity.status = "authed"
  identity.user = { id: 1 }
  localStorage.clear()
  saveThreadId(1, "thread-a")
  signals = []
  vi.mocked(collaborationApi.snapshot).mockResolvedValue(
    snapshot({ executionStatus: "RUNNING" })
  )
  vi.mocked(collaborationApi.stream).mockImplementation(
    (_id, _cursor, signal, _receive, opened) =>
      new Promise<void>((resolve) => {
        opened?.()
        signals.push(signal)
        signal.addEventListener("abort", () => resolve(), { once: true })
      })
  )
  vi.mocked(collaborationApi.cancel).mockResolvedValue({
    status: "CANCELLED",
    outcome: "CANCELLED",
  })
})
afterEach(() => {
  cleanup()
  localStorage.clear()
  vi.unstubAllEnvs()
})
const page = (path = "/agent?runId=run-a") => (
  <MemoryRouter initialEntries={[path]}>
    <AgentPage />
  </MemoryRouter>
)

describe("/agent collaboration scope integration", () => {
  it("binds an explicitly selected run to the authenticated user's restored conversation", async () => {
    render(page())
    await waitFor(() =>
      expect(screen.getByTestId("run").textContent).toBe("run-a")
    )
    expect(signals.filter((s) => !s.aborted)).toHaveLength(1)
    expect(collaborationApi.create).not.toHaveBeenCalled()
  })
  it("leaves ordinary /agent visits and the default-off feature free of collaboration requests", async () => {
    vi.stubEnv("VITE_COLLABORATION_ENABLED", "false")
    render(page())
    await act(async () => {
      await Promise.resolve()
    })
    expect(collaborationApi.snapshot).not.toHaveBeenCalled()
    expect(collaborationApi.create).not.toHaveBeenCalled()
  })
  it("does not infer a collaboration run from an ordinary chat thread", async () => {
    render(page("/agent"))
    await act(async () => {
      await Promise.resolve()
    })
    expect(collaborationApi.snapshot).not.toHaveBeenCalled()
  })
  it("new conversation clears the selected run and only disconnects its stream", async () => {
    render(page())
    await waitFor(() =>
      expect(screen.getByTestId("run").textContent).toBe("run-a")
    )
    fireEvent.click(screen.getByRole("button", { name: "新对话" }))
    expect(screen.getByTestId("run").textContent).toBe("empty")
    expect(signals.every((s) => s.aborted)).toBe(true)
    expect(collaborationApi.cancel).not.toHaveBeenCalled()
  })
  it("logout clears the protected view and prevents selected-run cancellation", async () => {
    const { rerender } = render(page())
    await waitFor(() =>
      expect(screen.getByTestId("run").textContent).toBe("run-a")
    )
    identity.status = "anon"
    identity.user = null
    rerender(page())
    expect(screen.getByTestId("run").textContent).toBe("empty")
    expect(screen.queryByRole("button", { name: "取消协作任务" })).toBeNull()
    fireEvent.click(screen.getByRole("button", { name: "取消选定协作", hidden: true }))
    expect(collaborationApi.cancel).not.toHaveBeenCalled()
    expect(signals.every((s) => s.aborted)).toBe(true)
  })
  it("exposes cancellation for only the selected run through the workbench context", async () => {
    render(page())
    await waitFor(() =>
      expect(screen.getByTestId("run").textContent).toBe("run-a")
    )
    vi.mocked(collaborationApi.snapshot).mockResolvedValue(
      snapshot({ executionStatus: "CANCELLED", snapshotSequence: 20 })
    )
    fireEvent.click(screen.getByRole("button", { name: "取消协作任务" }))
    await waitFor(() =>
      expect(collaborationApi.cancel).toHaveBeenCalledTimes(1)
    )
    expect(collaborationApi.cancel).toHaveBeenCalledWith(
      "run-a",
      expect.any(AbortSignal)
    )
  })
})
