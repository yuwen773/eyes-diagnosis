import type { ReactElement, ReactNode } from "react"

/** 一行工具条：children 原样渲染，底部一条 --hr 发丝线收口。 */
export function Toolbar(props: { children: ReactNode }): ReactElement {
  return <div className="admin-toolbar">{props.children}</div>
}
