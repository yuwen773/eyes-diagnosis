import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { QueryClientProvider } from "@tanstack/react-query"

import "@fontsource/ibm-plex-mono/400.css"
import "@fontsource/ibm-plex-mono/500.css"
import "@fontsource/ibm-plex-mono/600.css"
import "@fontsource/instrument-serif/400.css"
// Iris 2.0 品牌/UI 主字体。unicode-range 分片，浏览器只下命中的子集（拉丁 ~25KB）。
import "@fontsource-variable/manrope"

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
