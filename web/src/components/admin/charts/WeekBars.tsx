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

import type { WeekdayBar } from "@/lib/chartData"
import {
  ChartView,
  VIZ,
  VIZ_AXIS_TICK,
  VizTooltip,
  formatVizNumber,
} from "./ChartFrame"

/**
 * 按星期分布柱图。
 *
 * <p>柱值是<b>该星期几的日均</b>（合计 ÷ 该星期几出现天数），不是窗口累计：
 * 30 天窗口里周一可能出现 5 次、周二只出现 4 次，累计值会把「多一天」
 * 画成「更活跃」。读数表同时给出合计与出现天数，读数不靠猜。
 *
 * <p>主读数仍是窗口合计与窗口日均，不是最后一根柱子的值。
 */
export function WeekBars(props: {
  bars: WeekdayBar[]
  title: string
  ariaLabel: string
  total: number
  /** 窗口日均 = 合计 ÷ 窗口天数 */
  average: number
  /** 统计窗口长度（天）：日均的口径要写清楚，否则「日均」会被读成别的意思 */
  windowDays: number
}): ReactElement {
  const { bars, title, ariaLabel, total, average, windowDays } = props
  const max = Math.max(0, ...bars.map((bar) => bar.average))
  const maxIndex = max > 0 ? bars.findIndex((bar) => bar.average === max) : -1

  return (
    <ChartView
      title={title}
      ariaLabel={ariaLabel}
      labelHeader="星期"
      extraHeader="合计 / 出现天数"
      headExtra={`合计 ${formatVizNumber(total)} · 日均 ${formatVizNumber(
        Number(average.toFixed(1)),
      )}（${windowDays} 天）`}
      rows={bars.map((bar) => ({
        label: bar.label,
        value: formatVizNumber(Number(bar.average.toFixed(1))),
        extra: `${formatVizNumber(bar.total)} · ${bar.occurrences} 天`,
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
                content={<VizTooltip unit="人/日" />}
                cursor={{ fill: "var(--surface-2)", fillOpacity: 0.6 }}
              />
              <Bar
                dataKey="average"
                name="日均新增"
                radius={[4, 4, 0, 0]}
                isAnimationActive={false}
              >
                {bars.map((bar, index) => (
                  <Cell
                    key={bar.label}
                    fill={index === maxIndex ? VIZ.accent : VIZ.mute}
                  />
                ))}
                <LabelList
                  dataKey="average"
                  position="top"
                  offset={6}
                  content={(props) => {
                    // 只给最高的那根柱标数：七根柱全是数字反而没人看，
                    // 其余的读数靠坐标轴、tooltip 与「表」视图的常驻读数。
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
                        {formatVizNumber(Number((entry.value ?? 0).toFixed(1)))}
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
