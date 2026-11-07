import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react"
import {
  ApiError,
  getLoginUser,
  login as loginApi,
  logout as logoutApi,
  type LoginUser,
} from "@/lib/api"

type SessionStatus = "loading" | "authed" | "anon"

type SessionValue = {
  user: LoginUser | null
  status: SessionStatus
  signIn: (account: string, password: string) => Promise<void>
  signOut: () => Promise<void>
  refresh: () => Promise<void>
}

const SessionContext = createContext<SessionValue | null>(null)

export function SessionProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<LoginUser | null>(null)
  const [status, setStatus] = useState<SessionStatus>("loading")

  const refresh = useCallback(async () => {
    try {
      const current = await getLoginUser()
      setUser(current ?? null)
      setStatus(current ? "authed" : "anon")
    } catch (error) {
      // 未登录时后端返回 40100，视为匿名，而不是错误。
      if (error instanceof ApiError) {
        setUser(null)
        setStatus("anon")
        return
      }
      throw error
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const signIn = useCallback(async (account: string, password: string) => {
    const current = await loginApi({ userAccount: account, userPassword: password })
    setUser(current ?? null)
    setStatus(current ? "authed" : "anon")
  }, [])

  const signOut = useCallback(async () => {
    await logoutApi()
    setUser(null)
    setStatus("anon")
  }, [])

  const value = useMemo(
    () => ({ user, status, signIn, signOut, refresh }),
    [user, status, signIn, signOut, refresh],
  )

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
}

export function useSession() {
  const value = useContext(SessionContext)
  if (!value) throw new Error("useSession must be used inside SessionProvider")
  return value
}
