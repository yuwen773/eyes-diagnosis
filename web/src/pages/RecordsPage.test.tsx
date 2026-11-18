// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
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
    getMyDiagnosis: vi.fn(),
  }
})

import { getMyDiagnosis, getMyStats, listMyDiagnoses } from "@/lib/api"

beforeEach(() => {
  sessionState.status = "authed"
  sessionState.user = { id: "u1", userAccount: "u1" }
  sessionState.scope = "u1"
})

afterEach(() => {
  cleanup()
  vi.mocked(listMyDiagnoses).mockReset()
  vi.mocked(getMyStats).mockReset()
  vi.mocked(getMyDiagnosis).mockReset()
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

    expect(await screen.findByText("登录后才能查看判读记录")).toBeTruthy()
    expect(listMyDiagnoses).not.toHaveBeenCalled()
  })
})

describe("RecordsPage 记录详情：来源投影与跨账号", () => {
  const row = {
    id: "7",
    result: "正常",
    confidence: 0.9,
    severity: "NORMAL",
    createTime: "2026-11-17 22:00:00",
    reexamineStatus: 0,
    url: "https://cdn.example/x.png",
  }

  /** 列表里只有一条记录，点它展开详情。 */
  async function openFirstRecord() {
    vi.mocked(listMyDiagnoses).mockResolvedValue({ records: [row], total: 1 })
    vi.mocked(getMyStats).mockRejectedValue(new ApiError(404, "服务返回 404"))
    renderPage()
    const button = await waitFor(() => {
      const found = document.querySelector<HTMLButtonElement>("button.records__row")
      if (!found) throw new Error("记录行还没渲染出来")
      return found
    })
    fireEvent.click(button)
  }

  it("跨账号读不到时只给降级提示，绝不泄漏授权与回执", async () => {
    // 拿别人的记录 id 求详情：后端按归属拒绝，前端不该渲染任何投影字段。
    vi.mocked(getMyDiagnosis).mockRejectedValue(new ApiError(40300, "无权访问该记录"))

    await openFirstRecord()

    expect(await screen.findByText("这条记录没有读出来")).toBeTruthy()
    expect(screen.queryByText("来源与授权 · PROVENANCE")).toBeNull()
    expect(screen.queryByText(/回执/)).toBeNull()
  })

  it("历史记录没有投影字段：报告照常出，不编来源", async () => {
    vi.mocked(getMyDiagnosis).mockResolvedValue({
      id: "7",
      result: "正常",
      confidence: 0.9,
      severity: "NORMAL",
      createTime: "2026-11-17 22:00:00",
      humanReviewStatus: "AI_ONLY",
    })

    await openFirstRecord()

    expect(await screen.findByText(/AI 判读结果/)).toBeTruthy()
    expect(screen.queryByText("来源与授权 · PROVENANCE")).toBeNull()
    // AI_ONLY 没有被排进复核队列，就不能显示成「待复核」
    expect(screen.queryByText("待复核")).toBeNull()
  })

  it("协作记录展示四类事实：来源 / 草稿 / 授权 / 影像", async () => {
    vi.mocked(getMyDiagnosis).mockResolvedValue({
      id: "7",
      result: "正常",
      confidence: 0.9,
      severity: "NORMAL",
      createTime: "2026-11-17 22:00:00",
      humanReviewStatus: "AI_ONLY",
      source: {
        recordSource: "COLLABORATION_DRAFT",
        patientTaskId: "task-1",
        draftReviewState: "APPROVED",
        authorizationState: "APPROVED",
        authorizedAt: "2026-11-17 22:10:00",
        authorizationReceipt: "abcdef12…",
        reviewerRole: "admin",
        imageArchivalState: "ARCHIVED_NOT_PUBLIC",
      },
    })

    await openFirstRecord()

    expect(await screen.findByText("来源与授权 · PROVENANCE")).toBeTruthy()
    expect(screen.getByText("协作任务 · 由草稿生成")).toBeTruthy()
    expect(screen.getByText(/患者已授权保存 · 2026-11-17 22:10:00/)).toBeTruthy()
    expect(screen.getByText("已归档 · 按隐私策略不公开")).toBeTruthy()
    // D-01b：写复核的人是管理员，报告上就不能出现「医生」
    expect(screen.getByText("管理员（admin）")).toBeTruthy()
    expect(screen.queryByText(/医生复核/)).toBeNull()
  })
})
