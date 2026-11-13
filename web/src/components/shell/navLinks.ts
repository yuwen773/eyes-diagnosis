import type { LucideIcon } from "lucide-react"
import { BotMessageSquare, Newspaper, ScanEye } from "lucide-react"

/**
 * 跨产品的目的地。落地页自己的章节不在这里，章节链接放在页脚。
 *
 * 这份数据是产品外壳的单一真源：顶栏、移动抽屉、页脚都从这里取，
 * 不再各自抄一遍（R2.5，DESIGN.md §1.6）。
 *
 * `icon` 是 lucide 图标组件，顶栏/抽屉渲染在条目文字前；
 * `aria-hidden` 由渲染方负责，读屏只读 label。
 */
export const NAV_LINKS = [
  { to: "/diagnosis", label: "判读", code: "01", icon: ScanEye },
  { to: "/agent", label: "诊断 Agent", code: "02", icon: BotMessageSquare },
  { to: "/news", label: "新闻资讯", code: "03", icon: Newspaper },
] as const satisfies ReadonlyArray<{ to: string; label: string; code: string; icon: LucideIcon }>
