import { useEffect } from "react"
import { BrowserRouter, Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom"
import { ThemeProvider } from "@/components/theme-provider"
import { SessionProvider } from "@/lib/session"
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
 * 任何业务接口回 40100（未登录）时，把人送回登录页，并记住来路——
 * 登录成功后直接回到刚才要去的页面，而不是把人丢回首页。
 */
function AuthRedirect() {
  const navigate = useNavigate()
  const location = useLocation()

  useEffect(() => {
    function onExpired() {
      // 已经在登录/注册页就别再跳，否则会自己跟自己打转
      if (location.pathname === "/login" || location.pathname === "/register") return
      const back = `${location.pathname}${location.search}`
      navigate(`/login?redirect=${encodeURIComponent(back)}`, { replace: true })
    }
    window.addEventListener(AUTH_EXPIRED_EVENT, onExpired)
    return () => window.removeEventListener(AUTH_EXPIRED_EVENT, onExpired)
  }, [navigate, location])

  return null
}

export function App() {
  return (
    <BrowserRouter>
      <ThemeProvider>
        <SessionProvider>
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
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
        </SessionProvider>
      </ThemeProvider>
    </BrowserRouter>
  )
}

export default App
