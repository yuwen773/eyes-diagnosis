// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { cleanup, render, screen } from "@testing-library/react"
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
    uploadAvatar: vi.fn(),
    updateUserProfile: vi.fn(),
  }
})

import { listMyDiagnoses } from "@/lib/api"

beforeEach(() => {
  sessionState.status = "authed"
  sessionState.user = { id: "u1", userAccount: "u1" }
  sessionState.scope = "u1"
})

afterEach(() => {
  cleanup()
  vi.mocked(listMyDiagnoses).mockReset()
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
