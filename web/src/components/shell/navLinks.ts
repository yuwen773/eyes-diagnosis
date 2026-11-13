/**
 * 跨产品的目的地。落地页自己的章节不在这里，章节链接放在页脚。
 *
 * 这份数据是产品外壳的单一真源：顶栏、移动抽屉、页脚都从这里取，
 * 不再各自抄一遍（R2.5，DESIGN.md §1.6）。
 */
export const NAV_LINKS = [
  { to: "/diagnosis", label: "判读", code: "01" },
  { to: "/agent", label: "诊断 Agent", code: "02" },
  { to: "/news", label: "新闻资讯", code: "03" },
] as const
