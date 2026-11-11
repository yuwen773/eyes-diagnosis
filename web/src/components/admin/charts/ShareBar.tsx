import type { ReactElement } from "react"
import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts"

import {
  ChartView,
  VIZ,
  VizTooltip,
  formatVizNumber,
  formatVizPercent,
  vizSeriesColor,
} from "./ChartFrame"

/**
 * 状态占比条（100% 分段条）。
 *
 * <p>复核状态这种「几个状态加��来 100%」的场景，比排序横条直观得多：
 * 横条要读者自己拿尺子比，分段条一眼看出「待复核占多大一块」。
 *
 * <p>颜色不是唯一信息载体：每一段都在下面的读数行里带文字标签 + 计数 + 占比。
 * 「待复核」用信号橙（当前要处理的重点），其余取分类色板——不再用同一墨色
 * 叠透明度，半透明段在暗底上会互相混成一种颜色。
 */
export type ShareRow = { name: string; value: number; share: number }

export function ShareBar(props: {
  rows: ShareRow[]
  ariaLabel: string
  /** 哪些状态用强调色（通常是「当前需要处理」的那一类） */
  accentNames?: string[]
}): ReactElement {
  const { rows, ariaLabel, accentNames = [] } = props
  const total = rows.reduce((sum, row) => sum + row.value, 0)

  // 单行堆叠：每段一个 dataKey（s0/s1…），名称另存一份给图例用。
  const data = [
    Object.fromEntries([
      ["__cat", "占比"],
      ...rows.map((row, index) => [`s${index}`, row.value]),
    ]),
  ]

  const colors = rows.map((row, index) => ({
    key: `s${index}`,
    name: row.name,
    value: row.value,
    share: row.share,
    fill: accentNames.includes(row.name) ? VIZ.accent : vizSeriesColor(index),
  }))

  return (
    <ChartView
      title={ariaLabel}
      ariaLabel={ariaLabel}
      labelHeader="状态"
      extraHeader="占比"
      rows={rows.map((row) => ({
        label: row.name,
        value: formatVizNumber(row.value),
        extra: formatVizPercent(row.share),
      }))}
      figure={
        <div className="admin-viz__chart">
          {total === 0 ? (
            <p className="admin-viz__empty">窗口内没有可统计的记录。</p>
          ) : (
            <>
              <ResponsiveContainer width="100%" height={40}>
                <BarChart
                  data={data}
                  layout="vertical"
                  margin={{ top: 0, right: 0, bottom: 0, left: 0 }}
                  barCategoryGap={0}
                >
                  <XAxis type="number" domain={[0, total]} hide />
                  <YAxis type="category" dataKey="__cat" hide />
                  <Tooltip
                    content={<VizTooltip unit="条" />}
                    cursor={{ fill: "var(--surface-2)", fillOpacity: 0.4 }}
                  />
                  {colors.map((segment) => (
                    <Bar
                      key={segment.key}
                      dataKey={segment.key}
                      name={segment.name}
                      stackId="share"
                      fill={segment.fill}
                      isAnimationActive={false}
                    />
                  ))}
                </BarChart>
              </ResponsiveContainer>
              <ul className="admin-viz__legend admin-viz__legend--rows">
                {colors.map((segment) => (
                  <li className="admin-viz__legend-item" key={segment.key}>
                    <span
                      className="admin-viz__swatch"
                      style={{ background: segment.fill }}
                    />
                    <span className="admin-viz__legend-name">{segment.name}</span>
                    <span className="admin-viz__legend-value num">
                      {formatVizNumber(segment.value)}
                    </span>
                    <span className="admin-viz__legend-share num">
                      {formatVizPercent(segment.share)}
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      }
    />
  )
}
