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
 * <p>名称恒在条外左侧（--fg-2）；放不下时按轴宽截断（完整名称与占比在
 * 「表」视图与 tooltip 里常驻）。数据端 4px 圆角、基线端方角（radius 只给右侧）。
 *
 * <p>饼图不用：类别多、名称长，排序横条比饼图更容易比大小，也更符合
 * 「白色仪器」的账目读法。
 */
/**
 * 轴标签的字号（px）：一个全角字约占一个字号宽，半角约 0.55 个。
 */
const AXIS_FONT_SIZE = 12.5

/** 名称折算成「全角字」的宽度。 */
function unitWidth(text: string): number {
  return [...text].reduce(
    (sum, ch) => sum + (ch.charCodeAt(0) <= 0xff ? 0.55 : 1),
    0,
  )
}

/**
 * 轴宽能放下多少「全角字」。
 *
 * <p>算的是<b>轴宽本身</b>能容下几个字，与名字自身长度无关：轴宽除以字号。
 * 之前那版拿「名字的长度」去除像素预算，量纲不对——名字越长算出的上限越小，
 * 于是一个 19 字的病种被砍到 6 字（明明放得下 9 个），而 9 字的反而不砍。
 *
 * <p>少算一个字，标签就会被 SVG 左边缘裁掉——被裁掉的是<b>字首</b>
 * （「年龄相关性黄斑变性」变成「龄相关性黄斑变…」），恰恰是最要命的位置。
 */
function fitUnits(nameWidth: number): number {
  const budget = nameWidth - 6 // 轴距与轴线留白
  return Math.max(3, Math.floor(budget / AXIS_FONT_SIZE))
}

/**
 * 按全角单位截断，超出部分用省略号收尾（省略号自己占一格）。
 */
function truncateByUnits(name: string, maxUnits: number): string {
  if (unitWidth(name) <= maxUnits) return name
  const limit = Math.max(1, maxUnits - 1)
  let used = 0
  let out = ""
  for (const ch of name) {
    const unit = ch.charCodeAt(0) <= 0xff ? 0.55 : 1
    if (used + unit > limit) return `${out}…`
    used += unit
    out += ch
  }
  return `${out}…`
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
                tickFormatter={(name: string) => truncateByUnits(name, fitUnits(nameWidth))}
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
