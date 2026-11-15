// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { diagnosisTaskApi } from "@/lib/diagnosisTaskApi"
import { createAgentSession } from "@/lib/api"
import {
  collaborationApi,
  CollaborationHttpError,
} from "@/lib/collaborationApi"
import { snapshot } from "@/lib/collaborationTestFixtures"
import { CollaborationTaskForm } from "./CollaborationTaskForm"

vi.mock("@/lib/diagnosisTaskApi", () => ({
  diagnosisTaskApi: { create: vi.fn(), get: vi.fn(), list: vi.fn() },
}))
vi.mock("@/lib/api", () => ({ createAgentSession: vi.fn() }))
vi.mock("@/lib/collaborationApi", async (original) => ({
  ...(await original<typeof import("@/lib/collaborationApi")>()),
  collaborationApi: { create: vi.fn() },
}))
beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(createAgentSession).mockResolvedValue({ sessionId: "thread-a" })
  vi.mocked(diagnosisTaskApi.create).mockResolvedValue({
    taskId: "task-a",
    status: "PROCESSING",
  })
  vi.mocked(diagnosisTaskApi.get).mockResolvedValue({
    taskId: "task-a",
    status: "WAITING_REVIEW",
  })
  vi.mocked(diagnosisTaskApi.list).mockResolvedValue([
    { taskId: "task-a", status: "WAITING_REVIEW" },
  ])
  vi.mocked(collaborationApi.create).mockResolvedValue(snapshot())
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
})
function mount(ready = true) {
  const onAccepted = vi.fn()
  return {
    ...render(
      <CollaborationTaskForm
        ready={ready}
        threadId="thread-a"
        onAccepted={onAccepted}
      />
    ),
    onAccepted,
  }
}
function pick(file = new File(["image"], "fundus.png", { type: "image/png" })) {
  fireEvent.change(screen.getByLabelText(/选择一张 JPEG/), {
    target: { files: [file] },
  })
}
const submit = () =>
  fireEvent.click(
    screen.getByRole("button", { name: /提交影像并开始协作|继续受理协作/ })
  )
describe("explicit image task admission", () => {
  it("file selection alone never uploads or creates a run; repeated submit admits once", async () => {
    const { onAccepted } = mount()
    pick()
    expect(diagnosisTaskApi.create).not.toHaveBeenCalled()
    const button = screen.getByRole("button", { name: "提交影像并开始协作" })
    fireEvent.click(button)
    fireEvent.click(button)
    await waitFor(() => expect(onAccepted).toHaveBeenCalledTimes(1))
    expect(diagnosisTaskApi.create).toHaveBeenCalledTimes(1)
    expect(collaborationApi.create).toHaveBeenCalledWith(
      {
        taskId: "task-a",
        threadId: "thread-a",
        idempotencyKey: "collab-task-a-thread-a",
      },
      expect.any(AbortSignal)
    )
  })
  it("requires authentication without demanding a model-generated chat message", () => {
    mount(false)
    expect(screen.getByText(/请先登录/)).toBeTruthy()
    expect(
      screen
        .getByRole("button", { name: "提交影像并开始协作" })
        .hasAttribute("disabled")
    ).toBe(true)
  })
  it.each([
    new File(["bad"], "x.gif", { type: "image/gif" }),
    new File([], "empty.png", { type: "image/png" }),
    new File(["bad"], "x.png", { type: "text/html" }),
  ])("rejects invalid attachment %s before a request", (file) => {
    mount()
    pick(file)
    submit()
    expect(screen.getByRole("alert").textContent).toContain("有效 JPEG 或 PNG")
    expect(diagnosisTaskApi.create).not.toHaveBeenCalled()
  })
  it("chooses an owned task without reuploading or associating a different image", async () => {
    const { onAccepted } = mount()
    pick()
    fireEvent.click(
      screen.getByRole("button", { name: "选择本人已有影像任务" })
    )
    await screen.findByRole("combobox")
    fireEvent.change(screen.getByRole("combobox"), {
      target: { value: "task-a" },
    })
    submit()
    await waitFor(() =>
      expect(onAccepted).toHaveBeenCalledWith(expect.anything(), null)
    )
    expect(diagnosisTaskApi.create).not.toHaveBeenCalled()
  })
  it("retries ambiguous admission with the same task and key", async () => {
    vi.mocked(collaborationApi.create).mockRejectedValueOnce(
      new Error("offline")
    )
    const { onAccepted } = mount()
    pick()
    submit()
    await screen.findByRole("alert")
    submit()
    await waitFor(() => expect(onAccepted).toHaveBeenCalledTimes(1))
    expect(diagnosisTaskApi.create).toHaveBeenCalledTimes(1)
    expect(vi.mocked(collaborationApi.create).mock.calls[0][0]).toEqual(
      vi.mocked(collaborationApi.create).mock.calls[1][0]
    )
  })
  it("does not accept a mismatched task binding", async () => {
    vi.mocked(collaborationApi.create).mockResolvedValue(
      snapshot({ taskId: "different" })
    )
    const { onAccepted } = mount()
    pick()
    submit()
    await screen.findByRole("alert")
    expect(onAccepted).not.toHaveBeenCalled()
  })
  it("unmount aborts polling and ignores late receipts", async () => {
    let finish!: (value: ReturnType<typeof snapshot>) => void
    vi.mocked(collaborationApi.create).mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve
        })
    )
    const { unmount, onAccepted } = mount()
    pick()
    submit()
    await waitFor(() =>
      expect(collaborationApi.create).toHaveBeenCalledTimes(1)
    )
    const signal = vi.mocked(collaborationApi.create).mock.calls[0][1]
    unmount()
    await act(async () => finish(snapshot()))
    expect(signal.aborted).toBe(true)
    expect(onAccepted).not.toHaveBeenCalled()
  })
  it("explains already-bound and legacy tasks without starting a replacement", async () => {
    vi.mocked(collaborationApi.create).mockRejectedValue(
      new CollaborationHttpError(409, "TASK_ALREADY_BOUND")
    )
    mount()
    pick()
    submit()
    expect((await screen.findByRole("alert")).textContent).toContain(
      "原协作链接"
    )
    expect(diagnosisTaskApi.create).toHaveBeenCalledTimes(1)
  })
  it("waits for actual inference readiness before creating collaboration", async () => {
    vi.useFakeTimers()
    vi.mocked(diagnosisTaskApi.get).mockResolvedValueOnce({
      taskId: "task-a",
      status: "PROCESSING",
    })
    const { onAccepted } = mount()
    pick()
    await act(async () => submit())
    expect(collaborationApi.create).not.toHaveBeenCalled()
    expect(screen.getByRole("status").textContent).toContain("尚未启动协作角色")
    await act(async () => vi.advanceTimersByTimeAsync(2000))
    expect(onAccepted).toHaveBeenCalledTimes(1)
  })
  it("bounds inference polling and resumes without reuploading", async () => {
    vi.useFakeTimers()
    vi.mocked(diagnosisTaskApi.get).mockResolvedValue({
      taskId: "task-a",
      status: "PROCESSING",
    })
    const { onAccepted } = mount()
    pick()
    await act(async () => submit())
    await act(async () => vi.advanceTimersByTimeAsync(120000))
    expect(diagnosisTaskApi.get).toHaveBeenCalledTimes(60)
    expect(screen.getByRole("status").textContent).toContain("不会重复提交影像")
    expect(collaborationApi.create).not.toHaveBeenCalled()
    vi.mocked(diagnosisTaskApi.get).mockResolvedValue({
      taskId: "task-a",
      status: "WAITING_REVIEW",
    })
    await act(async () => submit())
    expect(onAccepted).toHaveBeenCalledTimes(1)
    expect(diagnosisTaskApi.create).toHaveBeenCalledTimes(1)
  })
  it("restricted tasks without a trusted snapshot stop without faking role execution", async () => {
    vi.mocked(diagnosisTaskApi.get).mockResolvedValue({
      taskId: "task-a",
      status: "RESTRICTED",
    })
    vi.mocked(collaborationApi.create).mockRejectedValue(
      new CollaborationHttpError(409, "INFERENCE_NOT_READY")
    )
    const { onAccepted } = mount()
    pick()
    submit()
    await waitFor(() =>
      expect(screen.getByRole("status").textContent).toContain("协作角色未启动")
    )
    expect(onAccepted).not.toHaveBeenCalled()
    expect(collaborationApi.create).toHaveBeenCalledTimes(1)
  })
})
