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
  const { status, scope, signIn, signOut, refresh } = useSession()
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
      <button type="button" onClick={() => void refresh()}>
        重新探测
      </button>
    </div>
  )
}

/** 手动控制的 Promise：用来制造「请求在途时又发生了别的事」。 */
function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
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

  it("换账号时先取消在途的个人查询：AbortSignal 真的被 abort", async () => {
    renderSession()
    await screen.findByText("authed")

    let seen: AbortSignal | undefined
    let settle: (value: unknown) => void = () => {}
    const inFlight = client
      .fetchQuery({
        queryKey: queryKeys.records.mine("A", { current: 1, pageSize: 10 }),
        queryFn: ({ signal }) => {
          seen = signal
          return new Promise((resolve) => {
            settle = resolve
          })
        },
      })
      .catch(() => undefined)

    await waitFor(() => expect(seen).toBeDefined())
    expect(seen?.aborted).toBe(false)

    screen.getByRole("button", { name: "登录 B" }).click()
    await waitFor(() => expect(screen.getByTestId("scope").textContent).toBe("B"))

    // 关键断言：请求方拿到的 signal 被真正 abort 了，而不是只把缓存删掉了事。
    expect(seen?.aborted).toBe(true)

    settle({ records: [{ id: "late-a" }], total: 1 })
    await inFlight

    expect(client.getQueryData(queryKeys.records.mine("A", { current: 1, pageSize: 10 }))).toBeUndefined()
  })

  it("公开资讯查询不会被身份切换取消", async () => {
    renderSession()
    await screen.findByText("authed")

    let signal: AbortSignal | undefined
    const inFlight = client
      .fetchQuery({
        queryKey: queryKeys.news.list(),
        queryFn: ({ signal: s }) => {
          signal = s
          return new Promise((resolve) => {
            setTimeout(() => resolve([{ id: "n1" }]), 0)
          })
        },
      })
      .catch(() => undefined)

    await waitFor(() => expect(signal).toBeDefined())

    screen.getByRole("button", { name: "登出" }).click()
    await waitFor(() => expect(screen.getByTestId("status").textContent).toBe("anon"))

    expect(signal?.aborted).toBe(false)
    await inFlight
    expect(client.getQueryData(queryKeys.news.list())).toEqual([{ id: "n1" }])
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

describe("身份更新的时序", () => {
  it("登录在途时，旧身份的探测晚归不会把身份改回去", async () => {
    const probe = deferred<typeof A>()
    vi.mocked(getLoginUser).mockReturnValueOnce(probe.promise)

    renderSession()
    // 挂载时的探测还挂着，先登录成 B。
    expect(screen.getByTestId("status").textContent).toBe("loading")

    screen.getByRole("button", { name: "登录 B" }).click()
    await waitFor(() => expect(screen.getByTestId("scope").textContent).toBe("B"))

    // 那次探测现在才带着 A 回来。
    probe.resolve(A)
    await waitFor(() => expect(screen.getByTestId("status").textContent).toBe("authed"))
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(screen.getByTestId("scope").textContent).toBe("B")
  })

  it("登出之后，晚归的探测不会把人重新登回去", async () => {
    renderSession()
    await screen.findByText("authed")
    seedCaches()

    const probe = deferred<typeof A>()
    vi.mocked(getLoginUser).mockReturnValueOnce(probe.promise)

    screen.getByRole("button", { name: "重新探测" }).click()
    screen.getByRole("button", { name: "登出" }).click()
    await waitFor(() => expect(screen.getByTestId("status").textContent).toBe("anon"))

    probe.resolve(A)
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(screen.getByTestId("status").textContent).toBe("anon")
    expect(screen.getByTestId("scope").textContent).toBe("anonymous")
    expect(client.getQueryData(queryKeys.records.mine("A", { current: 1, pageSize: 10 }))).toBeUndefined()
  })

  it("登录期间发出的探测读到旧身份，登录完成后也不会被它覆盖", async () => {
    renderSession()
    await screen.findByText("authed")

    // 登录挂起，期间又发了一次探测——它读到的是登录前的 A。
    const loginResult = deferred<typeof B>()
    vi.mocked(login).mockReturnValueOnce(loginResult.promise)
    const probe = deferred<typeof A>()
    vi.mocked(getLoginUser).mockReturnValueOnce(probe.promise)

    screen.getByRole("button", { name: "登录 B" }).click()
    screen.getByRole("button", { name: "重新探测" }).click()

    loginResult.resolve(B)
    await waitFor(() => expect(screen.getByTestId("scope").textContent).toBe("B"))

    // 探测在登录落地之后才回来，身份必须还是 B。
    probe.resolve(A)
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(screen.getByTestId("scope").textContent).toBe("B")
    expect(client.getQueryData(queryKeys.profile.user("A"))).toBeUndefined()
  })

  it("两次并发探测：先返回的旧结果不能压过后来发起的那次", async () => {
    renderSession()
    await screen.findByText("authed")

    const first = deferred<typeof A>()
    const second = deferred<typeof A>()
    vi.mocked(getLoginUser).mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)

    screen.getByRole("button", { name: "重新探测" }).click()
    screen.getByRole("button", { name: "重新探测" }).click()

    second.resolve(B)
    await waitFor(() => expect(screen.getByTestId("scope").textContent).toBe("B"))

    // 更早发起的那次现在才回来，带着 A。
    first.resolve(A)
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(screen.getByTestId("scope").textContent).toBe("B")
  })
})
