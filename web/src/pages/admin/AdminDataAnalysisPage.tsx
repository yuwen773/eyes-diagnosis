import { useMemo, useState, type ReactElement } from "react"
import { Link } from "react-router-dom"
import { useQuery } from "@tanstack/react-query"
import { ArrowUpRight, ChartColumn } from "lucide-react"

import "@/styles/admin-polish-analysis.css"

import { AdminPageHead } from "@/components/admin/AdminPageHead"
import { InsightEmpty } from "@/components/admin/InsightEmpty"
import { MetricCell } from "@/components/admin/MetricCell"
import { SmallMultipleTrend } from "@/components/admin/charts/SmallMultipleTrend"
import { TrendAreaChart } from "@/components/admin/charts/TrendAreaChart"
import { WeekBars } from "@/components/admin/charts/WeekBars"
import { ShareBar } from "@/components/admin/charts/ShareBar"
import { RankedBars } from "@/components/admin/charts/RankedBars"
import { FaultNote } from "@/components/fault"
import { getAdminStats } from "@/lib/adminApi"
import {
  formatStatNumber,
  formatStatPercent,
  humanReviewStatusLabel,
  knowledgeStatusView,
  newsStatusView,
  rankDistribution,
} from "@/lib/adminDomain"
import { alignPreviousWindow, changeLabel, sharedDomainMax, weekdayBreakdown } from "@/lib/chartData"
import { canonicalClassName, classCode, confidencePercent } from "@/lib/domain"
import { describeError } from "@/lib/api"
import { queryKeys } from "@/lib/queryKeys"
import { fault } from "@/lib/faults"

/** 时间窗选项（天）。 */
const RANGES = [
  { value: 7, label: "近 7 天" },
  { value: 30, label: "近 30 天" },
  { value: 90, label: "近 90 天" },
]

/** 小倍数最多画几条病种：再多就成了一团面条，身份读不出来。 */
const MAX_DISEASE_SERIES = 6

/** 待人工复核在状态分布里的名字（用于给占比条上强调色）。 */
const AWAITING_REVIEW_LABEL = humanReviewStatusLabel("AWAITING_REVIEW")

/**
 * 运营底盘里的状态读数表。
 *
 * <p>辅助运营指标（知识库文档状态、资讯发布状态）只有两三个档位，
 * 给它们一张 100% 占比条会让「一条已完成」变成一整块抢眼的色块——
 * 密度与分量都配不上「辅助」二字。这里用「名称 + 细条 + 计数 + 占比」
 * 的读数表：数字是主读数，细条只是扫读的第二通道。
 */
function StatusList(props: {
  title: string
  rows: { name: string; value: number; share: number }[]
  unit: string
}): ReactElement {
  return (
    <div className="admin-analysis__status">
      <p className="admin-analysis__status-title">{props.title}</p>
      <ul className="admin-analysis__status-list">
        {props.rows.map((row) => (
          <li key={row.name}>
            <span className="admin-analysis__status-name">{row.name}</span>
            <span className="admin-analysis__status-track" aria-hidden="true">
              <span style={{ width: `${Math.max(row.share * 100, row.value > 0 ? 3 : 0)}%` }} />
            </span>
            <span className="admin-analysis__status-value num">
              {formatStatNumber(row.value)}
              <i>{props.unit}</i>
            </span>
            <span className="admin-analysis__status-share num">
              {formatStatPercent(row.share)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}

/**
 * 数据分析（真实统计 · 分析工作台）。
 *
 * <p>与仪表盘同一份口径（同一个后端端点 `GET /stats/admin/overview`），
 * 只是把窗口拉长、维度拆细：时间范围切换真的会重新取数，不是装饰。
 *
 * <p>构图按信息量分三层，读者从上往下就是从「发生了什么」到「构成是什么」
 * 再到「运营底盘怎么样」：
 * <ol>
 *   <li><b>主要趋势</b>：判读趋势（本期 vs 上一等长窗口）+ 窗口重点卡；</li>
 *   <li><b>次级分布</b>：病种分布、复核状态分布；</li>
 *   <li><b>次级趋势</b>：病种日趋势小倍数（统一纵轴）、新增用户按星期；</li>
 *   <li><b>辅助运营</b>：知识库与资讯的发布/处理状态。</li>
 * </ol>
 *
 * <p>两条口径上的硬规矩：
 * <ul>
 *   <li>病种小倍数共用同一个 Y 上限——各画各的归一化会让「日增 2 条」和
 *       「日增 200 条」看起来一样高；</li>
 *   <li>按星期分布的主读数是窗口内合计与日均，不是周日那一格的值。</li>
 * </ul>
 *
 * <p>病种名一律走 `canonicalClassName` 归一：后端给的是算法侧的英文原始标签
 * （`cataract` / `diabetes`…），页面上出现的一律是规范中文名，认不出的原样显示。
 */
export function AdminDataAnalysisPage(): ReactElement {
  const [days, setDays] = useState<number>(30)

  const statsQuery = useQuery({
    queryKey: queryKeys.admin.stats(days),
    queryFn: () => getAdminStats(days),
    // 切窗必须立刻失效：不同窗口是不同的查询键；gcTime 0 让离开的窗口马上被回收。
    gcTime: 0,
    staleTime: 0,
  })

  // 第二道守卫：后端回显的窗口天数与选中值不一致时，当作还没读到。
  const stats = statsQuery.data?.days === days ? statsQuery.data : undefined
  const statsFault = statsQuery.error ? describeError(statsQuery.error) : null
  const statsLoading = !stats && !statsFault

  const changeDays = (next: number) => {
    if (next !== days) setDays(next)
  }

  /**
   * 病种日趋势：后端给的是「一天 + 病种 + 计数」的扁平行，这里按病种折成
   * 一条条与 trendDays 对齐的序列（缺的那天补 0——不补会把「周三没数据」
   * 画成和周二一样多）。
   *
   * <p>病种名先归一再分组：同一类的不同写法（`cataract` / `白内障`）必须
   * 落进同一条线，否则一条病种会被拆成两条半截的线。
   */
  const diseaseSeries = useMemo(() => {
    const trendDays = stats?.trendDays ?? []
    const rows = stats?.diagnosisTrendByResult ?? []
    const totals = new Map<string, number>()
    const byName = new Map<string, Map<string, number>>()
    for (const row of rows) {
      const name = canonicalClassName(row.name) ?? row.name
      totals.set(name, (totals.get(name) ?? 0) + row.value)
      const series = byName.get(name) ?? new Map<string, number>()
      series.set(row.day, (series.get(row.day) ?? 0) + row.value)
      byName.set(name, series)
    }
    const names = [...totals.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, MAX_DISEASE_SERIES)
      .map(([name]) => name)
    return names.map((name) => ({
      name,
      total: totals.get(name) ?? 0,
      points: trendDays.map((day) => byName.get(name)?.get(day) ?? 0),
    }))
  }, [stats])

  /** 小倍数的统一 Y 上限：所有病种共用，跨病种才可比。 */
  const domainMax = useMemo(
    () => sharedDomainMax(diseaseSeries.map((series) => series.points)),
    [diseaseSeries],
  )

  /** 病种分布：同样先归一再排序——分布图与趋势图必须说的是同一批名字。 */
  const distribution = useMemo(() => {
    const merged = new Map<string, number>()
    for (const row of stats?.diagnosisDistribution ?? []) {
      const name = canonicalClassName(row.name) ?? row.name
      merged.set(name, (merged.get(name) ?? 0) + row.value)
    }
    return rankDistribution([...merged].map(([name, value]) => ({ name, value })))
  }, [stats])

  /** 复核状态分布：后端给的是状态代码，这里换成中文标签再排序。 */
  const reviewDistribution = rankDistribution(
    (stats?.reviewDistribution ?? []).map((row) => ({
      name: humanReviewStatusLabel(row.name),
      value: row.value,
    })),
  )

  /** 重点卡里的复核状态构成：按数量降序取前四档（「谁还没处理」的分法）。 */
  const breakdownRows = reviewDistribution.slice(0, 4)

  /** 知识库状态分布（0 处理中 / 1 已完成 / 2 失败）。 */
  const knowledgeDistribution = rankDistribution(
    (stats?.knowledgeByStatus ?? []).map((row) => ({
      name: knowledgeStatusView(Number(row.name)).label,
      value: row.value,
    })),
  )

  /** 资讯发布状态分布（0 草稿 / 1 已发布 / 2 下架 / 3 待审核）。 */
  const newsDistribution = rankDistribution(
    (stats?.newsByStatus ?? []).map((row) => ({
      name: newsStatusView(Number(row.name)).label,
      value: row.value,
    })),
  )

  /** 新增用户的按周分布：合计与日均才是主读数。 */
  const weekly = useMemo(
    () => weekdayBreakdown(stats?.userTrend ?? [], stats?.days ?? days),
    [stats, days],
  )

  const awaitingTotal = stats?.diagnosisAwaitingReviewTotal ?? 0
  const awaitingInRange = stats?.diagnosisAwaitingReview ?? 0
  const aiRejected = stats?.diagnosisAiRejected ?? 0
  const inRange = stats?.diagnosisInRange ?? 0
  const reviewed = stats?.diagnosisReviewed ?? 0

  /** 读数：统计还没回来时给破折号，不给 0。 */
  const read = (value: number | undefined): string =>
    stats ? formatStatNumber(value ?? 0) : "—"

  /** 窗口内没有判读时，这一页要变成解释面板，而不是一排空白图表。 */
  const noDiagnosis = stats ? stats.diagnosisInRange === 0 : false

  const trendRows = useMemo(
    () =>
      alignPreviousWindow(
        stats?.trendDays ?? [],
        stats?.diagnosisTrend ?? [],
        stats?.previousDiagnosisTrend ?? [],
      ),
    [stats],
  )

  /* ── 面板块（两种布局复用同一批内容）────────────────────────── */

  const trendBlock = (
    <TrendAreaChart data={trendRows} ariaLabel="判读趋势" height={288} />
  )

  /** 窗口重点卡：这一页唯一需要「动手」的地方（积压与拒识）。 */
  const focusCard = (
    <section
      className={`feature-card span-4${awaitingTotal > 0 || aiRejected > 0 ? "" : " feature-card--calm"}`}
      aria-label="窗口重点"
    >
      <div className="feature-card__top">
        <span className="feature-card__kicker">
          {awaitingTotal > 0 ? "待人工复核 · 积压" : "待人工复核 · 已清空"}
        </span>
        <span className="feature-card__value num">{read(awaitingTotal)}</span>
        <span className="feature-card__label">
          {!stats
            ? "统计读数尚未返回，积压数暂不可判读。"
            : awaitingTotal > 0
              ? `窗口内新增 ${formatStatNumber(awaitingInRange)} 条判读等待人工复核；` +
                `同期有 ${formatStatNumber(aiRejected)} 条被模型拒识。` +
                "积压需要人工复核才能进入正式记录。"
              : aiRejected > 0
                ? "窗口内没有等待人工复核的判读；" +
                  `同期有 ${formatStatNumber(aiRejected)} 条被模型拒识，需要人工过目。`
                : "窗口内没有等待人工复核的判读，也没有被模型拒识的记录。"}
        </span>
      </div>
      {/* 复核状态构成。注意口径：下面这组是「窗口内全部判读」的复核状态构成
          （合计等于窗口内判读数），不是上面那个积压数的分解——积压只是其中
          一项。标题写清楚范围，否则读者会以为这四行加起来等于积压数。 */}
      {breakdownRows.length > 0 ? (
        <p className="admin-analysis__breakdown-title num">
          窗口内 {formatStatNumber(inRange)} 条判读的复核状态
        </p>
      ) : null}
      <ul className="feature-card__breakdown">
        {breakdownRows.map((row) => (
          <li key={row.name}>
            <span className="feature-card__breakdown-name">{row.name}</span>
            <span className="feature-card__breakdown-value num">{formatStatNumber(row.value)}</span>
          </li>
        ))}
      </ul>
      <div className="feature-card__bottom">
        <div className="feature-card__foot">
          <Link className="feature-card__cta" to="/admin/diagnosis?review=requiresReview">
            去复核
            <ArrowUpRight size={14} strokeWidth={2} aria-hidden="true" />
          </Link>
          <span className="feature-card__sub num">
            {stats ? `窗口内新增 ${formatStatNumber(awaitingInRange)} 条` : "—"}
          </span>
        </div>
        <dl className="feature-card__stats">
          <div>
            <dt>AI 拒识</dt>
            <dd className="num">{read(aiRejected)}</dd>
          </div>
          <div>
            <dt>已复核</dt>
            <dd className="num">{read(reviewed)}</dd>
          </div>
        </dl>
      </div>
    </section>
  )

  /** 病种日趋势：统一纵轴的小倍数，读数给窗口内合计而不是末值。 */
  const diseaseTrendBlock = (
    <section className="admin-viz admin-analysis__trend" aria-label="病种日趋势">
      <div className="admin-viz__head">
        <span className="admin-viz__title">病种日趋势</span>
        <span className="admin-viz__head-extra num">
          统一纵轴上限 {formatStatNumber(domainMax)} 条 · 跨病种可比
        </span>
      </div>
      <div className="admin-viz__body admin-viz__body--flush">
        <div className="admin-analysis__grid admin-analysis__grid--trend">
          {diseaseSeries.map((series, index) => (
            <SmallMultipleTrend
              key={series.name}
              title={series.name}
              code={classCode(series.name)}
              points={series.points}
              domainMax={domainMax}
              total={series.total}
              windowDays={stats?.days ?? days}
              colorIndex={index}
            />
          ))}
        </div>
      </div>
    </section>
  )

  const weekBlock = (
    <WeekBars
      bars={weekly.bars}
      title="新增注册 · 按星期（日均）"
      ariaLabel="新增用户按星期分布"
      total={weekly.total}
      average={weekly.average}
      windowDays={stats?.days ?? days}
      height={186}
    />
  )

  /* ── 空窗口时的解释面板：说清「为什么空」与「上一窗口有多少」。──────── */

  const emptyInsight = (
    <InsightEmpty
      title="判读趋势与分布"
      note={`近 ${days} 天`}
      icon={ChartColumn}
      emptyTitle="窗口内还没有可统计的判读"
      description={
        stats?.previousDiagnosisInRange
          ? `上一等长窗口有 ${formatStatNumber(stats.previousDiagnosisInRange)} 条判读。` +
            "趋势、病种分布与复核状态要等窗口内出现判读才会成图——把时间窗拉长，或到诊断管理查看全量。"
          : "上一等长窗口同样没有记录。趋势、病种分布与复核状态要等窗口内出现判读才会成图——" +
            "把时间窗拉长，或到诊断管理查看全量。"
      }
      action={
        <Link className="action-row__link" to="/admin/diagnosis">
          打开诊断管理
        </Link>
      }
    />
  )

  return (
    <div className="admin-analysis">
      <AdminPageHead
        code="06"
        title="数据分析"
        eyebrow="ADMIN · DATA ANALYSIS"
        description="与仪表盘同一份统计口径，把时间窗拉长、维度拆细。切换时间窗会重新取数，而不是只改显示。"
        meta={
          stats ? (
            <span className="admin-sample num">
              {stats.rangeStart} ~ {stats.rangeEnd} · 近 {stats.days} 天
            </span>
          ) : null
        }
        actions={
          <div className="admin-range" role="group" aria-label="时间范围">
            {RANGES.map((range) => (
              <button
                key={range.value}
                type="button"
                className="admin-range__btn"
                aria-pressed={days === range.value}
                onClick={() => changeDays(range.value)}
              >
                {range.label}
              </button>
            ))}
          </div>
        }
      />

      {statsFault ? (
        <FaultNote
          className="admin-analysis__fault"
          fault={fault({
            severity: "attention",
            kind: "client",
            title: statsFault.text,
            code: statsFault.code,
          })}
        />
      ) : null}

      {statsLoading ? (
        <p className="admin-dashboard__loading num">统计载入中…</p>
      ) : (
        <>
          <section className="admin-metric-strip" aria-label="关键指标">
            <MetricCell
              label="窗口内判读"
              value={read(inRange)}
              primary
              foot={
                <span className="admin-metric-card__delta">
                  {stats ? changeLabel(inRange, stats.previousDiagnosisInRange) : "—"}
                </span>
              }
            />
            <MetricCell
              label="涉及病种"
              value={read(distribution.length)}
              foot={
                <span className="admin-metric-card__delta">
                  {distribution.length > 0
                    ? `最多 ${distribution[0].name} ${formatStatNumber(distribution[0].value)} 条`
                    : "窗口内没有判读"}
                </span>
              }
            />
            <MetricCell
              label="平均置信度"
              value={stats ? confidencePercent(stats.avgConfidence) : "—"}
              foot={
                <span className="admin-metric-card__delta">模型自评均值 · 非诊断准确率</span>
              }
            />
            <MetricCell
              label="待人工复核"
              value={read(awaitingTotal)}
              foot={
                <>
                  <span
                    className="admin-chip"
                    data-tone={stats ? (awaitingTotal > 0 ? "attention" : "normal") : "mute"}
                  >
                    {stats ? (awaitingTotal > 0 ? "待处理" : "已清空") : "读取中"}
                  </span>
                  <Link className="action-row__link" to="/admin/diagnosis?review=requiresReview">
                    去复核
                  </Link>
                </>
              }
            />
          </section>

          <div className="admin-bento">
            {noDiagnosis ? (
              <>
                {/* 空窗口：解释卡占主位，重点卡收在右侧——两支都还活着，
                    只是这一段时间没有判读。别在这里再摆一张图卡：
                    下面「辅助运营」那一行已经有一张按星期柱图了。 */}
                <div className="span-8">{emptyInsight}</div>
                {focusCard}
              </>
            ) : (
              <>
                {/* 主要趋势：本期判读量 vs 上一等长窗口 */}
                <div className="span-8">{trendBlock}</div>
                {focusCard}
                {/* 次级分布：病种构成与复核状态构成（同一件事的两个切面） */}
                <div className="span-6">
                  <RankedBars
                    rows={distribution}
                    ariaLabel="病种分布"
                    unit="条"
                    nameWidth={132}
                    emptyText="窗口内没有可统计的判读记录"
                  />
                </div>
                <div className="span-6">
                  <ShareBar
                    rows={reviewDistribution}
                    ariaLabel="复核状态分布"
                    accentNames={[AWAITING_REVIEW_LABEL]}
                    emptyText="窗口内没有复核记录"
                  />
                </div>
                {/* 次级趋势：六个病种的小倍数并成一条带——小倍数就该小。 */}
                <div className="span-12">{diseaseTrendBlock}</div>
              </>
            )}

            {/* 辅助运营：注册节奏与内容运营底盘，密度刻意低于上面几行。 */}
            <div className="span-6">{weekBlock}</div>
            <section className="panel admin-analysis__base span-6" aria-label="运营底盘">
              <div className="panel__head">
                <h2 className="panel__title">运营底盘</h2>
                <span className="panel__note">知识库与资讯</span>
              </div>
              <div className="panel__body admin-analysis__base-grid">
                <StatusList title="知识库文档" rows={knowledgeDistribution} unit="份" />
                <StatusList title="资讯发布" rows={newsDistribution} unit="篇" />
              </div>
            </section>
          </div>

          {stats && stats.knowledgeFailed > 0 ? (
            <p className="admin-analysis__note num">
              知识库有 {formatStatNumber(stats.knowledgeFailed)} 份文档处理失败 ·
              <Link className="admin-analysis__note-link" to="/admin/knowledge?status=2">
                去处理
              </Link>
            </p>
          ) : null}

          {stats ? (
            <dl className="admin-analysis__ledger num" aria-label="统计口径">
              <div>
                <dt>平均置信度</dt>
                <dd>
                  {confidencePercent(stats.avgConfidence)}
                  <span>模型自评均值，不是诊断准确率</span>
                </dd>
              </div>
              <div>
                <dt>已复核</dt>
                <dd>
                  {formatStatNumber(reviewed)}
                  <span>条判读</span>
                </dd>
              </div>
              <div>
                <dt>知识库文档</dt>
                <dd>
                  {formatStatNumber(stats.knowledgeTotal)}
                  <span>份 · 切片 {formatStatNumber(stats.knowledgeChunks)} 块</span>
                </dd>
              </div>
              <div>
                <dt>资讯</dt>
                <dd>
                  {formatStatNumber(stats.newsTotal)}
                  <span>篇</span>
                </dd>
              </div>
            </dl>
          ) : null}
        </>
      )}
    </div>
  )
}

export default AdminDataAnalysisPage
