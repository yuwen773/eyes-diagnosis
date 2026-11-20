import type { ReactElement } from "react"
import { Link } from "react-router-dom"

import type { Risk } from "@/lib/domain"

/**
 * KPI 读数块：小字标签 + 大号等宽读数 + 可选的纯展示 delta。
 *
 * <p>accent 为「首块强调」——左侧 2px 信号橙竖线，只做结构性强调，不标状态。
 *
 * <p>tone 为风险语义色（--risk-normal / attention / critical）。按设计规则，
 * 语义色必须同时给文字标签（toneLabel），颜色不是唯一信息载体。
 *
 * <p>action 给一条下钻入口：读数旁边直接给「去处理」，管理员不用自己去找
 * 哪个列表、点哪个筛选。
 */
export function StatTile(props: {
  label: string
  value: string
  delta?: string
  accent?: boolean
  tone?: Risk
  toneLabel?: string
  action?: { label: string; to: string }
}): ReactElement {
  const { label, value, delta, accent, tone, toneLabel, action } = props
  return (
    <div
      className={
        "admin-tile" +
        (accent ? " admin-tile--accent" : "") +
        (tone ? " admin-tile--risk" : "")
      }
      data-tone={tone}
    >
      <span className="admin-tile__label">{label}</span>
      <span className="admin-tile__value num">{value}</span>
      {tone && toneLabel ? (
        <span className="admin-tile__tone">
          <span className="risk" data-risk={tone}>
            {toneLabel}
          </span>
        </span>
      ) : null}
      {delta ? <span className="admin-tile__delta">{delta}</span> : null}
      {action ? (
        <Link className="admin-tile__action" to={action.to}>
          {action.label}
        </Link>
      ) : null}
    </div>
  )
}
