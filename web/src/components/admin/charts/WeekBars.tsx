import type { ReactElement } from "react"
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts"

import {
  ChartView,
  VIZ,
  VIZ_AXIS_TICK,
  VizTooltip,
  formatVizNumber,
} from "./ChartFrame"

/**
 * 按星期分布柱图（带坐标轴标签）。
 *
 * <p>主读数是<b>窗口内合计</b>与<b>日均</b>，不是最后一根柱子的值——
 * 最后一格只是周日的量，把它摆在最显眼的位置会被读成总数。
 */
export function WeekBars(props: {
  bars: { label: string; value: number }[]
  title: string
  ariaLabel: string
  total: number
  average: number
  /** 统计窗口长度（天）：日均的口径要写清楚，否则「日均」会被读成别的意思 */
  windowDays: number
}): ReactElement {
  const { bars, title, ariaLabel, total, average, windowDays } = props
  const max = Math.max(0, ...bars.map((bar) => bar.value))
  const maxIndex = max > 0 ? bars.findIndex((bar) => bar.value === max) : -1

  return (
    <ChartView
      title={title}
      ariaLabel={ariaLabel}
      labelHeader="星期"
      headExtra={`合计 ${formatVizNumber(total)} · 日均 ${formatVizNumber(
        Number(average.toFixed(1)),
      )}（${windowDays} 天）`}
      rows={bars.map((bar) => ({
        label: bar.label,
        value: formatVizNumber(bar.value),
      }))}
      figure={
        <div className="admin-viz__chart">
          <ResponsiveContainer width="100%" height={220}>
            <BarChart
              data={bars}
              margin={{ top: 16, right: 8, bottom: 4, left: 0 }}
              barCategoryGap={10}
            >
              <CartesianGrid stroke={VIZ.rule} vertical={false} />
              <XAxis
                dataKey="label"
                tick={VIZ_AXIS_TICK}
                axisLine={{ stroke: VIZ.rule }}
                tickLine={false}
              />
              <YAxis
                tick={VIZ_AXIS_TICK}
                axisLine={false}
                tickLine={false}
                width={36}
                allowDecimals={false}
              />
              <Tooltip
                content={<VizTooltip unit="人" />}
                cursor={{ fill: "var(--surface-2)", fillOpacity: 0.6 }}
              />
              <Bar dataKey="value" name="新增注册" radius={[4, 4, 0, 0]} isAnimationActive={false}>
                {bars.map((bar, index) => (
                  <Cell
                    key={bar.label}
                    fill={index === maxIndex ? VIZ.accent : VIZ.mute}
                  />
                ))}
                <LabelList
                  dataKey="value"
                  position="top"
                  offset={6}
                  content={(props) => {
                    // 只给最高的那根柱标数：七根柱全是数字反而没人看，
                    // 其余的读数靠坐标轴与 tooltip，以及「表」视图的常驻读数。
                    const entry = props as unknown as {
                      index?: number
                      value?: number
                      x?: number
                      y?: number
                    }
                    if (entry.index !== maxIndex) return null
                    return (
                      <text
                        x={entry.x ?? 0}
                        y={(entry.y ?? 0) - 6}
                        textAnchor="middle"
                        className="admin-viz__bar-value"
                      >
                        {formatVizNumber(entry.value ?? 0)}
                      </text>
                    )
                  }}
                />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      }
    />
  )
}
