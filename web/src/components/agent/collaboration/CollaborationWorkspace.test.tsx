// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { CollaborationRunContext } from "@/hooks/useCollaborationRun"
import { fromSnapshot } from "@/lib/collaborationReducer"
import { frame, snapshot } from "@/lib/collaborationTestFixtures"
import { CollaborationWorkspace } from "./CollaborationWorkspace"
import type { CollaborationSnapshot } from "@/lib/collaborationProtocol"

afterEach(cleanup)
function mount(
  patch: Partial<CollaborationSnapshot> = {},
  connection: "live" | "forbidden" | "reconnecting" = "live"
) {
  const state = fromSnapshot(snapshot(patch))
  const cancel = vi.fn(),
    retry = vi.fn(),
    close = vi.fn()
  state.events = [
    frame("agent.handoff", 2).event!,
    frame("agent.feedback.requested", 3).event!,
  ]
  const view = {
    run: connection === "live" ? state : null,
    connection,
    cancelling: false,
    error: null,
    cancel,
    retry,
  }
  const rendered = render(
    <CollaborationRunContext.Provider value={view}>
      <CollaborationWorkspace onClose={close} />
    </CollaborationRunContext.Provider>
  )
  return { ...rendered, state, cancel, retry, close, view }
}
describe("collaboration workbench visibility", () => {
  it("marks only observed roles; Vision says it interprets an existing snapshot", () => {
    mount({
      executionStatus: "RUNNING",
      roles: { VISION: "RUNNING", EVIDENCE: "COMPLETED" },
    })
    expect(screen.getAllByText("处理中")).toHaveLength(1)
    expect(screen.getAllByText("等待执行")).toHaveLength(2)
    expect(screen.getByText("解读已有推理快照及质量限制")).toBeTruthy()
  })
  it("keeps clinician handoffs hidden for the patient even if passed to the view", () => {
    mount()
    expect(screen.queryByText(/已交接/)).toBeNull()
    expect(screen.queryByText(/调用轮次/)).toBeNull()
    expect(screen.getByText("正在复核与修订")).toBeTruthy()
  })
  it.each(["v1:admin", "v1:doctor:review-42"])(
    "shows structured handoffs only with authorized projection %s",
    (projectionVersion) => {
      mount({ projectionVersion })
      expect(screen.getByText(/影像解读 → 证据检索：已交接/)).toBeTruthy()
      fireEvent.click(screen.getAllByText("查看交接元数据")[0])
      expect(screen.getByText(/当前记录不含临床正文/)).toBeTruthy()
    }
  )
  it.each(["PENDING", "APPROVED", "REJECTED", "INVALIDATED"] as const)(
    "separates successful execution and review %s without publishing text",
    (reviewStatus) => {
      mount({ executionStatus: "SUCCEEDED", reviewStatus })
      expect(screen.getByText("协作完成")).toBeTruthy()
      expect(screen.queryByRole("button", { name: "取消协作任务" })).toBeNull()
      expect(screen.getByRole("button", { name: "刷新复核状态" })).toBeTruthy()
      expect(screen.queryByText(/Synthetic private/)).toBeNull()
    }
  )
  it.each(["RESTRICTED", "FAILED", "CANCELLED"] as const)(
    "does not fabricate completion for %s",
    (executionStatus) => {
      mount({
        executionStatus,
        roles: {},
        reason: "<img src=x onerror=alert(1)>",
      })
      expect(screen.getAllByText("未执行")).toHaveLength(4)
      expect(screen.queryByText("待医生复核")).toBeNull()
      expect(screen.queryByText(/onerror/)).toBeNull()
    }
  )
  it.each(["forbidden", "reconnecting"] as const)(
    "clears protected panels during %s",
    (connection) => {
      mount({}, connection)
      expect(screen.queryByLabelText("协作角色状态")).toBeNull()
      expect(screen.queryByLabelText("影像与证据")).toBeNull()
      expect(screen.queryByRole("button", { name: "取消协作任务" })).toBeNull()
    }
  )
  it("returning to chat does not cancel, explicit cancellation does", () => {
    const { cancel, close } = mount({ executionStatus: "RUNNING" })
    fireEvent.click(screen.getByRole("button", { name: "返回问答" }))
    expect(close).toHaveBeenCalledTimes(1)
    expect(cancel).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole("button", { name: "取消协作任务" }))
    expect(cancel).toHaveBeenCalledTimes(1)
  })
  it("folds long records and lets a reader pause auto-follow", () => {
    const { view, state, rerender } = mount({ executionStatus: "RUNNING" })
    state.events = Array.from(
      { length: 80 },
      (_, i) => frame("agent.started", i + 10).event!
    )
    rerender(
      <CollaborationRunContext.Provider value={{ ...view, run: { ...state } }}>
        <CollaborationWorkspace onClose={vi.fn()} />
      </CollaborationRunContext.Provider>
    )
    const region = screen.getByRole("region", { name: "协作记录滚动区" })
    expect(within(region).getAllByRole("listitem")).toHaveLength(30)
    fireEvent.click(screen.getByText("展开较早记录"))
    expect(within(region).getAllByRole("listitem")).toHaveLength(80)
    Object.defineProperties(region, {
      scrollHeight: { value: 2000 },
      clientHeight: { value: 200 },
    })
    region.scrollTop = 30
    fireEvent.scroll(region)
    state.events = [...state.events, frame("agent.started", 99).event!]
    rerender(
      <CollaborationRunContext.Provider value={{ ...view, run: { ...state } }}>
        <CollaborationWorkspace onClose={vi.fn()} />
      </CollaborationRunContext.Provider>
    )
    expect(region.scrollTop).toBe(30)
    fireEvent.click(screen.getByText("回到最新进展"))
    expect(region.scrollTop).toBe(2000)
  })
})
