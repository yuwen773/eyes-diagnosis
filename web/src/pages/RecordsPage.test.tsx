// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { cleanup, render, screen } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { MemoryRouter } from "react-router-dom"
import { ThemeProvider } from "@/components/theme-provider"
import { ApiError } from "@/lib/api"
import { RecordsPage } from "./RecordsPage"

// 会话状态要在 mock 工厂里可见——vi.mock 的工厂先于文件主体执行。
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
  }),
}))

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>()
  return {
    ...actual,
    listMyDiagnoses: vi.fn(),
    getMyStats: vi.fn(),
  }
})

import { getMyStats, listMyDiagnoses } from "@/lib/api"

beforeEach(() => {
  sessionState.status = "authed"
  sessionState.user = { id: "u1", userAccount: "u1" }
  sessionState.scope = "u1"
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

function renderPage() {
  stubMatchMedia()
  // 每个用例独立缓存，禁掉重试让 404 立刻落成降级口径。
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  render(
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <MemoryRouter>
          <RecordsPage />
        </MemoryRouter>
      </ThemeProvider>
    </QueryClientProvider>,
  )
}

describe("RecordsPage 统计口径", () => {
  it("服务端聚合未上线时，三项计数标注「本页」", async () => {
    vi.mocked(listMyDiagnoses).mockResolvedValue({ records: [], total: 0 })
    vi.mocked(getMyStats).mockRejectedValue(new ApiError(404, "服务返回 404"))

    renderPage()

    expect(await screen.findByText("本页高风险 · SEVERE")).toBeTruthy()
  })

  it("服务端聚合可用时使用全量口径", async () => {
    vi.mocked(listMyDiagnoses).mockResolvedValue({ records: [], total: 0 })
    vi.mocked(getMyStats).mockResolvedValue({
      total: 128,
      highRisk: 9,
      awaitingReview: 12,
      lastReadAt: null,
    })

    renderPage()

    expect(await screen.findByText("高风险 · SEVERE")).toBeTruthy()
    expect(screen.queryByText("本页高风险 · SEVERE")).toBeNull()
  })
})

describe("RecordsPage 身份闸门", () => {
  it("匿名时不发个人请求，并给出登录入口", async () => {
    sessionState.status = "anon"
    sessionState.user = null
    vi.mocked(listMyDiagnoses).mockResolvedValue({ records: [], total: 0 })

    renderPage()

    expect(await screen.findByText("登录后才能查看诊断记录")).toBeTruthy()
    expect(listMyDiagnoses).not.toHaveBeenCalled()
  })
})
