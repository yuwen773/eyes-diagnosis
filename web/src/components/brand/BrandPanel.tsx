import type { ReactElement, ReactNode } from "react"

import "@/styles/brand.css"

/**
 * Iris 2.0 品牌层的可复用视觉原语。
 *
 * <p>只在 `.iris2` 上下文里有意义：颜色一律消费 `--brand-*`，不碰
 * `--field / --ink / --signal`。临床页与记录页不引用这里的任何东西。
 */

/**
 * 轻质信息面板。
 *
 * <p>两种形态：`glass`（半透明 + 背景模糊，用于浮在光学主视觉之上的卡片）、
 * `solid`（不透明，用于需要高可读性的内容块）。两者都带发丝描边与
 * 基于品牌色的极淡投影——层级靠描边与留白，不靠厚重阴影。
 */
export function BrandPanel(props: {
  variant?: "glass" | "solid"
  as?: "div" | "article" | "section" | "aside"
  className?: string
  children: ReactNode
}): ReactElement {
  const { variant = "glass", as: Tag = "div", className, children } = props
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
