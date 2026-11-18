import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { QueryClientProvider } from "@tanstack/react-query"

// 只引 latin 子集：等宽读数与衬线标题只承载拉丁字母与数字，CJK 由 Noto 子集
// 兜底。整包 400.css 会连带 cyrillic / greek / vietnamese 两套格式一起产出。
import "@fontsource/ibm-plex-mono/latin-400.css"
import "@fontsource/ibm-plex-mono/latin-500.css"
import "@fontsource/ibm-plex-mono/latin-600.css"
import "@fontsource/instrument-serif/latin-400.css"
// Iris 2.2 品牌点缀字体：Dancing Script（SIL OFL 1.1，Impallari Type）。
// 只引 latin-400：仅用于 wordmark 的拉丁品名，不承载正文，也不合成加粗。
import "@fontsource/dancing-script/latin-400.css"
// Iris 2.0 品牌/UI 主字体。unicode-range 分片，浏览器只下命中的子集（拉丁 ~25KB）。
import "@fontsource-variable/manrope"

// nprogress 基础样式先加载，app.css 里的 Iris 场景色覆盖写在它后面。
import "nprogress/nprogress.css"
import "./fonts-subset.css"
import "./index.css"
import App from "./App.tsx"
import { queryClient } from "./lib/queryClient"

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </StrictMode>,
)
