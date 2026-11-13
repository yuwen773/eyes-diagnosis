import type { ReactElement } from "react"

/**
 * KPI 读数块：小字标签 + 大号等宽读数 + 可选的纯展示 delta。
 * accent 为「首块强调」——左侧 2px 信号橙竖线，只做结构性强调，不标状态。
 */
export function StatTile(props: {
  label: string
  value: string
  delta?: string
  accent?: boolean
}): ReactElement {
  const { label, value, delta, accent } = props
  return (
    <div className={"admin-tile" + (accent ? " admin-tile--accent" : "")}>
      <span className="admin-tile__label">{label}</span>
      <span className="admin-tile__value num">{value}</span>
      {delta ? <span className="admin-tile__delta">{delta}</span> : null}
    </div>
  )
}
