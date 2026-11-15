// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react"
import { MemoryRouter } from "react-router-dom"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  collaborationApi,
  CollaborationHttpError,
} from "@/lib/collaborationApi"
import { createAgentSession } from "@/lib/api"
import { diagnosisTaskApi } from "@/lib/diagnosisTaskApi"
import { frame, snapshot } from "@/lib/collaborationTestFixtures"
import { CollaborationPage } from "./CollaborationPage"

const identity = vi.hoisted(() => ({
  status: "authed",
  user: { id: "1", userRole: "user" },
  scope: "1",
}))
vi.mock("@/lib/session", () => ({ useSession: () => identity }))
vi.mock("@/components/shell/ProductHeader", () => ({
  ProductHeader: () => <header>产品顶栏</header>,
}))
vi.mock("@/lib/api", () => ({ createAgentSession: vi.fn() }))
vi.mock("@/lib/diagnosisTaskApi", () => ({
  diagnosisTaskApi: { create: vi.fn(), get: vi.fn(), list: vi.fn() },
}))
vi.mock("@/lib/reviewApi", async (original) => ({
  ...(await original<typeof import("@/lib/reviewApi")>()),
  reviewApi: {
    image: vi
      .fn()
      .mockResolvedValue(new Blob(["synthetic"], { type: "image/png" })),
  },
}))
vi.mock("@/lib/collaborationApi", async (original) => ({
  ...(await original<typeof import("@/lib/collaborationApi")>()),
  collaborationApi: {
    create: vi.fn(),
    snapshot: vi.fn(),
    cancel: vi.fn(),
    stream: vi.fn(),
  },
}))

let signals: AbortSignal[]
beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv("VITE_COLLABORATION_ENABLED", "true")
  vi.stubGlobal(
    "URL",
    Object.assign(URL, {
      createObjectURL: vi.fn(() => "blob:synthetic"),
      revokeObjectURL: vi.fn(),
    })
  )
  identity.status = "authed"
  identity.user = { id: "1", userRole: "user" }
  signals = []
  vi.mocked(createAgentSession).mockImplementation(async (sessionId) => ({
    sessionId,
  }))
  vi.mocked(diagnosisTaskApi.list).mockResolvedValue([
    { taskId: "task-a", status: "WAITING_REVIEW" },
  ])
  vi.mocked(diagnosisTaskApi.create).mockResolvedValue({
    taskId: "task-a",
    status: "WAITING_REVIEW",
  })
  vi.mocked(diagnosisTaskApi.get).mockResolvedValue({
    taskId: "task-a",
    status: "WAITING_REVIEW",
  })
  vi.mocked(collaborationApi.create).mockImplementation(async (body) =>
    snapshot({
      threadId: body.threadId,
      taskId: body.taskId,
      executionStatus: "RUNNING",
    })
  )
  vi.mocked(collaborationApi.snapshot).mockImplementation(async () =>
    snapshot({ executionStatus: "RUNNING" })
  )
  vi.mocked(collaborationApi.stream).mockImplementation(
    async (_id, _cursor, signal, _receive, opened) => {
      signals.push(signal)
      opened?.()
      await new Promise<void>((resolve) =>
        signal.addEventListener("abort", () => resolve(), { once: true })
      )
    }
  )
})
afterEach(() => {
  cleanup()
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})
const page = (entry = "/agent/collaboration") => (
  <MemoryRouter initialEntries={[entry]}>
    <CollaborationPage />
  </MemoryRouter>
)

describe("独立协作页面受理与生命周期", () => {
  it("默认关闭时不读取或创建任何受保护协作资源", () => {
    vi.stubEnv("VITE_COLLABORATION_ENABLED", "false")
    render(page("/agent/collaboration?runId=run-a&threadId=thread-a"))
    expect(screen.getByText("协作暂未开放")).toBeTruthy()
    expect(collaborationApi.snapshot).not.toHaveBeenCalled()
    expect(createAgentSession).not.toHaveBeenCalled()
    expect(screen.queryByLabelText("协作角色状态")).toBeNull()
  })

  it("只有用户提交才按 Session → Task → Run 链受理，不读取聊天历史", async () => {
    // 受理返回新会话，hook必须跟随该会话，而非聊天localStorage。
    vi.mocked(collaborationApi.snapshot).mockImplementation(async () => {
      const body = vi.mocked(collaborationApi.create).mock.calls[0][0]
      return snapshot({ threadId: body.threadId, executionStatus: "RUNNING" })
    })
    render(page())
    expect(createAgentSession).not.toHaveBeenCalled()
    expect(screen.getAllByText("尚未启动")).toHaveLength(4)
    fireEvent.change(screen.getByLabelText(/选择一张 JPEG/), {
      target: {
        files: [
          new File(["synthetic"], "synthetic.png", { type: "image/png" }),
        ],
      },
    })
    fireEvent.click(screen.getByRole("button", { name: "提交影像并开始协作" }))
    await waitFor(() => expect(collaborationApi.create).toHaveBeenCalledOnce())
    expect(createAgentSession).toHaveBeenCalledOnce()
    expect(diagnosisTaskApi.create).toHaveBeenCalledOnce()
    expect(
      vi.mocked(createAgentSession).mock.invocationCallOrder[0]
    ).toBeLessThan(
      vi.mocked(diagnosisTaskApi.create).mock.invocationCallOrder[0]
    )
    expect(
      vi.mocked(diagnosisTaskApi.get).mock.invocationCallOrder[0]
    ).toBeLessThan(
      vi.mocked(collaborationApi.create).mock.invocationCallOrder[0]
    )
    const body = vi.mocked(collaborationApi.create).mock.calls[0][0]
    expect(body).toEqual({
      taskId: "task-a",
      threadId: vi.mocked(createAgentSession).mock.calls[0][0],
      idempotencyKey: `collab-task-a-${body.threadId}`,
    })
    await waitFor(() =>
      expect(screen.getByLabelText("协作角色状态")).toBeTruthy()
    )
  })

  it("选择已有任务复用受理链，不重新上传影像", async () => {
    render(page())
    fireEvent.click(
      screen.getByRole("button", { name: "选择本人已有影像任务" })
    )
    await screen.findByLabelText("本人影像任务")
    fireEvent.change(screen.getByLabelText("本人影像任务"), {
      target: { value: "task-a" },
    })
    fireEvent.click(screen.getByRole("button", { name: "继续受理协作" }))
    await waitFor(() => expect(collaborationApi.create).toHaveBeenCalledOnce())
    expect(diagnosisTaskApi.create).not.toHaveBeenCalled()
  })

  it("只有runId的深链由授权快照恢复会话，不触发模型受理", async () => {
    render(page("/agent/collaboration?runId=run-a"))
    await waitFor(() =>
      expect(screen.getByLabelText("协作角色状态")).toBeTruthy()
    )
    expect(collaborationApi.snapshot).toHaveBeenCalledWith(
      "run-a",
      expect.any(AbortSignal)
    )
    expect(createAgentSession).not.toHaveBeenCalled()
    expect(collaborationApi.create).not.toHaveBeenCalled()
  })

  it("换身份立即移除旧任务和影像，旧订阅中止而不取消任务", async () => {
    vi.mocked(collaborationApi.snapshot).mockResolvedValueOnce(
      snapshot({ taskId: "private-old-task", executionStatus: "RUNNING" })
    )
    const mounted = render(
      page("/agent/collaboration?runId=run-a&threadId=thread-a")
    )
    await screen.findByText("private-old-task")
    vi.mocked(collaborationApi.snapshot).mockImplementation(
      () => new Promise(() => {})
    )
    identity.user = { id: "2", userRole: "user" }
    mounted.rerender(page("/agent/collaboration?runId=run-a&threadId=thread-a"))
    expect(screen.queryByText("private-old-task")).toBeNull()
    expect(screen.queryByAltText("本次提交的眼底影像")).toBeNull()
    expect(signals[0].aborted).toBe(true)
    expect(collaborationApi.cancel).not.toHaveBeenCalled()
  })

  it("SSE授权失效后清除受保护角色、任务及影像", async () => {
    let deny!: (reason: unknown) => void
    vi.mocked(collaborationApi.stream).mockImplementation(
      (_id, _cursor, _signal, _receive, opened) => {
        opened?.()
        return new Promise<void>((_resolve, reject) => {
          deny = reject
        })
      }
    )
    render(page("/agent/collaboration?runId=run-a&threadId=thread-a"))
    await screen.findByLabelText("协作角色状态")
    await act(async () => {
      deny(new CollaborationHttpError(403, "ACCESS_DENIED"))
    })
    expect(screen.queryByLabelText("协作角色状态")).toBeNull()
    expect(screen.queryByLabelText("影像与证据")).toBeNull()
    expect(screen.getByText("当前无权查看此任务")).toBeTruthy()
  })

  it("取消确认按真实快照/事件结算；卸载只断连", async () => {
    vi.mocked(collaborationApi.cancel).mockResolvedValue({
      status: "CANCEL_REQUESTED",
      outcome: "REQUESTED",
    })
    vi.mocked(collaborationApi.snapshot)
      .mockResolvedValueOnce(snapshot({ executionStatus: "RUNNING" }))
      .mockResolvedValue(snapshot({ executionStatus: "CANCEL_REQUESTED" }))
    const mounted = render(
      page("/agent/collaboration?runId=run-a&threadId=thread-a")
    )
    await screen.findByRole("button", { name: "取消协作任务" })
    fireEvent.click(screen.getByRole("button", { name: "取消协作任务" }))
    await screen.findByRole("button", { name: "正在取消…" })
    expect(screen.queryByText("任务已取消", { exact: true })).toBeNull()
    const receive = vi.mocked(collaborationApi.stream).mock.calls.at(-1)![3]
    act(() => receive(frame("run.cancelled", 2)))
    expect(
      within(screen.getByRole("status")).getByText("任务已取消", {
        exact: true,
      })
    ).toBeTruthy()
    mounted.unmount()
    expect(signals.every((signal) => signal.aborted)).toBe(true)
    expect(collaborationApi.cancel).toHaveBeenCalledOnce()
  })
})
