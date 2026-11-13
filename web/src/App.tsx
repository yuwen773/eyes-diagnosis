import { useEffect } from "react"
import { BrowserRouter, Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom"
import { ThemeProvider } from "@/components/theme-provider"
import { FaultProvider, FaultToaster } from "@/components/fault"
import { SessionProvider, useSession } from "@/lib/session"
import { AUTH_EXPIRED_EVENT } from "@/lib/api"
import { LandingPage } from "@/pages/LandingPage"
import { DiagnosisPage } from "@/pages/DiagnosisPage"
import { AgentPage } from "@/pages/AgentPage"
import { NewsPage } from "@/pages/NewsPage"
import { NewsDetailPage } from "@/pages/NewsDetailPage"
import { ProfilePage } from "@/pages/ProfilePage"
import { RecordsPage } from "@/pages/RecordsPage"
import { DoctorReviewsPage } from "@/pages/DoctorReviewsPage"
import { LoginPage } from "@/pages/LoginPage"
import { RegisterPage } from "@/pages/RegisterPage"
import { AdminGate } from "@/components/admin/AdminGate"
import { AdminLayout } from "@/components/admin/AdminLayout"
import { AdminDashboardPage } from "@/pages/admin/AdminDashboardPage"
import { AdminUsersPage } from "@/pages/admin/AdminUsersPage"
import { AdminNewsPage } from "@/pages/admin/AdminNewsPage"
import { AdminDiagnosisPage } from "@/pages/admin/AdminDiagnosisPage"
import { AdminKnowledgePage } from "@/pages/admin/AdminKnowledgePage"
import { AdminDataAnalysisPage } from "@/pages/admin/AdminDataAnalysisPage"
import { AdminNewsEditPage } from "@/pages/admin/AdminNewsEditPage"

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
        <Routes>
          <Route path="/" element={<LandingPage />} />
          <Route path="/diagnosis" element={<DiagnosisPage />} />
          <Route path="/agent" element={<AgentPage />} />
          <Route path="/news" element={<NewsPage />} />
          <Route path="/news/:id" element={<NewsDetailPage />} />
          <Route path="/profile" element={<ProfilePage />} />
          <Route path="/records" element={<RecordsPage />} />
          <Route path="/doctor-reviews" element={<DoctorReviewsPage />} />
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
        <FaultToaster />
        </FaultProvider>
        </SessionProvider>
      </ThemeProvider>
    </BrowserRouter>
  )
}

export default App
