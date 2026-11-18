// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest"
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { MemoryRouter, Route, Routes } from "react-router-dom"
import { ThemeProvider } from "@/components/theme-provider"
import { ApiError, getChatHistory, getSessions, type AgentSessionVO, type ChatHistoryVO } from "@/lib/api"
import { AgentSendError } from "@/lib/agentStream"
import { AgentPage } from "./AgentPage"

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

const sendMock = vi.hoisted(() => vi.fn())
// reset 必须整个会话稳定——否则初始化 effect 每次渲染都重跑，历史被反复拉取。
const resetMock = vi.hoisted(() => vi.fn())
// 让用例在 send 抛错之前往消息表里塞一条「本回合已流出的内容」，
// 用来区分「服务端已受理后失败」与「压根没发出去」两种回滚语义。
const streamControls = vi.hoisted(() => ({ push: (message: unknown) => { void message } }))

vi.mock("@/lib/agentStream", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/agentStream")>()
  const React = await import("react")
  return {
    // 保留 mapHistoryMessage 等真实导出：AgentPage 用它把历史映射成流消息。
    ...actual,
    useAgentStream: () => {
      const [messages, setMessages] = React.useState<unknown[]>([])
      streamControls.push = (message: unknown) => setMessages((prev) => [...prev, message])
      return {
        messages,
        isStreaming: false,
        resources: { images: [], links: [] },
        send: sendMock,
        abort: vi.fn(),
        pushUser: (message: unknown) => setMessages((prev) => [...prev, message]),
        setMessages,
        reset: resetMock,
      }
    },
  }
})

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>()
  return {
    ...actual,
    getSessions: vi.fn().mockResolvedValue([]),
    getChatHistory: vi.fn(),
    generateTitle: vi.fn().mockResolvedValue(true),
  }
})

// 上传器可控：上传耗时是「发送互斥」唯一能观察到的窗口。
const uploadFilesMock = vi.hoisted(() => vi.fn())
vi.mock("@/lib/agentUpload", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/agentUpload")>()
  return {
    ...actual,
    createAgentUploader: () => ({
      uploadFiles: uploadFilesMock,
      commitSuccess: vi.fn(),
      commitFailure: vi.fn(),
    }),
  }
})

const originalRandomUUID = globalThis.crypto.randomUUID

afterEach(() => {
  cleanup()
  sessionState.status = "anon"
  sessionState.user = null
  localStorage.clear()
  // 输入区草稿存在 sessionStorage：不清的话上一条用例的草稿会带进下一条，
  // 输入框一开场就有字，占位符查不到。
  sessionStorage.clear()
  vi.mocked(getSessions).mockResolvedValue([])
  vi.mocked(getChatHistory).mockReset()
  Object.defineProperty(globalThis.crypto, "randomUUID", {
    value: originalRandomUUID,
    configurable: true,
  })
})

/** jsdom 没有 matchMedia——主题探测要用。 */
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

describe("AgentPage 未登录", () => {
  it("先展示界面，不直接把人踢去登录页", () => {
    stubMatchMedia()
    render(
      <ThemeProvider>
        <MemoryRouter initialEntries={["/agent"]}>
          <Routes>
            <Route path="/agent" element={<AgentPage />} />
            <Route path="/login" element={<div>登录页</div>} />
          </Routes>
        </MemoryRouter>
      </ThemeProvider>,
    )
    // 界面在，欢迎屏可见
    expect(screen.getByRole("heading", { name: "你好，我是 Iris" })).toBeTruthy()
    expect(screen.queryByText("登录页")).toBeNull()
  })

  it("收起会话栏后左栏折叠（常驻 DOM + 宽度动画），对话区不被压窄", () => {
    stubMatchMedia()
    render(
      <ThemeProvider>
        <MemoryRouter initialEntries={["/agent"]}>
          <Routes>
            <Route path="/agent" element={<AgentPage />} />
            <Route path="/login" element={<div>登录页</div>} />
          </Routes>
        </MemoryRouter>
      </ThemeProvider>,
    )
    fireEvent.click(screen.getByRole("button", { name: "收起会话栏" }))

    const layout = document.querySelector(".agent-workspace")!
    expect(layout.className).toContain("is-nav-collapsed")
    // 会话栏常驻 DOM，只是折叠——移除会让中栏自动排进左列而塌成窄条
    expect(document.querySelector(".agent-nav.is-collapsed")).toBeTruthy()
    expect(document.querySelector(".agent-sessions")).toBeTruthy()
    // 左上角恢复钮组在
    expect(screen.getByRole("button", { name: "展开会话栏" })).toBeTruthy()
    // 再展开，侧栏回来
    fireEvent.click(screen.getByRole("button", { name: "展开会话栏" }))
    expect(document.querySelector(".agent-nav.is-collapsed")).toBeNull()
    expect(document.querySelector(".agent-sessions")).toBeTruthy()
  })

  it("切换会话后旧历史不落到新会话", async () => {
    sessionState.status = "authed"
    sessionState.user = { id: 1, userAccount: "tester" }
    const session = (id: string, title: string): AgentSessionVO => ({
      sessionId: id,
      title,
      lastMessage: "",
      messageCount: 1,
      summaryContent: "",
      createdTime: "2026-11-08 10:00:00",
      updatedTime: "2026-11-08 10:00:00",
    })
    vi.mocked(getSessions).mockResolvedValue([session("A", "会话 A"), session("B", "会话 B")])

    const deferred = () => {
      let resolve!: (value: ChatHistoryVO) => void
      const promise = new Promise<ChatHistoryVO>((r) => {
        resolve = r
      })
      return { promise, resolve }
    }
    const historyA = deferred()
    const historyB = deferred()
    vi.mocked(getChatHistory).mockImplementation((id) =>
      id === "A" ? historyA.promise : historyB.promise,
    )
    const history = (content: string): ChatHistoryVO => ({
      messages: [
        { id: "1", role: "ASSISTANT", subType: "", content, isSummary: false, createdTime: "2026-11-08 10:00:00" },
      ],
      hasMore: false,
      nextCursor: null,
    })

    stubMatchMedia()
    render(
      <ThemeProvider>
        <MemoryRouter initialEntries={["/agent"]}>
          <Routes>
            <Route path="/agent" element={<AgentPage />} />
          </Routes>
        </MemoryRouter>
      </ThemeProvider>,
    )

    // A 的请求先发出、B 的请求后发出——但 A 晚到，不能覆盖已经显示的 B。
    // 行按钮的可访问名以标题开头；行级操作钮是「会话操作：…」，这里按前缀区分。
    fireEvent.click(await screen.findByRole("button", { name: /^会话 A/ }))
    fireEvent.click(await screen.findByRole("button", { name: /^会话 B/ }))
    await act(async () => historyB.resolve(history("B 的新消息")))
    expect(await screen.findByText("B 的新消息")).toBeTruthy()

    await act(async () => historyA.resolve(history("A 的旧消息")))
    expect(screen.queryByText("A 的旧消息")).toBeNull()
    expect(screen.getByText("B 的新消息")).toBeTruthy()
  })

  it("非安全上下文没有 crypto.randomUUID 时也能发送", async () => {
    sessionState.status = "authed"
    sessionState.user = { id: 1, userAccount: "tester" }
    // 内网 http 部署下 crypto.randomUUID 不存在——发消息不能因此崩掉。
    Object.defineProperty(globalThis.crypto, "randomUUID", {
      value: undefined,
      configurable: true,
    })
    stubMatchMedia()

    render(
      <ThemeProvider>
        <MemoryRouter initialEntries={["/agent"]}>
          <Routes>
            <Route path="/agent" element={<AgentPage />} />
          </Routes>
        </MemoryRouter>
      </ThemeProvider>,
    )

    const textarea = (await screen.findByPlaceholderText(
      /Enter 发送/,
    )) as HTMLTextAreaElement
    fireEvent.change(textarea, { target: { value: "没有 randomUUID" } })
    fireEvent.keyDown(textarea, { key: "Enter" })

    await waitFor(() => expect(sendMock).toHaveBeenCalledTimes(1))
  })

  it("发送失败但没拿到服务端回执：保留气泡并标「送达未确认」", async () => {
    sessionState.status = "authed"
    sessionState.user = { id: 1, userAccount: "tester" }
    // 没有 2xx 响应头 ≠ 服务端没收到：请求可能已经落库，只是响应没回来。
    // 这时撤回气泡会导致「界面没有提问、服务端有记录」，重试还会再写一条。
    sendMock.mockRejectedValueOnce(new Error("boom"))
    vi.mocked(getChatHistory).mockRejectedValueOnce(new Error("network down"))
    stubMatchMedia()

    render(
      <ThemeProvider>
        <MemoryRouter initialEntries={["/agent"]}>
          <Routes>
            <Route path="/agent" element={<AgentPage />} />
          </Routes>
        </MemoryRouter>
      </ThemeProvider>,
    )

    const textarea = (await screen.findByPlaceholderText(
      /Enter 发送/,
    )) as HTMLTextAreaElement
    fireEvent.change(textarea, { target: { value: "发不出去的话" } })
    fireEvent.keyDown(textarea, { key: "Enter" })

    await waitFor(() => expect(sendMock).toHaveBeenCalledTimes(1))
    // 气泡留在原地
    await waitFor(() =>
      expect(
        screen.queryAllByText("发不出去的话").filter((node) => node.tagName !== "TEXTAREA"),
      ).toHaveLength(1),
    )
    // 并且诚实地说「送达未确认」——不臆断成发出去了，也不假装没发生
    expect(await screen.findByText(/送达未确认/)).toBeTruthy()
    // 输入框保留原文，方便用户自己决定要不要重发
    expect(textarea.value).toBe("发不出去的话")
  })

  it("回执未知时用历史接口核对：服务端已有这条就按已受理处理", async () => {
    sessionState.status = "authed"
    sessionState.user = { id: 1, userAccount: "tester" }
    sendMock.mockRejectedValueOnce(new Error("stream interrupted before headers"))
    vi.mocked(getChatHistory).mockResolvedValueOnce({
      messages: [
        {
          id: "99",
          role: "USER",
          subType: "",
          content: "其实已经落库了",
          isSummary: false,
          createdTime: "2026-11-18 01:00:00",
        },
      ],
      hasMore: false,
      nextCursor: null,
    })
    stubMatchMedia()

    render(
      <ThemeProvider>
        <MemoryRouter initialEntries={["/agent"]}>
          <Routes>
            <Route path="/agent" element={<AgentPage />} />
          </Routes>
        </MemoryRouter>
      </ThemeProvider>,
    )

    const textarea = (await screen.findByPlaceholderText(
      /Enter 发送/,
    )) as HTMLTextAreaElement
    fireEvent.change(textarea, { target: { value: "其实已经落库了" } })
    fireEvent.keyDown(textarea, { key: "Enter" })

    await waitFor(() => expect(sendMock).toHaveBeenCalledTimes(1))
    // 核对结果：服务端有这条 → 不再显示「送达未确认」
    await waitFor(() => expect(screen.queryByText(/送达未确认/)).toBeNull())
    expect(
      screen.queryAllByText("其实已经落库了").filter((node) => node.tagName !== "TEXTAREA"),
    ).toHaveLength(1)
  })

  it("服务端明确拒绝（未登录）：标「未送达」且不再去核对历史", async () => {
    sessionState.status = "authed"
    sessionState.user = { id: 1, userAccount: "tester" }
    // 页面测试把 hook mock 掉了，所以这里要抛真实的 AgentSendError——
    // rejected 由 agentStream 依据 ApiError 码计算。
    sendMock.mockRejectedValueOnce(
      new AgentSendError(false, "会话标识或用户为空", new ApiError(40100, "会话标识或用户为空")),
    )
    stubMatchMedia()

    render(
      <ThemeProvider>
        <MemoryRouter initialEntries={["/agent"]}>
          <Routes>
            <Route path="/agent" element={<AgentPage />} />
          </Routes>
        </MemoryRouter>
      </ThemeProvider>,
    )

    const textarea = (await screen.findByPlaceholderText(
      /Enter 发送/,
    )) as HTMLTextAreaElement
    fireEvent.change(textarea, { target: { value: "被拒绝的话" } })
    fireEvent.keyDown(textarea, { key: "Enter" })

    await waitFor(() => expect(sendMock).toHaveBeenCalledTimes(1))
    expect(await screen.findByText(/服务端拒绝了这次请求/)).toBeTruthy()
    // 明确被拒 = 服务端没有这条，不必（也不该）再查历史
    expect(getChatHistory).not.toHaveBeenCalled()
  })

  it("流已产生内容后失败：保留用户气泡，不制造「没有提问的回答」", async () => {
    sessionState.status = "authed"
    sessionState.user = { id: 1, userAccount: "tester" }
    // 后端先落库用户消息再开流：只要已流出内容，这条提问在服务端一定存在。
    sendMock.mockImplementationOnce(async () => {
      streamControls.push({
        id: "assistant-partial",
        type: "assistant",
        content: "先说一半",
        time: "00:00",
      })
      throw new Error("stream interrupted")
    })
    stubMatchMedia()

    render(
      <ThemeProvider>
        <MemoryRouter initialEntries={["/agent"]}>
          <Routes>
            <Route path="/agent" element={<AgentPage />} />
          </Routes>
        </MemoryRouter>
      </ThemeProvider>,
    )

    const textarea = (await screen.findByPlaceholderText(
      /Enter 发送/,
    )) as HTMLTextAreaElement
    fireEvent.change(textarea, { target: { value: "已经发出去的话" } })
    fireEvent.keyDown(textarea, { key: "Enter" })

    await waitFor(() => expect(sendMock).toHaveBeenCalledTimes(1))
    // 提问必须留着：撤回会和服务端已落库的那条对不上，重试还会再写一条。
    await waitFor(() =>
      expect(
        screen.queryAllByText("已经发出去的话").filter((node) => node.tagName !== "TEXTAREA"),
      ).toHaveLength(1),
    )
    // 半截回答也留着，界面上是「提问 + 半截回答 + 失败提示」，而不是一条悬空回答。
    expect(
      screen.queryAllByText("先说一半").filter((node) => node.tagName !== "TEXTAREA"),
    ).toHaveLength(1)
  })
})

describe("AgentPage 窄屏", () => {
  /** matchMedia 可控桩：断点判定由测试推动，模拟旋屏/拖窗口。 */
  function stubMatchMediaControlled(initial: boolean) {
    const listeners = new Set<() => void>()
    const state = { matches: initial }
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      value: (query: string) => ({
        get matches() {
          return state.matches
        },
        media: query,
        onchange: null,
        addEventListener: (_: string, listener: () => void) => listeners.add(listener),
        removeEventListener: (_: string, listener: () => void) => listeners.delete(listener),
        addListener: () => {},
        removeListener: () => {},
        dispatchEvent: () => false,
      }),
    })
    return {
      setMatches(next: boolean) {
        state.matches = next
        listeners.forEach((listener) => listener())
      },
    }
  }

  it("窄屏会话栏默认收起，首屏留给对话区", () => {
    stubMatchMediaControlled(true)
    render(
      <ThemeProvider>
        <MemoryRouter initialEntries={["/agent"]}>
          <Routes>
            <Route path="/agent" element={<AgentPage />} />
          </Routes>
        </MemoryRouter>
      </ThemeProvider>,
    )
    // 紧凑档：会话导航不再占一列，改由抽屉承载，首屏整块留给对话
    expect(document.querySelector(".agent-nav")).toBeNull()
    expect(screen.getByRole("button", { name: "打开会话列表" })).toBeTruthy()
  })

  it("宽屏会话栏默认展开", () => {
    stubMatchMediaControlled(false)
    render(
      <ThemeProvider>
        <MemoryRouter initialEntries={["/agent"]}>
          <Routes>
            <Route path="/agent" element={<AgentPage />} />
          </Routes>
        </MemoryRouter>
      </ThemeProvider>,
    )
    expect(document.querySelector(".agent-nav")).toBeTruthy()
    expect(document.querySelector(".agent-nav.is-collapsed")).toBeNull()
  })

  it("跨过断点时跟上：回宽屏自动展开，进窄屏自动收起", async () => {
    const mq = stubMatchMediaControlled(false)
    render(
      <ThemeProvider>
        <MemoryRouter initialEntries={["/agent"]}>
          <Routes>
            <Route path="/agent" element={<AgentPage />} />
          </Routes>
        </MemoryRouter>
      </ThemeProvider>,
    )
    expect(document.querySelector(".agent-nav")).toBeTruthy()

    await act(async () => {
      mq.setMatches(true)
    })
    expect(document.querySelector(".agent-nav")).toBeNull()
    expect(screen.getByRole("button", { name: "打开会话列表" })).toBeTruthy()

    await act(async () => {
      mq.setMatches(false)
    })
    expect(document.querySelector(".agent-nav")).toBeTruthy()
  })

  it("用户手动展开后不跨断点保持原状；真跨断点时以断点为准", async () => {
    const mq = stubMatchMediaControlled(true)
    render(
      <ThemeProvider>
        <MemoryRouter initialEntries={["/agent"]}>
          <Routes>
            <Route path="/agent" element={<AgentPage />} />
          </Routes>
        </MemoryRouter>
      </ThemeProvider>,
    )
    // 紧凑档：手动「打开会话列表」把导航拉成抽屉盖在对话上
    fireEvent.click(screen.getByRole("button", { name: "打开会话列表" }))
    expect(document.querySelector(".agent-drawer.is-left")).toBeTruthy()

    // 手动展开后先去宽屏：侧栏以常驻列回来。
    await act(async () => {
      mq.setMatches(false)
    })
    expect(document.querySelector(".agent-nav")).toBeTruthy()
    expect(document.querySelector(".agent-nav.is-collapsed")).toBeNull()

    // 再回窄屏：列消失、以断点为准，不要求用户再手动收一次。
    await act(async () => {
      mq.setMatches(true)
    })
    expect(document.querySelector(".agent-nav")).toBeNull()
  })
})

describe("AgentPage 发送互斥", () => {
  it("上传进行中再触发发送不会并发上传，也不会推第二条用户消息", async () => {
    sessionState.status = "authed"
    sessionState.user = { id: 1, userAccount: "tester" }
    sendMock.mockClear()
    uploadFilesMock.mockClear()

    let resolveUpload!: (value: { urls: string[] }) => void
    uploadFilesMock.mockReturnValueOnce(
      new Promise<{ urls: string[] }>((resolve) => {
        resolveUpload = resolve
      }),
    )
    sendMock.mockResolvedValueOnce(undefined)
    stubMatchMedia()

    render(
      <ThemeProvider>
        <MemoryRouter initialEntries={["/agent"]}>
          <Routes>
            <Route path="/agent" element={<AgentPage />} />
          </Routes>
        </MemoryRouter>
      </ThemeProvider>,
    )

    const textarea = (await screen.findByPlaceholderText(
      /Enter 发送/,
    )) as HTMLTextAreaElement
    const file = new File(["x"], "fundus.jpg", { type: "image/jpeg" })
    const input = document.querySelector('input[type="file"]') as HTMLInputElement
    fireEvent.change(input, { target: { files: [file] } })
    fireEvent.keyDown(textarea, { key: "Enter" })

    await waitFor(() => expect(uploadFilesMock).toHaveBeenCalledTimes(1))

    // 上传还没回来：用户消息尚未推入，欢迎屏还在。这时从欢迎屏点一个
    // 引导入口，不能并发再发一条（否则会出现两次上传、两条用户气泡）。
    fireEvent.click(screen.getByRole("button", { name: /描述症状/ }))

    expect(uploadFilesMock).toHaveBeenCalledTimes(1)
    expect(sendMock).not.toHaveBeenCalled()

    await act(async () => {
      resolveUpload({ urls: ["https://cos.example/fundus.jpg"] })
    })

    await waitFor(() => expect(sendMock).toHaveBeenCalledTimes(1))
    // 只发了一条，且带的是这一次上传的图片。
    expect(sendMock.mock.calls[0][2]).toEqual(["https://cos.example/fundus.jpg"])
  })
})
