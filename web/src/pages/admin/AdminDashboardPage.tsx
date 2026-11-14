import { useMemo, useState, type ReactElement, type ReactNode } from "react"
import { Link } from "react-router-dom"
import { useQuery } from "@tanstack/react-query"
import { ArrowUpRight, ChartColumn, Eye, ScanEye } from "lucide-react"

import { AdminEmpty } from "@/components/admin/AdminEmpty"
import { AdminPageHead } from "@/components/admin/AdminPageHead"
import { ConfidenceCell } from "@/components/admin/ConfidenceCell"
import { TrendAreaChart } from "@/components/admin/charts/TrendAreaChart"
import { ShareBar } from "@/components/admin/charts/ShareBar"
import { RankedBars } from "@/components/admin/charts/RankedBars"
import { DataTable, type Column } from "@/components/admin/DataTable"
import { RiskTag } from "@/components/RiskTag"
import { FaultNote } from "@/components/fault"
import { getAdminStats, listDiagnoses, type AdminDiagnosis } from "@/lib/adminApi"
import {
  formatStatNumber,
  formatStatPercent,
  humanReviewStatusLabel,
  rankDistribution,
  reviewView,
} from "@/lib/adminDomain"
import { alignPreviousWindow, changeLabel } from "@/lib/chartData"
import { describeError } from "@/lib/api"
import { queryKeys } from "@/lib/queryKeys"
import { formatTimestamp } from "@/lib/domain"
import { fault } from "@/lib/faults"

/** 统计时间窗：整页统一，KPI、趋势、分布都覆盖同一段时间。 */
const RANGES = [
  { value: 7, label: "7 天" },
  { value: 30, label: "30 天" },
  { value: 90, label: "90 天" },
]

/** 待人工复核在状态分布里的名字（用于给占比条上强调色）。 */
const AWAITING_REVIEW_LABEL = humanReviewStatusLabel("AWAITING_REVIEW")

/** 读数卡：标签 + 等宽大数 + 一行口径。强调位只加左侧紫线，不做整卡填色。 */
function KpiCard(props: {
  label: string
  value: string
  foot?: ReactNode
  accent?: boolean
}): ReactElement {
  return (
    <div className={`admin-metric-card${props.accent ? " admin-metric-card--accent" : ""}`}>
      <span className="admin-metric-card__label">{props.label}</span>
      <span className="admin-metric-card__value">{props.value}</span>
      <span className="admin-metric-card__foot">{props.foot}</span>
    </div>
  )
}

/**
 * 仪表盘（真实统计 · 运营工作台）。
 *
 * <p>读数来自 {@code GET /stats/admin/overview}：KPI、趋势、分布都是后端聚合
 * 出来的真实数据，不是示例数据。
 *
 * <p>构图（Bento，12 列栅格，信息量决定格子大小）：
 * <ol>
 *   <li>读数条：窗口判读 / AI 拒识 / 新增用户 / 待审核资讯；</li>
 *   <li>紫色重点卡跨 4 列——「待人工复核积压」是工作台第一动作，直接给下钻；</li>
 *   <li>趋势图跨 8 列——窗口内规模最大，占主位；</li>
 *   <li>运营待办 + 复核状态分布（或空态说明）；</li>
 *   <li>病种分布 + 最近判读记录。</li>
 * </ol>
 *
 * <p>零值纪律：真实数据为空时不画一排「0」KPI 假装系统活着，也不画一条贴地的
 * 假趋势线——趋势与分布位整体让位给有解释力的空态面板，并注明窗口口径。
 */
export function AdminDashboardPage(): ReactElement {
  const [days, setDays] = useState(30)

  const statsQuery = useQuery({
    queryKey: queryKeys.admin.stats(days),
    queryFn: () => getAdminStats(days),
    // 切窗必须立刻失效：不同窗口是不同的查询键；gcTime 0 让离开的窗口马上被回收。
    gcTime: 0,
    staleTime: 0,
  })
  const recentQuery = useQuery({
    queryKey: queryKeys.admin.recentDiagnoses,
    queryFn: () => listDiagnoses({ current: 1, pageSize: 5 }),
  })

  // 第二道守卫：后端回显的窗口天数与选中值不一致时，当作还没读到。
  const stats = statsQuery.data?.days === days ? statsQuery.data : undefined
  const statsFault = statsQuery.error ? describeError(statsQuery.error) : null
  const statsLoading = !stats && !statsFault

  const changeDays = (next: number) => {
    if (next !== days) setDays(next)
  }

  const recent = recentQuery.data
  const recentFault = recentQuery.error ? describeError(recentQuery.error) : null
  const recentLoading = recentQuery.isPending

  const trendRows = useMemo(
    () =>
      alignPreviousWindow(
        stats?.trendDays ?? [],
        stats?.diagnosisTrend ?? [],
        stats?.previousDiagnosisTrend ?? [],
      ),
    [stats],
  )

  const distribution = rankDistribution(stats?.diagnosisDistribution ?? [])

  const reviewDistribution = useMemo(
    () =>
      rankDistribution(
        (stats?.reviewDistribution ?? []).map((row) => ({
          name: humanReviewStatusLabel(row.name),
          value: row.value,
        })),
      ),
    [stats],
  )

  const newsPending = useMemo(() => {
    const row = (stats?.newsByStatus ?? []).find((entry) => Number(entry.name) === 3)
    return row ? row.value : 0
  }, [stats])

  const awaitingTotal = stats?.diagnosisAwaitingReviewTotal ?? 0
  const aiRejected = stats?.diagnosisAiRejected ?? 0
  const inRange = stats?.diagnosisInRange ?? 0
  const rejectShare = inRange > 0 ? aiRejected / inRange : 0
  const userNew = stats?.userNew ?? 0

  /** 读数：统计还没回来时给破折号，不给 0——「还没读到」和「读到是零」是两件事。 */
  const read = (value: number | undefined): string =>
    stats ? formatStatNumber(value ?? 0) : "—"

  const recentRows = recent?.records ?? []

  const recentColumns: Column<AdminDiagnosis>[] = [
    {
      key: "url",
      title: "影像",
      width: "60px",
      render: (row) =>
        row.url ? (
          <img
            className="admin-diagnosis__thumb"
            src={row.url}
            alt={`判读影像 ${row.id}`}
            width={38}
            height={38}
            loading="lazy"
          />
        ) : (
          <span className="admin-diagnosis__thumb admin-diagnosis__thumb--empty" aria-label="无影像">
            <Eye size={14} strokeWidth={1.6} aria-hidden="true" />
          </span>
        ),
    },
    { key: "username", title: "患者", width: "120px" },
    {
      key: "result",
      title: "判读结果",
      render: (row) =>
        row.result ?? (
          <span className="admin-chip" data-tone="critical">
            AI 拒识
          </span>
        ),
    },
    {
      key: "confidence",
      title: "置信度",
      width: "128px",
      mono: true,
      render: (row) => <ConfidenceCell value={row.confidence} />,
    },
    {
      key: "review",
      title: "复审状态",
      width: "120px",
      render: (row) => {
        const view = reviewView(row)
        return <RiskTag risk={view.risk}>{view.label}</RiskTag>
      },
    },
    {
      key: "createTime",
      title: "时间",
      width: "164px",
      mono: true,
      render: (row) => formatTimestamp(row.createTime),
    },
  ]

  // 零值纪律：窗口内完全没有判读时，不画贴地折线与空白分布卡；
  // 用一个说明面板解释「为什么没有」并给去全量的入口。
  const trendHasData = trendRows.some((row) => row.value > 0 || row.previous > 0)
  const noDiagnosis = stats ? stats.diagnosisInRange === 0 : false

  return (
    <div className="admin-dashboard">
      <AdminPageHead
        code="01"
        title="仪表盘"
        eyebrow="ADMIN · DASHBOARD"
        description="运营总览：积压、判读规模、拒识与待审核资讯，读数来自同一时间窗。"
        meta={
          stats ? (
            <span className="admin-sample num">
              {stats.rangeStart} ~ {stats.rangeEnd} · 近 {stats.days} 天
            </span>
          ) : null
        }
        actions={
          <div className="admin-range" role="group" aria-label="统计时间窗">
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
          className="admin-dashboard__fault"
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
            <KpiCard
              label="窗口内判读 · IN RANGE"
              value={read(inRange)}
              accent
              foot={
                <span className="admin-metric-card__delta">
                  {stats ? changeLabel(inRange, stats.previousDiagnosisInRange) : "—"}
                </span>
              }
            />
            <KpiCard
              label="AI 拒识 · REJECTED"
              value={read(aiRejected)}
              foot={
                <span className="admin-metric-card__delta">
                  {stats
                    ? `占窗口内判读 ${formatStatPercent(rejectShare)}`
                    : "统计读数尚未返回"}
                </span>
              }
            />
            <KpiCard
              label="新增用户 · NEW USERS"
              value={read(userNew)}
              foot={
                <span className="admin-metric-card__delta">
                  {stats ? changeLabel(userNew, stats.previousUserNew) : "—"}
                </span>
              }
            />
            <KpiCard
              label="待审核资讯 · NEWS PENDING"
              value={read(newsPending)}
              foot={
                <>
                  <span
                    className="admin-chip"
                    data-tone={stats ? (newsPending > 0 ? "attention" : "normal") : "mute"}
                  >
                    {stats ? (newsPending > 0 ? "待审核" : "已清空") : "读取中"}
                  </span>
                  <Link className="action-row__link" to="/admin/news?status=3">
                    去审核
                  </Link>
                </>
              }
            />
          </section>

          <div className="admin-bento">
            {/* 第一行：紫色重点卡（动作项）+ 趋势图（主位） */}
            <section className="feature-card span-4" aria-label="待人工复核积压">
              <span className="feature-card__kicker">待人工复核 · 积压</span>
              <span className="feature-card__value num">{read(awaitingTotal)}</span>
              <span className="feature-card__label">
                {!stats
                  ? "统计读数尚未返回，积压数暂不可判读。"
                  : awaitingTotal > 0
                    ? `窗口内新增 ${formatStatNumber(stats.diagnosisAwaitingReview ?? 0)} 条，` +
                      "积压需要人工复核才能进入正式记录。"
                    : "当前没有等待人工复核的判读记录，积压已清空。"}
              </span>
              <div className="feature-card__foot">
                <Link className="feature-card__cta" to="/admin/diagnosis?review=requiresReview">
                  去复核
                  <ArrowUpRight size={14} strokeWidth={2} aria-hidden="true" />
                </Link>
                <span className="feature-card__sub num">
                  {stats
                    ? `窗口内新增 ${formatStatNumber(stats.diagnosisAwaitingReview)} 条`
                    : "—"}
                </span>
              </div>
              <dl className="feature-card__stats">
                <div>
                  <dt>已复核</dt>
                  <dd className="num">{read(stats?.diagnosisReviewed)}</dd>
                </div>
                <div>
                  <dt>AI 拒识</dt>
                  <dd className="num">{read(aiRejected)}</dd>
                </div>
              </dl>
            </section>

            <div className="span-8">
              {trendHasData ? (
                <TrendAreaChart
                  data={trendRows}
                  ariaLabel={`判读趋势 · 近 ${days} 天（含上一等长窗口对照）`}
                  height={260}
                />
              ) : (
                <section className="panel admin-dashboard__trend-empty" aria-label="窗口内判读趋势">
                  <div className="panel__head">
                    <h2 className="admin-sec-title">判读趋势</h2>
                    <span className="panel__note">近 {days} 天 · 含上一等长窗口对照</span>
                  </div>
                  <div className="panel__body">
                    <AdminEmpty
                      icon={ScanEye}
                      title="窗口内还没有判读记录"
                      description={
                        stats?.previousDiagnosisInRange
                          ? `上一等长窗口为 ${formatStatNumber(stats.previousDiagnosisInRange)} 条。换个更长的时间窗，或到诊断管理查看全量。`
                          : "上一等长窗口同样没有记录。换个更长的时间窗，或到诊断管理查看全量。"
                      }
                      action={
                        <Link className="action-row__link" to="/admin/diagnosis">
                          打开诊断管理
                        </Link>
                      }
                    />
                  </div>
                </section>
              )}
            </div>

            {/* 第二行：运营待办 + 分布（或空态说明） */}
            <section className="panel span-4" aria-label="运营待办">
              <div className="panel__head">
                <h2 className="admin-sec-title">运营待办</h2>
                <span className="panel__note">{stats ? `近 ${stats.days} 天` : "—"}</span>
              </div>
              <div className="panel__body">
                <div className="action-list">
                  <div className="action-row">
                    <span className="action-row__label">AI 拒识记录</span>
                    <span className={`action-row__count num ${aiRejected > 0 ? "action-row__count--hot" : ""}`}>
                      {read(aiRejected)}
                    </span>
                    <Link className="action-row__link" to="/admin/diagnosis?review=aiRejected">
                      去查看
                    </Link>
                  </div>
                  <div className="action-row">
                    <span className="action-row__label">知识库处理失败</span>
                    <span className={`action-row__count num ${stats && stats.knowledgeFailed > 0 ? "action-row__count--hot" : ""}`}>
                      {read(stats?.knowledgeFailed)}
                    </span>
                    <Link className="action-row__link" to="/admin/knowledge?status=2">
                      去处理
                    </Link>
                  </div>
                  <div className="action-row">
                    <span className="action-row__label">资讯待审核</span>
                    <span className={`action-row__count num ${newsPending > 0 ? "action-row__count--hot" : ""}`}>
                      {read(newsPending)}
                    </span>
                    <Link className="action-row__link" to="/admin/news?status=3">
                      去审核
                    </Link>
                  </div>
                </div>
              </div>
            </section>

            {noDiagnosis ? (
              <section className="panel span-8" aria-label="判读分布空态">
                <div className="panel__head">
                  <h2 className="admin-sec-title">判读分布</h2>
                  <span className="panel__note">复核状态 / 病种</span>
                </div>
                <div className="panel__body">
                  <AdminEmpty
                    icon={ChartColumn}
                    title="窗口内还没有可统计的判读"
                    description="没有判读记录时，复核状态与病种分布不会画出空图形。把时间窗拉长，或先处理运营待办里的积压。"
                    action={
                      <Link className="action-row__link" to="/admin/diagnosis">
                        打开诊断管理
                      </Link>
                    }
                  />
                </div>
              </section>
            ) : (
              <>
                <div className="span-8">
                  <ShareBar
                    rows={reviewDistribution}
                    ariaLabel="复核状态分布"
                    accentNames={[AWAITING_REVIEW_LABEL]}
                  />
                </div>
                <div className="span-5">
                  <RankedBars rows={distribution} ariaLabel="病种分布" unit="条" />
                </div>
              </>
            )}

            {/* 最近判读记录：全量入口在诊断管理，这里只给最近 5 条。 */}
            <section
              className={`panel admin-dashboard__recent ${noDiagnosis ? "span-12" : "span-7"}`}
              aria-label="最近判读记录"
            >
              <div className="panel__head">
                <h2 className="admin-sec-title">最近判读记录</h2>
                <span className="panel__note">最新 5 条 · 全量在诊断管理</span>
                <div className="panel__actions">
                  <Link className="action-row__link" to="/admin/diagnosis">
                    打开诊断管理
                  </Link>
                </div>
              </div>
              <div className="panel__body">
                {recentFault ? (
                  <FaultNote
                    fault={fault({
                      severity: "attention",
                      kind: "client",
                      title: `最近判读记录加载失败：${recentFault.text}`,
                      code: recentFault.code,
                    })}
                  />
                ) : null}
                <DataTable<AdminDiagnosis>
                  columns={recentColumns}
                  rows={recentRows}
                  rowKey={(row) => row.id}
                  loading={recentLoading}
                  emptyText="暂无判读记录"
                  emptyContent={
                    <AdminEmpty
                      icon={ScanEye}
                      title="还没有判读记录"
                      description="患者完成首次影像判读后，这里会显示最近 5 条。"
                    />
                  }
                  page={{ current: 1, pageSize: 5, total: recent?.total ?? 0 }}
                  onPageChange={() => {}}
                  hidePager
                />
              </div>
            </section>
          </div>
        </>
      )}

      {stats ? (
        <p className="admin-dashboard__note num">
          平均置信度 {formatStatPercent(stats.avgConfidence)}（模型自评的置信度均值，
          <b>不是诊断准确率</b>） · 已复核 {formatStatNumber(stats.diagnosisReviewed)} 条 ·
          AI 拒识 {formatStatNumber(stats.diagnosisAiRejected)} 条 · 资讯{" "}
          {formatStatNumber(stats.newsTotal)} 篇
        </p>
      ) : null}
    </div>
  )
}

export default AdminDashboardPage
