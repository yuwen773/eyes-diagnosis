import type { ReactElement, ReactNode } from "react"

import "@/styles/brand.css"

/**
 * Iris 2.0 品牌层的可复用视觉原语。
 *
 * <p>只在 `.iris2` 上下文里有意义：颜色一律消费 `--brand-*`，不碰
 * `--field / --ink / --signal`。临床页与记录页不引用这里的任何东西。
 */

/**
 * 品牌材质面板（DESIGN.md §2.1.1）。
 *
 * <p>五种材质共用一套结构，只换底色 / 描边 / 内侧高光 / 模糊强度：
 * <ul>
 *   <li>`layered` —— Hero 信息卡：最透、层次最多（`glass` 是它的旧名，保留兼容）</li>
 *   <li>`frosted` —— 悬浮导航：更实更稳，先保证可读</li>
 *   <li>`soft` —— 首页入口卡：清爽、细描边、有限模糊</li>
 *   <li>`solid` —— 承载大量文字的区域：不透明、不用模糊</li>
 * </ul>
 * 光学玻璃（`optical`）由 WebGL 渲染器画，不在这里。
 */
export type BrandPanelVariant = "layered" | "glass" | "frosted" | "soft" | "solid"

export function BrandPanel(props: {
  variant?: BrandPanelVariant
  as?: "div" | "article" | "section" | "aside"
  className?: string
  children: ReactNode
}): ReactElement {
  const { variant = "layered", as: Tag = "div", className, children } = props
  const classes = ["brand-panel", `brand-panel--${variant}`, className]
    .filter(Boolean)
    .join(" ")
  return <Tag className={classes}>{children}</Tag>
}

/**
 * 面板眉标：等宽、小号、大写、宽字距。
 *
 * <p>读数与元信息一律等宽（`--font-mono`），与正文分开。
 */
export function BrandKicker(props: {
  className?: string
  children: ReactNode
}): ReactElement {
  const classes = ["brand-kicker", props.className].filter(Boolean).join(" ")
  return <span className={classes}>{props.children}</span>
}
