// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { cleanup, render, screen } from "@testing-library/react"
import { MemoryRouter, Route, Routes } from "react-router-dom"
import { ThemeProvider } from "@/components/theme-provider"
import { collaborationApi } from "@/lib/collaborationApi"
import { getChatHistory, getSessions } from "@/lib/api"
import { AgentPage } from "./AgentPage"

/**
 * /agent 是冻结的普通聊天页：协作工作台在 /agent/collaboration 独立路由。
 * 这里守的是这条边界——普通聊天在任何开关状态下都不发起协作请求，
 * 也不因为 URL 里带了 runId 就把协作视图渲染出来。
 */
const sessionState = vi.hoisted(() => ({
  status: "anon" as string,
  user: null as null | { id: number; userAccount: string },
}))

vi.mock("@/lib/session", () => ({
  useSession: () => ({
    status: sessionState.status,
    user: sessionState.user,
    signIn: vi.fn(),
    signOut: vi.fn(),
    refresh: vi.fn(),
  }),
}))

vi.mock("@/lib/agentStream", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/agentStream")>()
  const React = await import("react")
  return {
    ...actual,
    useAgentStream: () => {
      const [messages, setMessages] = React.useState<unknown[]>([])
      return {
        messages,
        isStreaming: false,
        resources: { images: [], documents: [], links: [] },
        send: vi.fn(),
        abort: vi.fn(),
        pushUser: (message: unknown) => setMessages((prev) => [...prev, message]),
        setMessages,
        reset: vi.fn(),
      }
    },
  }
})

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>()
  return {
    ...actual,
    getSessions: vi.fn().mockResolvedValue([]),
    getChatHistory: vi.fn().mockResolvedValue({
      messages: [],
      hasMore: false,
      nextCursor: null,
    }),
    generateTitle: vi.fn().mockResolvedValue(true),
  }
})

vi.mock("@/lib/collaborationApi", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/collaborationApi")>()
  return {
    ...actual,
    collaborationApi: {
      create: vi.fn(),
      snapshot: vi.fn(),
      stream: vi.fn(),
      cancel: vi.fn(),
    },
  }
})

const originalRandomUUID = globalThis.crypto.randomUUID

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

function renderAgent(path: string) {
  return render(
    <ThemeProvider>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/agent" element={<AgentPage />} />
        </Routes>
      </MemoryRouter>
    </ThemeProvider>,
  )
}

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(getSessions).mockResolvedValue([])
  vi.mocked(getChatHistory).mockResolvedValue({
    messages: [],
    hasMore: false,
    nextCursor: null,
  })
  sessionState.status = "authed"
  sessionState.user = { id: 1, userAccount: "tester" }
  localStorage.clear()
  stubMatchMedia()
})

afterEach(() => {
  cleanup()
  localStorage.clear()
  vi.unstubAllEnvs()
  Object.defineProperty(globalThis.crypto, "randomUUID", {
    value: originalRandomUUID,
    configurable: true,
  })
})

describe("/agent 保持普通聊天边界", () => {
  it("开关打开且 URL 带 runId 时，普通聊天仍不发起任何协作请求", () => {
    vi.stubEnv("VITE_COLLABORATION_ENABLED", "true")
    renderAgent("/agent?runId=run-a")
    expect(collaborationApi.create).not.toHaveBeenCalled()
    expect(collaborationApi.snapshot).not.toHaveBeenCalled()
    expect(collaborationApi.stream).not.toHaveBeenCalled()
    expect(collaborationApi.cancel).not.toHaveBeenCalled()
  })

  it("开关关闭时同样不发起协作请求", () => {
    vi.stubEnv("VITE_COLLABORATION_ENABLED", "false")
    renderAgent("/agent?runId=run-a")
    expect(collaborationApi.snapshot).not.toHaveBeenCalled()
    expect(collaborationApi.create).not.toHaveBeenCalled()
  })

  it("普通聊天页不渲染协作工作台控件", () => {
    vi.stubEnv("VITE_COLLABORATION_ENABLED", "true")
    renderAgent("/agent")
    expect(screen.queryByRole("button", { name: "取消协作任务" })).toBeNull()
    expect(document.querySelector(".collaboration-page")).toBeNull()
    expect(document.querySelector(".collab-page-heading")).toBeNull()
  })
})
