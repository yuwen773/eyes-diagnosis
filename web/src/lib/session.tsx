import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react"
import { useQueryClient } from "@tanstack/react-query"
import {
  ApiError,
  AUTH_EXPIRED_EVENT,
  getLoginUser,
  login as loginApi,
  logout as logoutApi,
  type AuthExpiredDetail,
  type LoginUser,
} from "@/lib/api"
import { resetPrivateQueries } from "@/lib/queryClient"

type SessionStatus = "loading" | "authed" | "anon"

/**
 * 当前会话的缓存作用域。
 *
 * <p>个人查询键必须带上它（见 queryKeys.records / profile），这样换账号后
 * 新账号读的是另一个键，旧账号的缓存不会串过来。雪花 id 线上是字符串；
 * 极少数缺 id 的探测结果退回账号名，仍未署名的算匿名。
 */
export function sessionScope(user: LoginUser | null): string {
  return user?.id || user?.userAccount || "anonymous"
}

type SessionValue = {
  user: LoginUser | null
  status: SessionStatus
  /** 当前账号的查询作用域；个人查询键与缓存清空都以它为准。 */
  scope: string
  /**
   * 会话探测失败时的说明（服务不可用 / 网络不通）。
   * 非空表示「这一轮没验成」，不等于「你没登录」——两件事必须分开说。
   */
  probeError: string | null
  signIn: (account: string, password: string) => Promise<void>
  signOut: () => Promise<void>
  refresh: () => Promise<void>
}

const SessionContext = createContext<SessionValue | null>(null)

export function SessionProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient()
  const [user, setUser] = useState<LoginUser | null>(null)
  const [status, setStatus] = useState<SessionStatus>("loading")
  const [probeError, setProbeError] = useState<string | null>(null)
  /** 上一次确认的身份。null 表示这一轮还没确认过，不触发清缓存。 */
  const scopeRef = useRef<string | null>(null)
  /**
   * 身份操作的逻辑时钟。
   *
   * <p>`refresh()` 是一次网络往返，这期间用户完全可能已经登录、登出，或者会话被踢。
   * 如果谁先返回谁说了算，一个在 A 名下发出的探测晚归时就会把 B 的身份改回去，
   * 顺带把 B 的缓存按 A 的 scope 清掉。所以每次「会改身份」的操作都领一个序号：
   * 只有序号仍然是最新的那一次，才有权落地。
   */
  const epochRef = useRef(0)
  /** 探测请求自己的序号：并发发起的多次 refresh，只有最后一次算数。 */
  const probeRef = useRef(0)

  /**
   * 开始一次会改身份的操作（登录 / 登出 / 会话失效），返回它的序号。
   *
   * <p>同时在途的会话探测当场作废——它描述的是变更**之前**的身份。
   */
  const beginIdentityChange = useCallback(() => {
    const token = ++epochRef.current
    probeRef.current += 1
    return token
  }, [])

  /**
   * 采用一个新的会话身份。
   *
   * <p>身份变了就整域作废个人缓存：取消旧账号的在途请求，删掉 records /
   * profile / admin。先清除再落状态，避免新账号的页面在两次渲染之间读到旧数据。
   */
  const adopt = useCallback(
    (next: LoginUser | null) => {
      const nextScope = sessionScope(next)
      if (scopeRef.current !== null && scopeRef.current !== nextScope) {
        resetPrivateQueries(queryClient)
      }
      scopeRef.current = nextScope
      setUser(next)
      setStatus(next ? "authed" : "anon")
      setProbeError(null)
    },
    [queryClient],
  )

  const refresh = useCallback(async () => {
    const identity = epochRef.current
    const probe = ++probeRef.current
    /** 晚归的探测：期间身份变过，或者又发起了更新的探测 → 这次的结果作废。 */
    const stale = () => identity !== epochRef.current || probe !== probeRef.current

    try {
      const current = await getLoginUser()
      if (stale()) return
      adopt(current ?? null)
    } catch (error) {
      if (stale()) return
      // 只有「未登录 / 无权限」才算匿名。5xx、网关返回的 HTML 错误页都不是——
      // 把它们读成匿名，等于网络抖一下就把人静默登出。
      if (error instanceof ApiError && (error.code === 40100 || error.code === 40101)) {
        adopt(null)
        return
      }
      // 探测失败 ≠ 没登录。已经认出来的会话保留着，只是这一轮没验成；
      // 从没登录过就落到匿名。两种情况都给出可重试的说明。
      //
      // 关键：status 必须离开 loading。refresh 的 rejection 在挂载时没人接，
      // 停在 loading 会让「正在核对访问权限」永远转下去。
      setStatus((prev) => (prev === "authed" ? "authed" : "anon"))
      setProbeError("服务这会儿没有响应，登录状态没验成")
    }
  }, [adopt])

  useEffect(() => {
    // refresh 的首个操作是 await 网络请求，状态更新不在 effect 同步阶段。
    void (async () => {
      await refresh()
    })()
  }, [refresh])

  // 会话失效（40100）时本地也立刻退出：否则页面还挂着「已登录」，个人缓存
  // 会继续留在内存里。40101 只代表权限不足，不清会话。
  useEffect(() => {
    const onExpired = (event: Event) => {
      const code = (event as CustomEvent<AuthExpiredDetail>).detail?.code
      if (code !== 40100) return
      beginIdentityChange()
      adopt(null)
    }
    window.addEventListener(AUTH_EXPIRED_EVENT, onExpired)
    return () => window.removeEventListener(AUTH_EXPIRED_EVENT, onExpired)
  }, [adopt, beginIdentityChange])

  const signIn = useCallback(
    async (account: string, password: string) => {
      const token = beginIdentityChange()
      const current = await loginApi({ userAccount: account, userPassword: password })
      // 登录这一趟里又有人登录/登出/会话失效 → 这次的答案已经过期。
      if (token !== epochRef.current) return
      // 登录期间可能又发起了会话探测，它读到的是登录**之前**的身份；
      // 再推一格，把这些探测一并作废，再落地新身份。
      beginIdentityChange()
      adopt(current ?? null)
    },
    [adopt, beginIdentityChange],
  )

  const signOut = useCallback(async () => {
    const token = beginIdentityChange()
    // 先清本地：登出请求本身也要时间，不能让它成为旧账号数据继续可见的窗口。
    // 登出失败时不改登录态——服务端会话还在，谎称已退出反而更糟。
    resetPrivateQueries(queryClient)
    await logoutApi()
    if (token !== epochRef.current) return
    beginIdentityChange()
    adopt(null)
  }, [adopt, beginIdentityChange, queryClient])

  const value = useMemo(
    () => ({
      user,
      status,
      scope: sessionScope(user),
      probeError,
      signIn,
      signOut,
      refresh,
    }),
    [user, status, probeError, signIn, signOut, refresh],
  )

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
}

export function useSession() {
  const value = useContext(SessionContext)
  if (!value) throw new Error("useSession must be used inside SessionProvider")
  return value
}
