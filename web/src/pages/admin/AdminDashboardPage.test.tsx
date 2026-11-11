// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { MemoryRouter } from "react-router-dom"

import { AdminDashboardPage } from "./AdminDashboardPage"
import { getAdminStats, listDiagnoses, type AdminStats } from "@/lib/adminApi"

vi.mock("@/lib/adminApi", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/adminApi")>()
  return {
    ...actual,
    getAdminStats: vi.fn(),
    listDiagnoses: vi.fn(() => Promise.resolve({ records: [], total: 0, current: 1, pageSize: 5 })),
  }
})

afterEach(() => {
  cleanup()
  vi.mocked(getAdminStats).mockReset()
  vi.mocked(listDiagnoses).mockClear()
})

function statsOf(days: number, inRange: number): AdminStats {
  return {
    days,
    rangeStart: `2026-11-${String(days).padStart(2, "0")}`,
    rangeEnd: "2026-11-11",
    userTotal: 10,
    userNew: 1,
    previousUserNew: 1,
    userAdmin: 1,
    diagnosisTotal: inRange,
    diagnosisInRange: inRange,
    previousDiagnosisInRange: inRange,
    diagnosisToday: 1,
    diagnosisAiRejected: 0,
    diagnosisAwaitingReview: 0,
    diagnosisReviewed: 0,
    diagnosisAwaitingReviewTotal: 0,
    avgConfidence: 0.9,
    knowledgeTotal: 1,
    knowledgeChunks: 1,
    knowledgeFailed: 0,
    knowledgeByStatus: [],
    newsTotal: 0,
    newsByStatus: [],
    trendDays: [],
    diagnosisTrend: [],
    previousDiagnosisTrend: [],
    previousUserTrend: [],
    userTrend: [],
    diagnosisDistribution: [],
    reviewDistribution: [],
    diagnosisTrendByResult: [],
  }
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <AdminDashboardPage />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe("AdminDashboardPage 切窗", () => {
  it("切到新窗口时旧读数立刻消失，等新窗口数据回来才显示", async () => {
    let resolve90: (value: AdminStats) => void = () => {}
    vi.mocked(getAdminStats).mockImplementation((days) =>
      days === 30
        ? Promise.resolve(statsOf(30, 111))
        : new Promise<AdminStats>((resolve) => {
            resolve90 = resolve
          }),
    )

    renderPage()
    await screen.findByText("111")
    expect(screen.getAllByText(/近 30 天/).length).toBeGreaterThan(0)

    fireEvent.click(screen.getByRole("button", { name: "90 天" }))

    // 新窗口在途：旧的 30 天读数与采样行必须立即不可见，不能挂在新标签下。
    await waitFor(() => expect(screen.queryByText("111")).toBeNull())
    expect(screen.queryByText(/近 30 天/)).toBeNull()

    resolve90(statsOf(90, 222))

    await screen.findByText("222")
    expect(screen.getAllByText(/近 90 天/).length).toBeGreaterThan(0)
  })

  it("服务端回显窗口与选中值不一致时，同样当作没读到", async () => {
    // 第二次请求回的是 30 天数据（模拟后端回显错窗），不能挂到 90 天标签下。
    vi.mocked(getAdminStats)
      .mockResolvedValueOnce(statsOf(30, 111))
      .mockResolvedValueOnce(statsOf(30, 999))

    renderPage()
    await screen.findByText("111")

    fireEvent.click(screen.getByRole("button", { name: "90 天" }))

    await waitFor(() => expect(screen.getByRole("button", { name: "90 天" }).getAttribute("aria-pressed")).toBe("true"))
    expect(screen.queryByText("999")).toBeNull()
  })
})
