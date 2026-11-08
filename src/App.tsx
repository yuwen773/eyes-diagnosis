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
import { LoginPage } from "@/pages/LoginPage"
import { RegisterPage } from "@/pages/RegisterPage"
import { PlaceholderPage } from "@/components/PlaceholderPage"
import { AdminGate } from "@/components/admin/AdminGate"
import { AdminLayout } from "@/components/admin/AdminLayout"
import { AdminDashboardPage } from "@/pages/admin/AdminDashboardPage"

/**
 * Task 3 临时占位。Task 6-12 的页面组件落地后，把对应 element 逐个换成
 * @/pages/admin/AdminXxxPage；占位期间路由与守卫仍可完整验收。
 * code 顺延现有占位页（个人中心 06 / 诊断记录 07）。
 */
function AdminPlaceholder({
  code,
  kicker,
  en,
  title,
  body,
}: {
  code: string
  kicker: string
  en: string
  title: string
  body: string
}) {
  return (
    <PlaceholderPage
      code={code}
      kicker={kicker}
      en={en}
      title={title}
      body={body}
      detail="管理端页面按批装配中；后端管理接口已就绪。"
    />
  )
}

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
              element={
                <AdminPlaceholder
                  code="07"
                  kicker="系统管理 · 用户管理"
                  en="ADMIN · USERS"
                  title="用户管理"
                  body="账号检索、角色标签与删除守卫。这个界面正在装配。"
                />
              }
            />
            <Route
              path="news"
              element={
                <AdminPlaceholder
                  code="08"
                  kicker="系统管理 · 新闻管理"
                  en="ADMIN · NEWS"
                  title="新闻管理"
                  body="新闻检索、发布与封面维护。这个界面正在装配。"
                />
              }
            />
            <Route
              path="diagnosis"
              element={
                <AdminPlaceholder
                  code="09"
                  kicker="系统管理 · 诊断管理"
                  en="ADMIN · DIAGNOSIS"
                  title="诊断管理"
                  body="判读记录检索、详情抽屉与人工复核。这个界面正在装配。"
                />
              }
            />
            <Route
              path="knowledge"
              element={
                <AdminPlaceholder
                  code="10"
                  kicker="系统管理 · 知识库"
                  en="ADMIN · KNOWLEDGE"
                  title="知识库"
                  body="文档上传、解析进度与分块状态。这个界面正在装配。"
                />
              }
            />
            <Route
              path="data-analysis"
              element={
                <AdminPlaceholder
                  code="11"
                  kicker="系统管理 · 数据分析"
                  en="ADMIN · DATA ANALYSIS"
                  title="数据分析"
                  body="小倍数趋势、活跃度柱图与疾病分布排序。这个界面正在装配。"
                />
              }
            />
            <Route
              path="news/:id/edit"
              element={
                <AdminPlaceholder
                  code="12"
                  kicker="系统管理 · 新闻编辑"
                  en="ADMIN · NEWS EDIT"
                  title="新闻编辑"
                  body="新闻正文、发布状态与封面的编辑界面。这个界面正在装配。"
                />
              }
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
