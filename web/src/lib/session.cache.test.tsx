// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { cleanup, render, screen, waitFor } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"

import { SessionProvider, sessionScope, useSession } from "./session"
import { queryKeys } from "./queryKeys"
import { AUTH_EXPIRED_EVENT, getLoginUser, login, logout } from "@/lib/api"

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>()
  return {
    ...actual,
    getLoginUser: vi.fn(),
    login: vi.fn(),
    logout: vi.fn(),
  }
})

const A = { id: "A", userAccount: "a" }
const B = { id: "B", userAccount: "b" }

function Harness() {
  const { status, scope, signIn, signOut } = useSession()
  return (
    <div>
      <span data-testid="status">{status}</span>
      <span data-testid="scope">{scope}</span>
      <button type="button" onClick={() => void signIn("b", "pw")}>
        登录 B
      </button>
      <button type="button" onClick={() => void signOut()}>
        登出
      </button>
    </div>
  )
}

let client: QueryClient

function renderSession() {
  return render(
    <QueryClientProvider client={client}>
      <SessionProvider>
        <Harness />
      </SessionProvider>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  vi.mocked(getLoginUser).mockResolvedValue(A)
  vi.mocked(login).mockResolvedValue(B)
  vi.mocked(logout).mockResolvedValue(true)
})

afterEach(() => {
  cleanup()
  vi.mocked(getLoginUser).mockReset()
  vi.mocked(login).mockReset()
  vi.mocked(logout).mockReset()
})

/** A 名下的三块个人缓存 + 一块公开缓存。 */
function seedCaches() {
  client.setQueryData(queryKeys.records.mine("A", { current: 1, pageSize: 10 }), {
    records: [{ id: "a1" }],
    total: 1,
  })
  client.setQueryData(queryKeys.profile.user("A"), { userAccount: "a" })
  client.setQueryData(queryKeys.admin.stats(30), { days: 30 })
  client.setQueryData(queryKeys.news.list(), [{ id: "n1" }])
}

describe("sessionScope", () => {
  it("优先用雪花 id，退回账号名，匿名是固定的一段", () => {
    expect(sessionScope(A)).toBe("A")
    expect(sessionScope({ userAccount: "only-name" })).toBe("only-name")
    expect(sessionScope(null)).toBe("anonymous")
  })
})

describe("身份切换与缓存隔离", () => {
  it("登出后个人域缓存全部作废，公开资讯缓存留着", async () => {
    renderSession()
    await screen.findByText("authed")
    seedCaches()

    screen.getByRole("button", { name: "登出" }).click()
    await waitFor(() => expect(screen.getByTestId("status").textContent).toBe("anon"))

    expect(client.getQueryData(queryKeys.records.mine("A", { current: 1, pageSize: 10 }))).toBeUndefined()
    expect(client.getQueryData(queryKeys.profile.user("A"))).toBeUndefined()
    expect(client.getQueryData(queryKeys.admin.stats(30))).toBeUndefined()
    expect(client.getQueryData(queryKeys.news.list())).toEqual([{ id: "n1" }])
  })

  it("换账号：B 登录后看不到 A 的记录与统计", async () => {
    renderSession()
    await screen.findByText("authed")
    seedCaches()

    screen.getByRole("button", { name: "登录 B" }).click()
    await waitFor(() => expect(screen.getByTestId("scope").textContent).toBe("B"))

    expect(client.getQueryData(queryKeys.records.mine("A", { current: 1, pageSize: 10 }))).toBeUndefined()
    expect(client.getQueryData(queryKeys.profile.user("A"))).toBeUndefined()
    expect(client.getQueryData(queryKeys.admin.stats(30))).toBeUndefined()
    // B 自己的键是另一把钥匙：没有 B 的数据，不会凭空长出 A 的读数。
    expect(client.getQueryData(queryKeys.records.mine("B", { current: 1, pageSize: 10 }))).toBeUndefined()
  })

  it("旧账号的在途请求晚归，也不能写进缓存", async () => {
    renderSession()
    await screen.findByText("authed")

    // 不接 signal 的请求：即使不理会取消，它晚归时也只属于 A 的键。
    let settle: (value: unknown) => void = () => {}
    const inFlight = client
      .fetchQuery({
        queryKey: queryKeys.records.mine("A", { current: 1, pageSize: 10 }),
        queryFn: () =>
          new Promise((resolve) => {
            settle = resolve
          }),
      })
      .catch(() => undefined)

    screen.getByRole("button", { name: "登录 B" }).click()
    await waitFor(() => expect(screen.getByTestId("scope").textContent).toBe("B"))

    // 旧请求在身份切换之后才回来。
    settle({ records: [{ id: "late-a" }], total: 1 })
    await inFlight

    const late = client.getQueryData(queryKeys.records.mine("A", { current: 1, pageSize: 10 }))
    // 无论它是否落回 A 的键，B 读的那把钥匙上都不可能有 A 的数据。
    expect(client.getQueryData(queryKeys.records.mine("B", { current: 1, pageSize: 10 }))).toBeUndefined()
    expect(late).toBeUndefined()
  })

  it("会话失效（40100）同样清掉个人缓存", async () => {
    renderSession()
    await screen.findByText("authed")
    seedCaches()

    window.dispatchEvent(
      new CustomEvent(AUTH_EXPIRED_EVENT, { detail: { code: 40100 } }),
    )
    await waitFor(() => expect(screen.getByTestId("status").textContent).toBe("anon"))

    expect(client.getQueryData(queryKeys.records.mine("A", { current: 1, pageSize: 10 }))).toBeUndefined()
    expect(client.getQueryData(queryKeys.admin.stats(30))).toBeUndefined()
  })
})
