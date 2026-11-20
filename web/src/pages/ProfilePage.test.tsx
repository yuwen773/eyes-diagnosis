// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { cleanup, render, screen, waitFor } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { MemoryRouter } from "react-router-dom"
import { ThemeProvider } from "@/components/theme-provider"
import type { DiagnosisManage } from "@/lib/api"
import { ProfilePage } from "./ProfilePage"

const sessionState = vi.hoisted(() => ({
  status: "authed" as "authed" | "anon" | "loading",
  user: { id: "u1", userAccount: "u1" } as { id?: string; userAccount?: string } | null,
  scope: "u1",
}))

vi.mock("@/lib/session", () => ({
  useSession: () => ({
    status: sessionState.status,
    user: sessionState.user,
    scope: sessionState.scope,
    signIn: vi.fn(),
    signOut: vi.fn(),
    refresh: vi.fn(),
    updateUser: vi.fn(),
  }),
}))

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>()
  return {
    ...actual,
    listMyDiagnoses: vi.fn(),
    getMyStats: vi.fn(),
    uploadAvatar: vi.fn(),
    updateUserProfile: vi.fn(),
  }
})

import { ApiError, getMyStats, listMyDiagnoses } from "@/lib/api"

beforeEach(() => {
  sessionState.status = "authed"
  sessionState.user = { id: "u1", userAccount: "u1" }
  sessionState.scope = "u1"
  // 聚合默认不可用：个人中心要能退回本页口径，而不是显示 0。
  vi.mocked(getMyStats).mockResolvedValue(null as never)
})

afterEach(() => {
  cleanup()
  vi.mocked(listMyDiagnoses).mockReset()
  vi.mocked(getMyStats).mockReset()
})

function stubMatchMedia() {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }),
  })
}

function record(partial: Partial<DiagnosisManage>): DiagnosisManage {
  return { id: "1", createTime: "2026-11-13 10:00:00", ...partial } as DiagnosisManage
}

function renderProfile() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={client}>
      <ThemeProvider>
        <MemoryRouter initialEntries={["/profile"]}>
          <ProfilePage />
        </MemoryRouter>
      </ThemeProvider>
    </QueryClientProvider>,
  )
}

describe("ProfilePage 最近判读", () => {
  it("乱序记录按时间倒序展示，AI 拒识行不出置信度", async () => {
    stubMatchMedia()
    vi.mocked(listMyDiagnoses).mockResolvedValue({
      records: [
        record({ id: "a", result: "青光眼", confidence: 70, severity: "moderate", createTime: "2026-11-13 09:00:00" }),
        record({ id: "b", aiRejected: true, result: null, confidence: null, severity: null, createTime: "2026-11-13 10:30:00" }),
        record({ id: "c", result: "白内障", confidence: 88.5, severity: "mild", createTime: "2026-11-13 08:00:00" }),
      ],
      total: 3,
    } as never)
    renderProfile()
    const names = await screen.findAllByText(/青光眼|白内障/)
    expect(names).toHaveLength(2)
    // 拒识行的名字在；整个最近判读卡里只有两条置信度读数（拒识行没有）
    expect(screen.getByText("AI 拒识")).toBeTruthy()
    const recentCard = screen.getByText("AI 拒识").closest(".profile__card--recent")!
    expect(recentCard.querySelectorAll(".profile__recent-conf .num")).toHaveLength(2)
    // 正常行有「置信度」口径标签与读数
    expect(screen.getByText("88.5%")).toBeTruthy()
    expect(screen.getAllByText("置信度").length).toBeGreaterThan(0)
  })

  it("接口失败时不谎报「还没有判读记录」，给重试", async () => {
    stubMatchMedia()
    vi.mocked(listMyDiagnoses).mockRejectedValue(new Error("network down"))
    renderProfile()
    await screen.findByText(/判读记录这会儿没读出来/)
    expect(screen.queryByText("还没有判读记录。")).toBeNull()
    expect(screen.getByRole("button", { name: "重试" })).toBeTruthy()
  })

  it("真的没有记录时才显示空态", async () => {
    stubMatchMedia()
    vi.mocked(listMyDiagnoses).mockResolvedValue({ records: [], total: 0 } as never)
    renderProfile()
    await screen.findByText("还没有判读记录。")
    expect(screen.queryByText(/没读出来/)).toBeNull()
  })
})

describe("ProfilePage 判读统计口径", () => {
  it("聚合接口 404 时退回本页口径：显示真实总数与最近 10 条高风险，不是 0", async () => {
    stubMatchMedia()
    // 37 条判读记录，最近 10 条里有 2 条高风险；聚合接口尚未上线（404）。
    vi.mocked(listMyDiagnoses).mockResolvedValue({
      records: [
        ...Array.from({ length: 8 }, (_, index) =>
          record({ id: `m${index}`, severity: "mild" }),
        ),
        record({ id: "s1", severity: "severe" }),
        record({ id: "s2", severity: "severe" }),
      ],
      total: 37,
    } as never)
    vi.mocked(getMyStats).mockRejectedValue(new ApiError(404, "服务返回 404"))
    const { container } = renderProfile()

    // 口径提示写明：这组数字取自最近一页，不是全量。
    await screen.findByText(/服务端聚合暂不可用/)

    await waitFor(() => {
      const line = container.querySelector(".profile__identity-stats")?.textContent ?? ""
      expect(line).toContain("37")
      expect(line).toContain("2")
    })
  })

  it("聚合可用时用全量口径，不写「暂不可用」", async () => {
    stubMatchMedia()
    vi.mocked(listMyDiagnoses).mockResolvedValue({
      records: [record({ id: "a", severity: "severe" })],
      total: 1,
    } as never)
    vi.mocked(getMyStats).mockResolvedValue({
      total: 128,
      assessed: 128,
      highRisk: 9,
      awaitingReview: 12,
      lastReadAt: "2026-11-08 14:32:10",
    } as never)
    const { container } = renderProfile()

    await waitFor(() => {
      const line = container.querySelector(".profile__identity-stats")?.textContent ?? ""
      expect(line).toContain("128")
      expect(line).toContain("9")
    })
    expect(screen.queryByText(/服务端聚合暂不可用/)).toBeNull()
  })

  it("两个来源都没读出来时显示「—」，不显示 0", async () => {
    stubMatchMedia()
    vi.mocked(listMyDiagnoses).mockRejectedValue(new Error("network down"))
    vi.mocked(getMyStats).mockResolvedValue(null as never)
    const { container } = renderProfile()

    await screen.findByText(/判读记录这会儿没读出来/)
    // 读不到就说读不到：不显示 0，也不永远停在「读取中」。
    const line = container.querySelector(".profile__identity-stats")?.textContent ?? ""
    expect(line).toContain("暂不可用")
    expect(line).not.toContain("0")
  })
})

describe("ProfilePage 最近判读", () => {
  it("每条最近判读都能直接进入对应报告", async () => {
    stubMatchMedia()
    vi.mocked(listMyDiagnoses).mockResolvedValue({
      records: [
        {
          id: "9001",
          result: "青光眼",
          confidence: 0.7,
          createTime: "2026-11-15T10:00:00",
        } as never,
      ],
      total: 1,
    } as never)
    vi.mocked(getMyStats).mockRejectedValue(new Error("offline"))

    renderProfile()

    const link = await screen.findByRole("link", { name: /青光眼/ })
    expect(link.getAttribute("href")).toBe("/records/9001")
  })
})
