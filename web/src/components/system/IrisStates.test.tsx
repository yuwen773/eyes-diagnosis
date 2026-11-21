// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { MemoryRouter } from "react-router-dom"
import { ThemeProvider } from "@/components/theme-provider"

// 404 带共享产品外壳；顶栏的账号菜单只读会话，测试里固定为匿名。
vi.mock("@/lib/session", () => ({
  useSession: () => ({ status: "anon", user: null, signIn: vi.fn(), signOut: vi.fn(), refresh: vi.fn() }),
}))

import {
  IrisEmptyState,
  IrisErrorState,
  IrisPageLoading,
  NotFoundPage,
} from "./IrisStates"
import { FaultPanel } from "@/components/FaultPanel"
import { fault } from "@/lib/faults"

afterEach(() => cleanup())

describe("IrisPageLoading", () => {
  it("加载态有状态语义、品牌文案，不造假进度", () => {
    render(<IrisPageLoading />)
    const status = screen.getByRole("status")
    expect(status.textContent).toContain("正在载入")
    expect(status.textContent).toContain("Iris")
    expect(screen.queryByText(/%/)).toBeNull()
  })
})

describe("IrisErrorState", () => {
  it("严重度始终带文字标签，标题、说明与恢复动作齐全", () => {
    const run = vi.fn()
    render(
      <IrisErrorState
        fault={fault({
          severity: "critical",
          kind: "server",
          title: "服务这会儿没有响应",
          detail: "通常是临时的，过一会儿再试。",
          action: { label: "重试", run },
        })}
        readouts={[{ label: "请求", value: "POST /api/news" }]}
      />,
    )
    const alert = screen.getByRole("alert")
    expect(alert.textContent).toContain("需要处理")
    expect(alert.textContent).toContain("服务这会儿没有响应")
    expect(alert.textContent).toContain("POST /api/news")
    screen.getByRole("button", { name: "重试" }).click()
    expect(run).toHaveBeenCalledOnce()
    // 故障内部信息不进入 DOM。
    expect(alert.textContent).not.toMatch(/at \w+ \(|stack|token/i)
  })

  it("没有动作时不渲染按钮，也不展示空读数区", () => {
    render(<IrisErrorState fault={fault({ severity: "info", kind: "info", title: "提示" })} />)
    expect(screen.queryByRole("button")).toBeNull()
    expect(screen.queryByRole("definition")).toBeNull()
  })
})

describe("FaultPanel", () => {
  it("保留既有调用参数，5xx 映射为需要处理并给明确重试目标", () => {
    const retry = vi.fn()
    render(
      <FaultPanel
        code={502}
        title="资讯没能读出来"
        body="请稍后再试。"
        endpoint="POST /news/list/page/vo"
        onRetry={retry}
      />,
    )
    expect(screen.getByRole("alert").textContent).toContain("需要处理")
    // 状态码作为读数保留，方便用户报障。
    expect(screen.getByText("502")).toBeTruthy()
    expect(screen.getByText("POST /news/list/page/vo")).toBeTruthy()
    screen.getByRole("button", { name: "重试" }).click()
    expect(retry).toHaveBeenCalledOnce()
  })

  it("网络故障 -1 是需要处理，40400 业务码不能被当成服务端 critical", () => {
    const { unmount } = render(
      <FaultPanel code={-1} title="没连上" body="断网了" endpoint="GET /x" onRetry={vi.fn()} />,
    )
    expect(screen.getByRole("alert").textContent).toContain("需要处理")
    unmount()

    render(
      <FaultPanel
        code={40400}
        title="内容不在了"
        body="下架了"
        endpoint="GET /x"
        onRetry={vi.fn()}
      />,
    )
    const alert = screen.getByRole("alert").textContent
    expect(alert).toContain("请留意")
    expect(alert).not.toContain("需要处理")
    expect(screen.getByText("40400")).toBeTruthy()
  })

  it("拿不到机器码（null）时显示 —，不误报成断网", () => {
    render(
      <FaultPanel code={null} title="读不出来" body="未知错误" endpoint="GET /x" onRetry={vi.fn()} />,
    )
    const alert = screen.getByRole("alert").textContent
    expect(alert).toContain("请留意")
    expect(screen.getByText("—")).toBeTruthy()
  })
})

describe("IrisEmptyState", () => {
  it("空态是一句说明加一个出口", () => {
    render(
      <IrisEmptyState
        title="还没有判读记录"
        description="完成一次影像判读后，结果会出现在这里。"
        action={<button type="button">去判读</button>}
      />,
    )
    expect(screen.getByText("还没有判读记录")).toBeTruthy()
    expect(screen.getByRole("button", { name: "去判读" })).toBeTruthy()
  })
})

describe("NotFoundPage", () => {
  it("给出 404 语义与 replace 回首页出口，不让错误地址留在历史里", () => {
    render(
      <ThemeProvider>
        <MemoryRouter>
          <NotFoundPage />
        </MemoryRouter>
      </ThemeProvider>,
    )
    expect(screen.getByRole("heading", { level: 1 }).textContent).toContain("这个地址不在 Iris 里")
    // 404 与其他公开路由共享同一套产品顶栏。
    expect(document.querySelector("header.product-head")).not.toBeNull()
    const home = screen.getByRole("link", { name: /回到首页/ })
    expect(home.getAttribute("href")).toBe("/")
    // react-router 的 replace 链接不会留下可返回的错误历史项（用 DOM 属性验证出口存在）。
    expect(home.textContent).toContain("回到首页")
    expect(screen.queryByRole("button", { name: /返回上一页/ })).toBeNull()
  })
})
