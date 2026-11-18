/**
 * NProgress 的唯一接线点：全站顶部细进度条。
 *
 * 两类触发源共用一条进度条，所以这里做引用计数：
 * - 路由切换（lazy chunk 加载）由 App.tsx 的 useLocation 驱动；
 * - API 请求由 http.ts 的 request 驱动。
 * 并发请求时只有计数器归零才 done，避免一个先返回的请求把还在跑的另一个"抹掉"。
 *
 * 延迟启动（delayMs）：短暂请求不闪进度条，避免高频轮询时顶栏一直抖。
 */

import NProgress from "nprogress"

NProgress.configure({ showSpinner: false, trickleSpeed: 200, minimum: 0.08 })

let active = 0
let delayTimer: ReturnType<typeof setTimeout> | undefined

function begin(delayMs: number) {
  active += 1
  if (active === 1) {
    delayTimer = setTimeout(() => NProgress.start(), delayMs)
  }
}

function finish() {
  active = Math.max(0, active - 1)
  if (active > 0) return
  if (delayTimer !== undefined) {
    clearTimeout(delayTimer)
    delayTimer = undefined
    // 请求在延迟内就结束了：根本没启动过进度条，直接收尾。
    if (!NProgress.isStarted()) return
  }
  NProgress.done(true)
}

/** 路由切换：lazy chunk 通常 >200ms，立刻启动。 */
export function routeBegin() {
  begin(0)
}

export function routeEnd() {
  finish()
}

/** API 请求：250ms 内返回的不显示进度条。 */
export function apiBegin() {
  begin(250)
}

export function apiEnd() {
  finish()
}
