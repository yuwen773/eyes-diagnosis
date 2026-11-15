// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import {
  reviewApi,
  type Authorization,
  type PatientView,
} from "@/lib/reviewApi"
import { PatientResultPanel } from "./PatientResultPanel"
vi.mock("@/lib/reviewApi", async (original) => ({
  ...(await original<typeof import("@/lib/reviewApi")>()),
  reviewApi: {
    patient: vi.fn(),
    offer: vi.fn(),
    save: vi.fn(),
    source: vi.fn(),
  },
}))
const explanation = {
  claims: [
    { id: "one", section: "RISK", text: "Approved text", references: [] },
  ],
  sources: [],
  disclaimer: "Model is not a diagnosis",
  modelVersion: "synthetic",
  calibrationNotice: "Not calibrated",
}
const view: PatientView = {
  taskId: "task",
  status: "AVAILABLE",
  message: "",
  result: explanation,
}
const offer: Authorization = {
  taskId: "task",
  authorizationId: "consent",
  status: "OFFERED",
  taskVersion: "2",
  draftVersion: 1,
  evidenceVersion: 1,
  contentDigest: "a".repeat(64),
  expiresAt: "2026-11-12T12:00:00Z",
  content: { explanation, modelPrediction: "glaucoma", modelProbability: 70 },
  receipt: null,
}
beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(reviewApi.patient).mockResolvedValue(view)
  vi.mocked(reviewApi.offer).mockResolvedValue(offer)
})
afterEach(cleanup)
async function prepared() {
  render(<PatientResultPanel taskId="task" />)
  await screen.findByText("Approved text")
  fireEvent.click(
    screen.getByRole("button", { name: "查看拟保存内容或查询回执" })
  )
  await screen.findByRole("checkbox")
}
it("requires an explicit read and checkbox before sending exactly the displayed authorization", async () => {
  await prepared()
  const save = screen.getByRole("button", {
    name: "同意并保存",
  }) as HTMLButtonElement
  expect(save.disabled).toBe(true)
  expect(reviewApi.save).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole("checkbox"))
  expect(save.disabled).toBe(false)
  vi.mocked(reviewApi.save).mockResolvedValue({
    ...offer,
    status: "APPROVED",
    content: null,
    receipt: {
      receiptId: "receipt",
      taskId: "task",
      diagnosisId: "99",
      authorizedAt: "2026-11-12T00:00:00Z",
      contentDigest: offer.contentDigest,
    },
  })
  fireEvent.click(save)
  fireEvent.click(save)
  await waitFor(() => expect(reviewApi.save).toHaveBeenCalledTimes(1))
  expect(vi.mocked(reviewApi.save).mock.calls[0][0]).toEqual(offer)
  await screen.findByLabelText("保存回执")
})
it("an ambiguous save clears content and consent without retrying the approval", async () => {
  await prepared()
  fireEvent.click(screen.getByRole("checkbox"))
  vi.mocked(reviewApi.save).mockRejectedValue(new Error("Network disconnected"))
  fireEvent.click(screen.getByRole("button", { name: "同意并保存" }))
  await screen.findByRole("alert")
  expect(screen.queryByText("Approved text")).toBeNull()
  expect(screen.queryByRole("checkbox")).toBeNull()
  expect(reviewApi.save).toHaveBeenCalledTimes(1)
})
it("losing focus drops the protected offer and ignores its late response", async () => {
  let finish!: (next: Authorization) => void
  vi.mocked(reviewApi.offer).mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve
      })
  )
  render(<PatientResultPanel taskId="task" />)
  await screen.findByText("Approved text")
  fireEvent.click(
    screen.getByRole("button", { name: "查看拟保存内容或查询回执" })
  )
  fireEvent(window, new Event("blur"))
  await act(async () => finish(offer))
  expect(screen.queryByRole("checkbox")).toBeNull()
  expect(screen.queryByText("Approved text")).toBeNull()
  expect(reviewApi.save).not.toHaveBeenCalled()
})
it("source rejection clears the earlier explanation rather than retaining a stale conclusion", async () => {
  const withSource = {
    ...view,
    result: {
      ...explanation,
      claims: [
        {
          ...explanation.claims[0],
          references: [{ citationIndex: 0, quote: "quote" }],
        },
      ],
    },
  }
  vi.mocked(reviewApi.patient).mockResolvedValue(withSource)
  vi.mocked(reviewApi.source).mockRejectedValue(new Error("Revoked source"))
  render(<PatientResultPanel taskId="task" />)
  await screen.findByText("Approved text")
  fireEvent.click(screen.getByRole("button", { name: "查看依据 1" }))
  await screen.findByRole("alert")
  expect(screen.queryByText("Approved text")).toBeNull()
})
