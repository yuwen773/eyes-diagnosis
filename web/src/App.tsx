import { lazy, Suspense, useEffect, type ReactNode } from "react"
import { BrowserRouter, Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom"
import { ThemeProvider } from "@/components/theme-provider"
import { FaultProvider, FaultToaster } from "@/components/fault"
import { SessionProvider, useSession } from "@/lib/session"
import { AUTH_EXPIRED_EVENT } from "@/lib/api"
import { PageSkeleton } from "@/components/PageSkeleton"
import { RouteErrorBoundary } from "@/components/RouteErrorBoundary"
import { SkipLink } from "@/components/SkipLink"
import { NotFoundPage } from "@/components/system/IrisStates"
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
const CollaborationPage = lazy(() =>
  import("@/pages/CollaborationPage").then((m) => ({ default: m.CollaborationPage })),
)
const DoctorReviewsPage = lazy(() =>
  import("@/pages/DoctorReviewsPage").then((m) => ({ default: m.DoctorReviewsPage })),
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
const RecordDetailPage = lazy(() =>
  import("@/pages/RecordDetailPage").then((m) => ({ default: m.RecordDetailPage })),
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

/**
 * E-09 设计对照台：**只在开发期或显式打开 `VITE_DESIGN_PREVIEW=true` 的构建里注册**。
 * 正式生产构建两条都不满足，`/design/hero-compare` 会落到 404 路由，
 * 不会把设计选择器暴露给线上用户。
 */
const DESIGN_PREVIEW_ENABLED =
  import.meta.env.DEV || import.meta.env.VITE_DESIGN_PREVIEW === "true"

const DesignHeroComparePage = DESIGN_PREVIEW_ENABLED
  ? lazy(() =>
      import("@/pages/DesignHeroComparePage").then((m) => ({
        default: m.DesignHeroComparePage,
      })),
    )
  : null

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

/**
 * 把错误边界绑到当前路由上：换页自动复位，不会把上一页的崩溃状态带过去。
 */
function RouteBoundary({ children }: { children: ReactNode }) {
  const location = useLocation()
  return (
    <RouteErrorBoundary resetKey={`${location.pathname}${location.search}`}>
      {children}
    </RouteErrorBoundary>
  )
}

export function App() {
  return (
    <BrowserRouter>
      <ThemeProvider>
        <SessionProvider>
        {/* 故障提示宿主：一处渲染，全站任何一次失败都从这儿浮出来。 */}
        <FaultProvider>
        {/* 键盘第一站：跳过导航直达 <main>（各页面地标的 id 见 #main-content）。 */}
        <SkipLink />
        <ScrollToTop />
        <AuthRedirect />
        <Suspense fallback={<PageSkeleton />}>
        <RouteBoundary>
        <Routes>
          <Route path="/" element={<LandingPage />} />
          <Route path="/diagnosis" element={<DiagnosisPage />} />
          <Route path="/agent" element={<AgentPage />} />
          <Route path="/agent/collaboration" element={<CollaborationPage />} />
          <Route path="/doctor-reviews" element={<DoctorReviewsPage />} />
          <Route path="/news" element={<NewsPage />} />
          <Route path="/news/:id" element={<NewsDetailPage />} />
          <Route path="/profile" element={<ProfilePage />} />
          <Route path="/records" element={<RecordsPage />} />
          <Route path="/records/:id" element={<RecordDetailPage />} />
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

          <Route path="*" element={<NotFoundPage />} />
          {DesignHeroComparePage ? (
            <Route path="/design/hero-compare" element={<DesignHeroComparePage />} />
          ) : null}
        </Routes>
        </RouteBoundary>
        </Suspense>
        <FaultToaster />
        </FaultProvider>
        </SessionProvider>
      </ThemeProvider>
    </BrowserRouter>
  )
}

export default App
