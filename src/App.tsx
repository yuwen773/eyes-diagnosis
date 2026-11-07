import { useEffect } from "react"
import { BrowserRouter, Navigate, Route, Routes, useLocation } from "react-router-dom"
import { SessionProvider } from "@/lib/session"
import { LandingPage } from "@/pages/LandingPage"
import { DiagnosisPage } from "@/pages/DiagnosisPage"
import { AgentPage } from "@/pages/AgentPage"
import { NewsPage } from "@/pages/NewsPage"
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

export function App() {
  return (
    <BrowserRouter>
      <SessionProvider>
        <ScrollToTop />
        <Routes>
          <Route path="/" element={<LandingPage />} />
          <Route path="/diagnosis" element={<DiagnosisPage />} />
          <Route path="/agent" element={<AgentPage />} />
          <Route path="/news" element={<NewsPage />} />
          <Route path="/profile" element={<ProfilePage />} />
          <Route path="/records" element={<RecordsPage />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/register" element={<RegisterPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </SessionProvider>
    </BrowserRouter>
  )
}

export default App
