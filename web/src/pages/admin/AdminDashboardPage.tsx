import { useMemo, useState, type ReactElement, type ReactNode } from "react"
import { Link } from "react-router-dom"
import { useQuery } from "@tanstack/react-query"
import { ArrowUpRight, ChartColumn, Eye, ScanEye, type LucideIcon } from "lucide-react"

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
import { canonicalClassName, confidencePercent, formatTimestamp } from "@/lib/domain"
import { fault } from "@/lib/faults"

/** 统计时间窗：整页统一，KPI、趋势、分布都覆盖同一段时间。 */
const RANGES = [
  { value: 7, label: "7 天" },
  { value: 30, label: "30 天" },
  { value: 90, label: "90 天" },
]

/** 待人工复核在状态分布里的名字（用于给占比条上强调色）。 */
const AWAITING_REVIEW_LABEL = humanReviewStatusLabel("AWAITING_REVIEW")

/**
 * 读数轨的一格：标签 + 等宽大数 + 一行口径。
 *
 * <p>四个读数同属一条轨（不是四张卡）：左缘一枚管理紫短柱标出主指标，
 * 格子之间用发丝竖线分栏——密度高于卡片阵列，扫读路径也只有一条。
 */
function MetricCell(props: {
  label: string
  value: string
  foot?: ReactNode
  /** 主指标：左缘加一枚管理紫短柱 */
  primary?: boolean
}): ReactElement {
  return (
    <div className={`admin-metric-card${props.primary ? " admin-metric-card--primary" : ""}`}>
      <span className="admin-metric-card__label">{props.label}</span>
      <span className="admin-metric-card__value">{props.value}</span>
      <span className="admin-metric-card__foot">{props.foot}</span>
    </div>
  )
}

/**
 * 解释型空态：图表位让位时给的说明卡。
 *
 * <p>外壳与图表卡同款（.admin-viz），里面只放「为什么空 + 下一步去哪」，
 * 不留一块空白大画布，也不画贴地的假曲线。
 */
function InsightEmpty(props: {
  title: string
  note: string
  icon: LucideIcon
  emptyTitle: string
  description: string
  action?: ReactNode
}): ReactElement {
  return (
    <section className="admin-viz admin-viz--empty">
      <div className="admin-viz__head">
        <span className="admin-viz__title">{props.title}</span>
        <span className="admin-viz__head-extra num">{props.note}</span>
      </div>
      <div className="admin-viz__body">
        <AdminEmpty
          icon={props.icon}
          title={props.emptyTitle}
          description={props.description}
          action={props.action}
        />
      </div>
    </section>
  )
}

/**
 * 仪表盘（真实统计 · 运营工作台）。
 *
 * <p>读数来自 {@code GET /stats/admin/overview}：KPI、趋势、分布都是后端聚合
 * 出来的真实数据，不是示例数据。
 *
 * <p>构图（Bento 12 列，格子大小由信息量决定）：
 * <ol>
 *   <li>读数轨（跨满列）：窗口判读 / AI 拒识 / 新增用户 / 待审核资讯；</li>
 *   <li>判读趋势（8 列，主位）+ 待人工复核重点卡（4 列）；</li>
 *   <li>复核状态分布 / 病种分布 / 运营待办（各 4 列）；</li>
 *   <li>最近判读记录（跨满列，全量台账）。</li>
 * </ol>
 *
 * <p>零值纪律：真实数据为空时不画一排「0」KPI 假装系统活着，也不画一条贴地的
 * 假趋势线——趋势与分布位整体让位给有解释力的空态说明，并把真实存在的
 * 最近判读记录放进主位区。四块内容两两成行，同一行等高：
 * 积压卡与空窗解释一行，记录台账与运营待办一行。
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

  const distribution = useMemo(() => {
    // 后端按原始 result 分组；前端按产品的类名口径归一（同一类的不同写法合并成
    // 一行），图例、读数表与最近记录读到的都是规范中文名。
    const merged = new Map<string, number>()
    for (const row of stats?.diagnosisDistribution ?? []) {
      const name = canonicalClassName(row.name) ?? row.name
      merged.set(name, (merged.get(name) ?? 0) + row.value)
    }
    return rankDistribution([...merged].map(([name, value]) => ({ name, value })))
  }, [stats])

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
        row.result ? (
          canonicalClassName(row.result) ?? row.result
        ) : (
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

  // 窗口内有没有判读，决定这一页是「工作台」还是「解释面板」。
  const noDiagnosis = stats ? stats.diagnosisInRange === 0 : false
  // 积压强度：没有待复核时重点卡降为中性卡，不给无积压的页面制造警报氛围。
  const backlogActive = stats ? awaitingTotal > 0 : false

  /* ── 面板块（两种布局复用同一批内容）────────────────────────── */

  const backlogCard = (
    <section
      className={`feature-card span-4${backlogActive ? "" : " feature-card--calm"}`}
      aria-label="待人工复核积压"
    >
      <div className="feature-card__top">
        <span className="feature-card__kicker">
          {backlogActive ? "待人工复核 · 积压" : "待人工复核 · 已清空"}
        </span>
        <span className="feature-card__value num">{read(awaitingTotal)}</span>
        <span className="feature-card__label">
          {!stats
            ? "统计读数尚未返回，积压数暂不可判读。"
            : backlogActive
              ? `窗口内新增 ${formatStatNumber(stats.diagnosisAwaitingReview ?? 0)} 条，` +
                "积压需要人工复核才能进入正式记录。"
              : "当前没有等待人工复核的判读记录，积压已清空。"}
        </span>
      </div>
      <div className="feature-card__bottom">
        <div className="feature-card__foot">
          <Link className="feature-card__cta" to="/admin/diagnosis?review=requiresReview">
            去复核
            <ArrowUpRight size={14} strokeWidth={2} aria-hidden="true" />
          </Link>
          <span className="feature-card__sub num">
            {stats ? `窗口内新增 ${formatStatNumber(stats.diagnosisAwaitingReview)} 条` : "—"}
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
      </div>
    </section>
  )

  const trendBlock = (
    <TrendAreaChart
      data={trendRows}
      ariaLabel={`判读趋势 · 近 ${days} 天（含上一等长窗口对照）`}
      height={288}
    />
  )

  const shareBlock = (
    <ShareBar
      rows={reviewDistribution}
      ariaLabel="复核状态分布"
      accentNames={[AWAITING_REVIEW_LABEL]}
    />
  )

  const rankedBlock = (
    <RankedBars rows={distribution} ariaLabel="病种分布" unit="条" nameWidth={104} />
  )

  const actionsBlock = (
    <section className="panel admin-dashboard__todo" aria-label="运营待办">
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
  )

  const recentBlock = (
    <>
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
    </>
  )

  // 空窗口时的解释面板：说清「为什么空」与「上一窗口有多少」，并给出真实出口。
  const emptyInsight = (
    <InsightEmpty
      title="判读趋势与分布"
      note={`近 ${days} 天`}
      icon={ChartColumn}
      emptyTitle="窗口内还没有可统计的判读"
      description={
        stats?.previousDiagnosisInRange
          ? `上一等长窗口有 ${formatStatNumber(stats.previousDiagnosisInRange)} 条判读。` +
            "复核状态与病种分布要等窗口内出现判读才会成图——把时间窗拉长，或到诊断管理查看全量。"
          : "上一等长窗口同样没有记录。复核状态与病种分布要等窗口内出现判读才会成图——" +
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
    <div className="admin-dashboard">
      <AdminPageHead
        code="01"
        title="运营总览"
        eyebrow="ADMIN · DASHBOARD"
        size="lead"
        description="积压、判读规模、拒识与待审核资讯，读数来自同一时间窗。"
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
              label="AI 拒识"
              value={read(aiRejected)}
              foot={
                <span className="admin-metric-card__delta">
                  {stats ? `占窗口内判读 ${formatStatPercent(rejectShare)}` : "统计读数尚未返回"}
                </span>
              }
            />
            <MetricCell
              label="新增用户"
              value={read(userNew)}
              foot={
                <span className="admin-metric-card__delta">
                  {stats ? changeLabel(userNew, stats.previousUserNew) : "—"}
                </span>
              }
            />
            <MetricCell
              label="待审核资讯"
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

          {noDiagnosis ? (
            /* 空窗口：积压与空窗解释在上，真实存在的记录与待办在下。
               两行各自成对，格子高度一致——不留下半张卡高的空洞。 */
            <div className="admin-bento">
              {backlogCard}
              <div className="span-8">{emptyInsight}</div>
              <section className="panel admin-dashboard__recent span-8" aria-label="最近判读记录">
                {recentBlock}
              </section>
              <div className="span-4">{actionsBlock}</div>
            </div>
          ) : (
            <div className="admin-bento">
              <div className="span-8">{trendBlock}</div>
              {backlogCard}
              <div className="span-4">{shareBlock}</div>
              <div className="span-4">{rankedBlock}</div>
              <div className="span-4">{actionsBlock}</div>
              <section
                className="panel admin-dashboard__recent span-12"
                aria-label="最近判读记录"
              >
                {recentBlock}
              </section>
            </div>
          )}
        </>
      )}

      {stats ? (
        <p className="admin-dashboard__note num">
          平均置信度 {confidencePercent(stats.avgConfidence)}（模型自评的置信度均值，
          <b>不是诊断准确率</b>） · 已复核 {formatStatNumber(stats.diagnosisReviewed)} 条 ·
          AI 拒识 {formatStatNumber(stats.diagnosisAiRejected)} 条 · 资讯{" "}
          {formatStatNumber(stats.newsTotal)} 篇
        </p>
      ) : null}
    </div>
  )
}

export default AdminDashboardPage
