import type { ReactElement } from "react"

/**
 * 路由分包时的占位。
 *
 * 不做骨架屏动画（无 shimmer、无脉冲）：一块固定高度的空白 + 一行等宽读数，
 * 与「白色仪器」的语气一致，也避免 ASI 式的装饰感。min-height 兜住 CLS。
 */
export function PageSkeleton(): ReactElement {
  return (
    <div className="page-skeleton" role="status" aria-live="polite">
      <span className="page-skeleton__text num">载入中 · LOADING</span>
    </div>
  )
}
