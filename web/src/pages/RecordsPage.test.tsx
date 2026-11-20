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
  it("服务端聚合未上线时，计数标注「本页」且严重度显示未评估", async () => {
    vi.mocked(listMyDiagnoses).mockResolvedValue({ records: [], total: 0 })
    vi.mocked(getMyStats).mockRejectedValue(new ApiError(404, "服务返回 404"))

    renderPage()

    expect(await screen.findByText("本页严重度 · 未评估")).toBeTruthy()
    expect(screen.getByText("本页待人工复核 · REVIEW")).toBeTruthy()
    // 「未评估」是读数本身，不能退化成 0。
    expect(screen.getByText("未评估")).toBeTruthy()
  })

  it("服务端聚合可用时使用全量口径", async () => {
    vi.mocked(listMyDiagnoses).mockResolvedValue({ records: [], total: 0 })
    vi.mocked(getMyStats).mockResolvedValue({
      total: 128,
      assessed: 128,
      highRisk: 9,
      awaitingReview: 12,
      lastReadAt: null,
    })

    renderPage()

    expect(await screen.findByText("高风险 · SEVERE")).toBeTruthy()
    expect(screen.queryByText("本页严重度 · 未评估")).toBeNull()
  })

  it("当前页记录全部未评估时，高风险格显示未评估而不是 0", async () => {
    vi.mocked(listMyDiagnoses).mockResolvedValue({
      records: [
        { id: "1", result: "正常", severity: "NOT_ASSESSED", createTime: "2026-11-15T10:00:00" },
        { id: "2", result: "青光眼", severity: null, createTime: "2026-11-14T10:00:00" },
      ] as never,
      total: 2,
    })
    vi.mocked(getMyStats).mockRejectedValue(new ApiError(404, "服务返回 404"))

    renderPage()

    expect(await screen.findByText("本页严重度 · 未评估")).toBeTruthy()
    expect(screen.getByText(/后端尚未产出严重度分级/)).toBeTruthy()
  })

  it("当前页有真实分级时按明确口径计数", async () => {
    vi.mocked(listMyDiagnoses).mockResolvedValue({
      records: [
        { id: "1", result: "正常", severity: "normal", createTime: "2026-11-15T10:00:00" },
        { id: "2", result: "青光眼", severity: "severe", createTime: "2026-11-14T10:00:00" },
        { id: "3", result: "白内障", severity: "NOT_ASSESSED", createTime: "2026-11-13T10:00:00" },
      ] as never,
      total: 3,
    })
    vi.mocked(getMyStats).mockRejectedValue(new ApiError(404, "服务返回 404"))

    renderPage()

    expect(await screen.findByText("本页高风险 · 已分级 2/3")).toBeTruthy()
  })
})

describe("RecordsPage 拒识与复核独立表达", () => {
  it("拒识记录同时显示「AI 拒识」与「待人工复核」", async () => {
    vi.mocked(listMyDiagnoses).mockResolvedValue({
      records: [
        {
          id: "7001",
          result: null,
          aiRejected: true,
          requiresReview: true,
          createTime: "2026-11-15T10:00:00",
          reexamineStatus: 0,
        },
      ] as never,
      total: 1,
    })
    vi.mocked(getMyStats).mockRejectedValue(new ApiError(404, "服务返回 404"))

    renderPage()

    expect(await screen.findByText("AI 拒识")).toBeTruthy()
    expect(screen.getByText("待人工复核")).toBeTruthy()
  })
})

describe("RecordsPage 身份闸门", () => {
  it("匿名时不发个人请求，并给出登录入口", async () => {
    sessionState.status = "anon"
    sessionState.user = null
    vi.mocked(listMyDiagnoses).mockResolvedValue({ records: [], total: 0 })

    renderPage()

    expect(await screen.findByText("登录后才能查看判读记录")).toBeTruthy()
    expect(listMyDiagnoses).not.toHaveBeenCalled()
  })
})

describe("RecordsPage 记录行", () => {
  it("整行是指向独立报告页的链接，报告不在列表里展开", async () => {
    vi.mocked(listMyDiagnoses).mockResolvedValue({
      records: [
        {
          id: "9001",
          result: "青光眼",
          confidence: 0.7,
          createTime: "2026-11-15T10:00:00",
          reexamineStatus: 0,
        } as never,
      ],
      total: 1,
    })
    vi.mocked(getMyStats).mockRejectedValue(new ApiError(404, "服务返回 404"))

    renderPage()

    const link = await screen.findByRole("link", { name: /青光眼/ })
    expect(link.getAttribute("href")).toBe("/records/9001")
    // 列表不再展开整份报告：没有打印按钮，也没有记录纸。
    expect(screen.queryByRole("button", { name: /打印/ })).toBeNull()
  })
})
