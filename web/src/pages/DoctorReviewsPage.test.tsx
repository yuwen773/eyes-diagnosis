// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react"
import { MemoryRouter } from "react-router-dom"
import { afterEach, expect, it, vi } from "vitest"
import { DoctorReviewsPage } from "./DoctorReviewsPage"
import { reviewApi, type ReviewDetail } from "@/lib/reviewApi"

vi.mock("@/lib/session", () => ({
  useSession: () => ({
    status: "authed",
    user: { id: 44, userRole: "doctor" },
  }),
}))
vi.mock("@/components/shell/ProductHeader", () => ({
  ProductHeader: () => null,
}))
vi.mock("@/components/agent/collaboration/DoctorReviewImage", () => ({
  DoctorReviewImage: () => null,
}))
vi.mock("@/lib/reviewApi", () => ({
  reviewApi: { list: vi.fn(), detail: vi.fn(), decide: vi.fn() },
}))
afterEach(() => {
  cleanup()
  vi.unstubAllEnvs()
  vi.resetAllMocks()
})

it("shows authorized frozen Vision fields and submits their exact version and digest", async () => {
  vi.stubEnv("VITE_COLLABORATION_ENABLED", "true")
  const frozen: ReviewDetail = {
    reviewId: "review-a",
    taskId: "task-a",
    status: "PENDING",
    assignedAt: "fixture",
    taskVersion: "7",
    draftVersion: 2,
    evidenceVersion: 3,
    materialDigest: "frozen-digest",
    note: null,
    materials: {
      draft: { claims: [] },
      evidence: [],
      agentMessages: [
        {
          role: "VISION",
          sequence: 1,
          state: "COMPLETED",
          output: {
            result: {
              summary: "冻结影像摘要",
              limitations: ["冻结质量限制"],
              reanalysisSuggestion: "REVIEW_QUALITY",
              hiddenReasoning: "隐藏推理不得出现",
            },
          },
        },
        {
          role: "CRITIC",
          sequence: 4,
          state: "COMPLETED",
          output: {
            result: {
              objections: [{ target: "claim:RISK", reason: "冻结具体异议" }],
            },
          },
        },
      ],
    },
  }
  vi.mocked(reviewApi.list).mockResolvedValue([frozen])
  vi.mocked(reviewApi.detail).mockResolvedValue(frozen)
  vi.mocked(reviewApi.decide).mockResolvedValue({
    ...frozen,
    status: "APPROVED",
  })
  render(
    <MemoryRouter>
      <DoctorReviewsPage />
    </MemoryRouter>
  )
  fireEvent.click(screen.getByText("刷新我的复核任务"))
  fireEvent.click(await screen.findByText("复核任务 1"))
  await screen.findByText("冻结材料")
  fireEvent.click(screen.getByText("已冻结的交接与具体异议"))
  expect(screen.getByText("冻结影像摘要")).toBeTruthy()
  expect(screen.getByText("冻结质量限制")).toBeTruthy()
  expect(screen.getByText(/重新核对影像质量/)).toBeTruthy()
  expect(screen.queryByText("隐藏推理不得出现")).toBeNull()
  expect(screen.getByText(/冻结具体异议/)).toBeTruthy()
  fireEvent.change(screen.getByRole("textbox", { name: "复核意见" }), {
    target: { value: "已核对冻结限制" },
  })
  fireEvent.click(screen.getByText("批准当前冻结版本"))
  await waitFor(() =>
    expect(reviewApi.decide).toHaveBeenCalledWith(
      frozen,
      "APPROVED",
      "已核对冻结限制",
      expect.any(AbortSignal)
    )
  )
})
