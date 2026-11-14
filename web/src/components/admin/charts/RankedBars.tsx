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

import type { Ranked } from "@/lib/adminDomain"
import {
  ChartView,
  VIZ,
  VIZ_AXIS_TICK,
  VizTooltip,
  formatVizNumber,
  formatVizPercent,
  vizSeriesColor,
} from "./ChartFrame"

/**
 * 排序横条（病种分布、状态分布）。
 *
 * <p>名称恒在条外左侧（--fg-2），长病种名截断到 11 字；完整名称与占比在
 * 「表」视图与 tooltip 里常驻。数据端 4px 圆角、基线端方角（radius 只给右侧）。
 *
 * <p>饼图不用：类别多、名称长，排序横条比饼图更容易比大小，也更符合
 * 「白色仪器」的账目读法。
 */
/**
 * 轴宽能放下多少「全角字」。
 *
 * <p>中文按 1 个全角、半角按 0.55 个全角估算，另留 16px 给省略号与轴距。
 * 少算一个字，标签就会被 SVG 左边缘裁掉——被裁掉的是<b>字首</b>
 * （「年龄相关性黄斑变性」变成「龄相关性黄斑变…」），恰恰是最要命的位置。
 */
function fitUnits(name: string, nameWidth: number): number {
  const budget = nameWidth - 16
  const units = [...name].reduce(
    (sum, ch) => sum + (ch.charCodeAt(0) <= 0xff ? 0.55 : 1),
    0,
  )
  return Math.max(3, Math.floor(budget / Math.max(units, 1)))
}

/**
 * 按全角单位截断，超出部分用省略号收尾。
 */
function truncateByUnits(name: string, maxUnits: number): string {
  let used = 0
  let out = ""
  for (const ch of name) {
    const unit = ch.charCodeAt(0) <= 0xff ? 0.55 : 1
    if (used + unit > maxUnits) return `${out}…`
    used += unit
    out += ch
  }
  return out
}

export function RankedBars(props: {
  rows: Ranked[]
  ariaLabel: string
  /** 数值列的单位后缀（如「条」） */
  unit?: string
  emptyText?: string
  /** 名称列宽度：容器窄时收窄，给条形让出空间 */
  nameWidth?: number
}): ReactElement {
  const { rows, ariaLabel, unit, emptyText, nameWidth = 140 } = props
  const leading = Math.max(0, ...rows.map((row) => row.value))
  const height = Math.max(rows.length * 34 + 12, 64)

  return (
    <ChartView
      title={ariaLabel}
      ariaLabel={ariaLabel}
      emptyText={emptyText}
      labelHeader="类别"
      extraHeader="占比"
      rows={rows.map((row) => ({
        label: row.name,
        value: formatVizNumber(row.value),
        extra: formatVizPercent(row.share),
      }))}
      figure={
        <div className="admin-viz__chart">
          <ResponsiveContainer width="100%" height={height}>
            <BarChart
              data={rows}
              layout="vertical"
              margin={{ top: 4, right: 64, bottom: 4, left: 0 }}
              barCategoryGap={12}
            >
              <CartesianGrid horizontal={false} stroke={VIZ.rule} />
              <XAxis
                type="number"
                domain={[0, leading]}
                tick={VIZ_AXIS_TICK}
                axisLine={{ stroke: VIZ.rule }}
                tickLine={false}
                allowDecimals={false}
              />
              <YAxis
                type="category"
                dataKey="name"
                width={nameWidth}
                tick={{ fill: "var(--fg-2)", fontSize: 12.5 }}
                axisLine={false}
                tickLine={false}
                tickFormatter={(name: string) => truncateByUnits(name, fitUnits(name, nameWidth))}
              />
              <Tooltip
                content={<VizTooltip unit={unit} />}
                cursor={{ fill: "var(--surface-2)", fillOpacity: 0.6 }}
              />
              <Bar
                dataKey="value"
                name={unit ?? "数量"}
                radius={[0, 4, 4, 0]}
                isAnimationActive={false}
              >
                {rows.map((row, index) => (
                  <Cell key={`${row.name}-${index}`} fill={vizSeriesColor(index)} />
                ))}
                <LabelList
                  dataKey="value"
                  position="right"
                  offset={8}
                  className="admin-viz__bar-value"
                  formatter={(label: unknown) => formatVizNumber(Number(label))}
                />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      }
    />
  )
}
