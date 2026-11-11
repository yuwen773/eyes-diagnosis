import { lazy, Suspense, useEffect } from "react"
import { BrowserRouter, Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom"
import { ThemeProvider } from "@/components/theme-provider"
import { FaultProvider, FaultToaster } from "@/components/fault"
import { SessionProvider, useSession } from "@/lib/session"
import { AUTH_EXPIRED_EVENT } from "@/lib/api"
import { PageSkeleton } from "@/components/PageSkeleton"
import { LandingPage } from "@/pages/LandingPage"

// 首页保持同步：它是第一屏，分包只会多一次往返。其余路由按需下载——
// 管理端（含 Recharts）、Agent（含 CodeMirror 之外的视觉组件）与认证页
// 各自成块，别让没进后台的人先付这份体积。
const DiagnosisPage = lazy(() =>
  import("@/pages/DiagnosisPage").then((m) => ({ default: m.DiagnosisPage })),
)
const AgentPage = lazy(() =>
  import("@/pages/AgentPage").then((m) => ({ default: m.AgentPage })),
)
const NewsPage = lazy(() =>
  import("@/pages/NewsPage").then((m) => ({ default: m.NewsPage })),
)
const NewsDetailPage = lazy(() =>
  import("@/pages/NewsDetailPage").then((m) => ({ default: m.NewsDetailPage })),
)
const ProfilePage = lazy(() =>
  import("@/pages/ProfilePage").then((m) => ({ default: m.ProfilePage })),
)
const RecordsPage = lazy(() =>
  import("@/pages/RecordsPage").then((m) => ({ default: m.RecordsPage })),
)
const LoginPage = lazy(() =>
  import("@/pages/LoginPage").then((m) => ({ default: m.LoginPage })),
)
const RegisterPage = lazy(() =>
  import("@/pages/RegisterPage").then((m) => ({ default: m.RegisterPage })),
)
const AdminGate = lazy(() =>
  import("@/components/admin/AdminGate").then((m) => ({ default: m.AdminGate })),
)
const AdminLayout = lazy(() =>
  import("@/components/admin/AdminLayout").then((m) => ({ default: m.AdminLayout })),
)
const AdminDashboardPage = lazy(() =>
  import("@/pages/admin/AdminDashboardPage").then((m) => ({ default: m.AdminDashboardPage })),
)
const AdminUsersPage = lazy(() =>
  import("@/pages/admin/AdminUsersPage").then((m) => ({ default: m.AdminUsersPage })),
)
const AdminNewsPage = lazy(() =>
  import("@/pages/admin/AdminNewsPage").then((m) => ({ default: m.AdminNewsPage })),
)
const AdminDiagnosisPage = lazy(() =>
  import("@/pages/admin/AdminDiagnosisPage").then((m) => ({ default: m.AdminDiagnosisPage })),
)
const AdminKnowledgePage = lazy(() =>
  import("@/pages/admin/AdminKnowledgePage").then((m) => ({ default: m.AdminKnowledgePage })),
)
const AdminDataAnalysisPage = lazy(() =>
  import("@/pages/admin/AdminDataAnalysisPage").then((m) => ({ default: m.AdminDataAnalysisPage })),
)
const AdminNewsEditPage = lazy(() =>
  import("@/pages/admin/AdminNewsEditPage").then((m) => ({ default: m.AdminNewsEditPage })),
)

function ScrollToTop() {
  const { pathname, hash } = useLocation()

  useEffect(() => {
    if (hash) {
      const node = document.getElementById(hash.slice(1))
      if (node) {
        node.scrollIntoView({ behavior: "smooth", block: "start" })
        return
      }
    }
    window.scrollTo({ top: 0 })
  }, [pathname, hash])

  return null
}

/**
 * 任何业务接口报未登录时，把人送回登录页，并记住来路——
 * 登录成功后直接回到刚才要去的页面，而不是把人丢回首页。
 *
 * 40100 一律跳；40101 只在「本来就没登录」时跳——已登录却撞上 40101
 * 是访问了别人的会话，那是权限问题，不该把人送去登录页。
 */
export function AuthRedirect() {
  const navigate = useNavigate()
  const location = useLocation()
  const { status } = useSession()

  useEffect(() => {
    function onExpired(event: Event) {
      const code = (event as CustomEvent<{ code?: number }>).detail?.code
      if (code !== 40100 && !(code === 40101 && status === "anon")) return
      // 已经在登录/注册页就别再跳，否则会自己跟自己打转
      if (location.pathname === "/login" || location.pathname === "/register") return
      const back = `${location.pathname}${location.search}`
      navigate(`/login?redirect=${encodeURIComponent(back)}`, { replace: true })
    }
    window.addEventListener(AUTH_EXPIRED_EVENT, onExpired)
    return () => window.removeEventListener(AUTH_EXPIRED_EVENT, onExpired)
  }, [navigate, location, status])

  return null
}

export function App() {
  return (
    <BrowserRouter>
      <ThemeProvider>
        <SessionProvider>
        {/* 故障提示宿主：一处渲染，全站任何一次失败都从这儿浮出来。 */}
        <FaultProvider>
        <ScrollToTop />
        <AuthRedirect />
        <Suspense fallback={<PageSkeleton />}>
        <Routes>
          <Route path="/" element={<LandingPage />} />
          <Route path="/diagnosis" element={<DiagnosisPage />} />
          <Route path="/agent" element={<AgentPage />} />
          <Route path="/news" element={<NewsPage />} />
          <Route path="/news/:id" element={<NewsDetailPage />} />
          <Route path="/profile" element={<ProfilePage />} />
          <Route path="/records" element={<RecordsPage />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/register" element={<RegisterPage />} />

          <Route
            path="/admin"
            element={
              <AdminGate>
                <AdminLayout />
              </AdminGate>
            }
          >
            <Route index element={<Navigate to="/admin/dashboard" replace />} />
            <Route
              path="dashboard"
              element={<AdminDashboardPage />}
            />
            <Route
              path="users"
              element={<AdminUsersPage />}
            />
            <Route
              path="news"
              element={<AdminNewsPage />}
            />
            <Route
              path="diagnosis"
              element={<AdminDiagnosisPage />}
            />
            <Route
              path="knowledge"
              element={<AdminKnowledgePage />}
            />
            <Route
              path="data-analysis"
              element={<AdminDataAnalysisPage />}
            />
            <Route
              path="news/:id/edit"
              element={<AdminNewsEditPage />}
            />
          </Route>

          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
        </Suspense>
        <FaultToaster />
        </FaultProvider>
        </SessionProvider>
      </ThemeProvider>
    </BrowserRouter>
  )
}

export default App
