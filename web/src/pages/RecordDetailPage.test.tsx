// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { cleanup, render, screen } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { MemoryRouter, Route, Routes } from "react-router-dom"
import { ThemeProvider } from "@/components/theme-provider"
import { ApiError } from "@/lib/api"
import { RecordDetailPage } from "./RecordDetailPage"

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
  return { ...actual, getMyDiagnosis: vi.fn() }
})

import { getMyDiagnosis } from "@/lib/api"

const RESULT = {
  id: "9001",
  result: "青光眼",
  confidence: 0.72,
  createTime: "2026-11-15T10:00:00",
  modelVersion: "synthetic-test",
  severity: "moderate",
  humanReviewStatus: "REVIEWED",
  requiresReview: false,
}

beforeEach(() => {
  sessionState.status = "authed"
  sessionState.user = { id: "u1", userAccount: "u1" }
  sessionState.scope = "u1"
})

afterEach(() => {
  cleanup()
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

function renderAt(path: string) {
  stubMatchMedia()
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route path="/records/:id" element={<RecordDetailPage />} />
          </Routes>
        </MemoryRouter>
      </ThemeProvider>
    </QueryClientProvider>,
  )
}

describe("RecordDetailPage", () => {
  it("按路由 id 取记录并渲染正式报告（刷新后同样成立）", async () => {
    vi.mocked(getMyDiagnosis).mockResolvedValue(RESULT as never)

    renderAt("/records/9001")

    expect(await screen.findByRole("heading", { name: "青光眼" })).toBeTruthy()
    // 编号在报告抬头与记录纸上各出现一次，两处都必须来自路由 id。
    expect(screen.getAllByText(/IRIS-9001/).length).toBeGreaterThan(0)
    expect(getMyDiagnosis).toHaveBeenCalledWith("9001", expect.anything())
  })

  it("匿名时不发请求，给登录入口", async () => {
    sessionState.status = "anon"
    sessionState.user = null

    renderAt("/records/9001")

    expect(await screen.findByText("登录后才能查看这份报告")).toBeTruthy()
    expect(getMyDiagnosis).not.toHaveBeenCalled()
  })

  it("读不到时出故障面板，不假装记录不存在", async () => {
    vi.mocked(getMyDiagnosis).mockRejectedValue(new ApiError(403, "无权访问这条记录"))

    renderAt("/records/9001")

    expect(await screen.findByText("这份报告没有读出来")).toBeTruthy()
  })

  it("跨账号读不到时只给降级提示，绝不泄漏授权与回执", async () => {
    // 拿别人的记录 id 打开报告：后端按归属拒绝，前端不得渲染任何投影字段。
    vi.mocked(getMyDiagnosis).mockRejectedValue(new ApiError(40300, "无权访问该记录"))

    renderAt("/records/9001")

    expect(await screen.findByText("这份报告没有读出来")).toBeTruthy()
    expect(screen.queryByText("来源与授权 · PROVENANCE")).toBeNull()
    expect(screen.queryByText(/回执/)).toBeNull()
  })

  it("历史记录没有投影字段：报告照常出，不编来源，也不冒充待复核", async () => {
    vi.mocked(getMyDiagnosis).mockResolvedValue({
      id: "9001",
      result: "正常",
      confidence: 0.9,
      severity: "NORMAL",
      createTime: "2026-11-17 22:00:00",
      humanReviewStatus: "AI_ONLY",
    } as never)

    renderAt("/records/9001")

    expect(await screen.findByText(/AI 判读结果/)).toBeTruthy()
    expect(screen.queryByText("来源与授权 · PROVENANCE")).toBeNull()
    // AI_ONLY 没有被排进复核队列，就不能显示成「待复核」
    expect(screen.queryByText("待复核")).toBeNull()
  })

  it("协作记录展示四类事实：来源 / 草稿 / 授权 / 影像", async () => {
    vi.mocked(getMyDiagnosis).mockResolvedValue({
      id: "9001",
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
    } as never)

    renderAt("/records/9001")

    expect(await screen.findByText("来源与授权 · PROVENANCE")).toBeTruthy()
    expect(screen.getByText("协作任务 · 由草稿生成")).toBeTruthy()
    expect(screen.getByText(/患者已授权保存 · 2026-11-17 22:10:00（未标注时区） · 回执 abcdef12…/)).toBeTruthy()
    expect(screen.getByText("已归档 · 按隐私策略不公开")).toBeTruthy()
    // D-01b：写复核的人是管理员，报告上就不能出现「医生」
    expect(screen.getByText("管理员（admin）")).toBeTruthy()
    expect(screen.queryByText(/医生复核/)).toBeNull()
  })
})
