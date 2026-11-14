import { useMemo, useState, type FormEvent, type ReactElement, type ReactNode } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { useSearchParams } from "react-router-dom"
import { ChevronDown, ChevronUp, Eye, FileText, ScanEye, Trash2 } from "lucide-react"

import { useMediaQuery } from "@/lib/useMediaQuery"

import { AdminEmpty } from "@/components/admin/AdminEmpty"
import { AdminPageHead } from "@/components/admin/AdminPageHead"
import { ConfidenceCell } from "@/components/admin/ConfidenceCell"
import { RowMenu } from "@/components/admin/RowMenu"
import { DataTable, type Column, type SortState } from "@/components/admin/DataTable"
import { Modal } from "@/components/admin/Modal"
import { Drawer } from "@/components/admin/Drawer"
import { BatchBar } from "@/components/admin/BatchBar"
import { RiskTag } from "@/components/RiskTag"
import { FaultNote } from "@/components/fault"
import {
  listDiagnoses,
  getDiagnosis,
  submitReview,
  deleteDiagnosis,
  deleteDiagnoses,
  type AdminDiagnosis,
  type BatchResult,
  type DiagnosisQuery,
} from "@/lib/adminApi"
import {
  reviewView,
  confidencePercent,
  diagnosisFilterParams,
  formatStatNumber,
  DIAGNOSIS_REVIEW_FILTER_OPTIONS,
  humanReviewStatusLabel,
  type DiagnosisReviewFilter,
} from "@/lib/adminDomain"
import { describeError, type ErrorDetail } from "@/lib/api"
import { queryKeys } from "@/lib/queryKeys"
import {
  severityLabel,
  formatTimestamp,
  recommendationLines,
  canonicalClassName,
  classCode,
} from "@/lib/domain"
import { fault } from "@/lib/faults"

import "@/styles/admin-polish-ledger.css"

const DEFAULT_PAGE_SIZE = 10
const ABSTAIN_LIMIT = 20

/** 人工严重程度下拉：值逐字照 brief，与后端 humanSeverity 对齐。 */
const HUMAN_SEVERITY = [
  { value: "NOT_ASSESSED", label: "未评估" },
  { value: "normal", label: "正常" },
  { value: "low", label: "低风险" },
  { value: "medium", label: "中风险" },
  { value: "high", label: "高风险" },
] as const

/** 已应用的筛选条件。 */
type Query = {
  result: string
  review: DiagnosisReviewFilter
  startDate: string
  endDate: string
}
type Params = DiagnosisQuery

/**
 * 置信度 → 百分比读数（一位小数）——实现在 adminDomain 的纯函数层，
 * 那里有回归用例锁住「没有结论 ≠ 0.0%」这条规则。
 */

/**
 * AI 拒识的判定只认后端的 aiRejected 标记。
 *
 * <p>「没有判读结果」与「模型拒识」是两件事：前者是这条记录压根没有结论
 * （老数据、跑失败的记录），后者是模型主动弃权并给了原因。把两者混为一谈
 * 会让管理员以为每一次空结果都是模型拒识，拒识的信号也就废了。
 */
function isRejected(row: AdminDiagnosis): boolean {
  return row.aiRejected === true
}

/**
 * 判读结论的展示口径。
 *
 * <p>算法侧的原始标签（cataract / diabetes…）在页面上归一到规范中文名；
 * 归一不出来的原样显示，并标一句「未归类」——不猜它属于哪一类。
 */
function resultView(row: AdminDiagnosis): {
  name: string
  code: string
  canonical: boolean
} {
  const raw = row.result?.trim() ?? ""
  const canonical = canonicalClassName(raw)
  return {
    name: canonical ?? raw,
    code: canonical ? classCode(canonical) : "",
    canonical: canonical !== null,
  }
}

function truncate(value: string, limit: number): string {
  return value.length > limit ? `${value.slice(0, limit)}…` : value
}

/** Drawer 读数表的一行：label / value 两列，值可含 JSX。 */
function FactRow({
  label,
  value,
  mono = false,
}: {
  label: string
  value: ReactNode
  mono?: boolean
}): ReactElement {
  return (
    <div className="admin-diagnosis__drawer-fact">
      <dt className="admin-diagnosis__drawer-fact-label">{label}</dt>
      <dd
        className={
          "admin-diagnosis__drawer-fact-value" + (mono ? " num" : "")
        }
      >
        {value}
      </dd>
    </div>
  )
}

/**
 * 诊断管理（真实端点）。
 *
 * 取数逐字对齐用户 / 新闻管理页：唯一的 load() 由查询 / 重置 / 翻页 / 删除与复核
 * 成功后刷新调用，首次挂载只用一个 useEffect 加载一次；三态从 view 派生，
 * requestSeq 递增序号挡过期响应；删除走确认 Modal + deleting 锁；
 * 失败收起弹层、改用 FaultNote 页内读数。
 *
 * 详情 Drawer 与复核 Modal 会同时打开（弹层栈专为此设计）：复核只收
 * 四个 human* 字段，AI 判读字段界面上无任何输入。getDiagnosis 的加载 / 错误态
 * 在 Drawer 内自洽处理，另用 detailSeq 挡住快速开关时的过期响应。
 * 雪花 id 全程 string：列表 / 详情 / 复核 / 删除都不做 Number(id) 转换。
 */
export function AdminDiagnosisPage(): ReactElement {
  // 下钻入口：仪表盘的「去复核 / 去查看」带着 ?review= 进来，直接落到对应筛选上，
  // 管理员不用自己再点一次筛选下拉。参数只认白名单里的语义键，其余一律忽略。
  const [searchParams] = useSearchParams()
  const initialReview = ((): DiagnosisReviewFilter => {
    const value = searchParams.get("review")
    return DIAGNOSIS_REVIEW_FILTER_OPTIONS.some((option) => option.value === value)
      ? (value as DiagnosisReviewFilter)
      : ""
  })()

  // 输入草稿与「已应用的查询」分开：打字不触发请求，回车 / 查询按钮才提交。
  const [resultDraft, setResultDraft] = useState("")
  const [startDraft, setStartDraft] = useState("")
  const [endDraft, setEndDraft] = useState("")
  const [query, setQuery] = useState<Query>({
    result: "",
    review: initialReview,
    startDate: "",
    endDate: "",
  })
  const [page, setPage] = useState({ current: 1, pageSize: DEFAULT_PAGE_SIZE })
  // 服务端排序：不在当前页做二次排序，字段必须落在后端白名单里。
  const [sort, setSort] = useState<SortState>(null)

  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [deleteTarget, setDeleteTarget] = useState<AdminDiagnosis | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [actionError, setActionError] = useState<ErrorDetail | null>(null)
  const [actionNote, setActionNote] = useState<string | null>(null)
  const [batchBusy, setBatchBusy] = useState(false)

  const [detailTarget, setDetailTarget] = useState<AdminDiagnosis | null>(null)

  const [reviewOpen, setReviewOpen] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [reviewError, setReviewError] = useState<ErrorDetail | null>(null)
  const [humanResult, setHumanResult] = useState("")
  const [humanSeverity, setHumanSeverity] = useState<string>("NOT_ASSESSED")
  const [humanRecommendations, setHumanRecommendations] = useState("")
  const [humanReviewNote, setHumanReviewNote] = useState("")

  const queryClient = useQueryClient()

  /** 已应用的筛选 + 分页：同时是查询键和请求体，二者不可能不同步。 */
  const { current, pageSize } = page
  const params = useMemo<Params>(
    () => ({
      current,
      pageSize,
      ...(query.result ? { result: query.result } : {}),
      ...diagnosisFilterParams(query.review),
      ...(query.startDate ? { startDate: query.startDate } : {}),
      ...(query.endDate ? { endDate: query.endDate } : {}),
      ...(sort ? { sortField: sort.field, sortOrder: sort.order } : {}),
    }),
    [current, pageSize, query, sort],
  )

  const listQuery = useQuery({
    queryKey: queryKeys.admin.diagnosis(params),
    queryFn: () => listDiagnoses(params),
  })
  const listFault = listQuery.error ? describeError(listQuery.error) : null

  const detailQuery = useQuery({
    queryKey: queryKeys.admin.diagnosisDetail(detailTarget?.id ?? ""),
    queryFn: () => getDiagnosis(detailTarget!.id),
    enabled: detailTarget !== null,
  })
  const detail = detailTarget ? detailQuery.data : undefined
  const detailLoading = detailTarget !== null && detailQuery.isPending
  const detailFault = detailQuery.error ? describeError(detailQuery.error) : null

  /**
   * 写操作成功后失效诊断域与统计域：列表、详情、仪表盘统计都会自己重取，
   * 不需要手工再发一次列表请求。
   */
  const refreshDiagnosis = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.admin.diagnosisAll }),
      queryClient.invalidateQueries({ queryKey: queryKeys.admin.statsAll }),
    ])

  function onSearch(event: FormEvent) {
    event.preventDefault()
    const nextQuery: Query = {
      result: resultDraft.trim(),
      review: query.review,
      startDate: startDraft,
      endDate: endDraft,
    }
    setActionError(null)
    setQuery(nextQuery)
    setPage((prev) => ({ ...prev, current: 1 }))
    setSelectedIds([])
  }

  function onReset() {
    setResultDraft("")
    setStartDraft("")
    setEndDraft("")
    setActionError(null)
    setQuery({ result: "", review: "", startDate: "", endDate: "" })
    setPage((prev) => ({ ...prev, current: 1 }))
    setSelectedIds([])
    setSort(null)
  }

  /**
   * 复核状态段控件：点一下即刻生效（枚举筛选不该再多一次「查询」），
   * 与文本 / 日期字段的「打字不触发请求」分工明确。
   */
  function applyReviewFilter(value: DiagnosisReviewFilter) {
    setActionError(null)
    setQuery((prev) => ({ ...prev, review: value }))
    setPage((prev) => ({ ...prev, current: 1 }))
    setSelectedIds([])
  }

  function onPageChange(next: { current: number; pageSize: number }) {
    // pageSize 变化一律回第 1 页（DataTable 已传 current:1，这里再钉死一次）。
    setActionError(null)
    setPage(
      next.pageSize !== page.pageSize
        ? { current: 1, pageSize: next.pageSize }
        : { current: next.current, pageSize: next.pageSize },
    )
    setSelectedIds([])
  }

  /* ── 详情 Drawer ──────────────────────────────────────────── */

  function openDetail(row: AdminDiagnosis) {
    setActionError(null)
    setDetailTarget(row)
    setReviewOpen(false)
    setReviewError(null)
  }

  /** 收起 Drawer：详情的加载态由查询键管理，关掉即不再展示。 */
  function clearDetail() {
    setDetailTarget(null)
  }

  function closeDetail() {
    if (submitting) return
    clearDetail()
    setReviewOpen(false)
    setReviewError(null)
  }

  /** Drawer 内容：加载 / 错误 / 数据三态都在 Drawer 内处理，不影响列表。 */
  function detailBody(): ReactNode {
    if (detailLoading) {
      return <p className="admin-diagnosis__drawer-state">读取中…</p>
    }
    if (detailFault) {
      return (
        <FaultNote
          className="admin-diagnosis__drawer-fault"
          fault={fault({
            severity: "attention",
            kind: "client",
            title: detailFault.text,
            code: detailFault.code,
          })}
        />
      )
    }
    if (!detail) {
      return <p className="admin-diagnosis__drawer-state">暂无详情</p>
    }
    // 建议分行复用 domain 原语，与判读记录纸（RecordSheet）同源。
    const recos = recommendationLines(detail)
    const hasHumanReview =
      !!detail.humanResult ||
      !!detail.humanReviewNote ||
      !!detail.humanRecommendations ||
      (!!detail.humanReviewStatus && detail.humanReviewStatus !== "PENDING_AI")
    // 详情里的结论同样走规范类名：抽屉与台账不能一个显示英文一个显示中文。
    const verdict = resultView({
      id: detail.id ?? "",
      result: detail.result,
    })
    const rejected = detail.aiRejected === true
    return (
      <div className="admin-diagnosis__detail">
        {/* 结论抬头：先说「判成了什么」，再看图与逐项读数。 */}
        <section
          className={
            "admin-diagnosis__verdict" +
            (rejected ? " admin-diagnosis__verdict--reject" : "")
          }
        >
          <div className="admin-diagnosis__verdict-top">
            <span className="admin-diagnosis__verdict-name">
              {rejected ? "未出结论" : verdict.name || "—"}
            </span>
            {verdict.code ? (
              <span className="admin-diagnosis__verdict-code">{verdict.code}</span>
            ) : null}
          </div>
          <div className="admin-diagnosis__verdict-meta">
            <span>
              <span className="admin-diagnosis__verdict-key">严重程度</span>
              {severityLabel(detail.severity)}
            </span>
            <span>
              <span className="admin-diagnosis__verdict-key">置信度</span>
              <span className="num">
                {confidencePercent(detail.confidence ?? detail.probability)}
              </span>
            </span>
          </div>
          {rejected && detail.abstainReason ? (
            <p className="admin-diagnosis__verdict-reason">
              AI 拒识原因 · {detail.abstainReason}
            </p>
          ) : null}
        </section>

        {detail.url ? (
          <figure className="admin-diagnosis__drawer-figure">
            <img
              className="admin-diagnosis__drawer-img"
              src={detail.url}
              alt="判读影像"
              loading="lazy"
            />
            <figcaption>
              <span>影像 · SOURCE</span>
              <span className="num">{detail.id ?? "—"}</span>
            </figcaption>
          </figure>
        ) : (
          <p className="admin-diagnosis__detail-noimg num">— · 无影像</p>
        )}

        {/* 读数表只列抬头里没有的项：结论 / 置信度 / 严重程度已经在抬头说过，
            同一读数不在两处各写一遍。 */}
        <dl className="admin-diagnosis__drawer-facts">
          <FactRow label="模型版本" value={detail.modelVersion || "—"} mono />
          <FactRow label="预处理版本" value={detail.preprocessVersion || "—"} mono />
          <FactRow
            label="推理策略版本"
            value={detail.inferencePolicyVersion || "—"}
            mono
          />
          <FactRow
            label="人工复核状态"
            value={humanReviewStatusLabel(detail.humanReviewStatus)}
          />
          <FactRow label="判读时间" value={formatTimestamp(detail.createTime)} mono />
        </dl>

        <section className="admin-diagnosis__section">
          <h3 className="admin-diagnosis__section-title">建议 · RECOMMENDATIONS</h3>
          {recos.length > 0 ? (
            <ol className="admin-diagnosis__drawer-recos">
              {recos.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ol>
          ) : (
            <p className="admin-diagnosis__note">—</p>
          )}
        </section>

        {/* 拒识原因已经贴在抬头（结论就是「未出结论」，原因紧随其后）；
            只有「有原因但后端没打拒识标记」这种旧数据才另起一段，
            同一句话不在两处各写一遍。 */}
        {detail.abstainReason && !rejected ? (
          <section className="admin-diagnosis__section">
            <h3 className="admin-diagnosis__section-title">AI 拒识原因</h3>
            <p className="admin-diagnosis__note">{detail.abstainReason}</p>
          </section>
        ) : null}

        {hasHumanReview ? (
          <section className="admin-diagnosis__section">
            <h3 className="admin-diagnosis__section-title">人工复核记录 · HUMAN REVIEW</h3>
            <dl className="admin-diagnosis__drawer-facts">
              <FactRow label="人工结论" value={detail.humanResult || "—"} />
              <FactRow label="人工严重程度" value={detail.humanSeverity || "—"} />
              <FactRow label="人工建议" value={detail.humanRecommendations || "—"} />
              <FactRow label="复核备注" value={detail.humanReviewNote || "—"} />
            </dl>
          </section>
        ) : null}
      </div>
    )
  }

  /* ── 复核 Modal ───────────────────────────────────────────── */

  function openReview() {
    setHumanResult("")
    setHumanSeverity("NOT_ASSESSED")
    setHumanRecommendations("")
    setHumanReviewNote("")
    setReviewError(null)
    setReviewOpen(true)
  }

  function closeReview() {
    if (submitting) return
    setReviewOpen(false)
    setReviewError(null)
  }

  async function confirmReview() {
    if (!detailTarget || submitting) return
    const result = humanResult.trim()
    if (!result) return // humanResult 为空时提交按钮已禁用，这里再兜一次
    setSubmitting(true)
    setReviewError(null)
    try {
      await submitReview({
        id: detailTarget.id, // 雪花 id 全程 string
        humanResult: result,
        humanSeverity,
        ...(humanRecommendations.trim()
          ? { humanRecommendations: humanRecommendations.trim() }
          : {}),
        ...(humanReviewNote.trim() ? { humanReviewNote: humanReviewNote.trim() } : {}),
      })
      // 成功：关 Drawer + 关 Modal + 刷新当前页（复审状态随之变「已复审」）。
      clearDetail()
      setReviewOpen(false)
      setReviewError(null)
      setActionNote("已提交人工复核")
      await refreshDiagnosis()
    } catch (cause) {
      // 失败：保持弹层不丢已填内容，按 describeError → fault → FaultNote 语法页内提示。
      setReviewError(describeError(cause))
    } finally {
      setSubmitting(false)
    }
  }

  /* ── 删除 ────────────────────────────────────────────────── */

  function openDelete(row: AdminDiagnosis) {
    setActionError(null)
    setDeleteTarget(row)
  }

  function closeDelete() {
    if (deleting) return
    setDeleteTarget(null)
  }

  async function confirmDelete() {
    if (!deleteTarget || deleting) return
    const target = deleteTarget
    setDeleting(true)
    setActionError(null)
    try {
      await deleteDiagnosis(target.id) // 雪花 id 全程保持 string，绝不转成数字
      setDeleteTarget(null)
      setSelectedIds((prev) => prev.filter((id) => id !== target.id))
      await refreshDiagnosis()
    } catch (cause) {
      const detail = describeError(cause)
      setDeleteTarget(null) // 收起弹层，让页内提示露出来
      setActionError(detail)
    } finally {
      setDeleting(false)
    }
  }

  /** 批量删除：逐条执行，部分失败如实回执。 */
  async function runBatchDelete() {
    if (batchBusy || selectedIds.length === 0) return
    setBatchBusy(true)
    setActionError(null)
    setActionNote(null)
    try {
      const result: BatchResult = await deleteDiagnoses(selectedIds)
      const succeeded = result.succeeded ?? 0
      const failed = result.failed ?? 0
      setActionNote(
        failed > 0
          ? `批量删除：成功 ${succeeded} 条，失败 ${failed} 条。${result.message ?? ""}`
          : `批量删除：成功 ${succeeded} 条。`,
      )
      if (failed === 0) setSelectedIds([])
      await refreshDiagnosis()
    } catch (cause) {
      setActionError(describeError(cause))
    } finally {
      setBatchBusy(false)
    }
  }

  const columns: Column<AdminDiagnosis>[] = [
    {
      key: "url",
      title: "影像",
      width: "64px",
      render: (row) =>
        row.url ? (
          <a
            className="admin-diagnosis__thumb-link"
            href={row.url}
            target="_blank"
            rel="noreferrer"
            aria-label="在新窗口查看判读影像"
          >
            <img
              className="admin-diagnosis__thumb"
              src={row.url}
              alt={`判读影像 ${row.id}`}
              width={44}
              height={44}
              loading="lazy"
            />
          </a>
        ) : (
          <span className="admin-diagnosis__thumb admin-diagnosis__thumb--empty" aria-label="无影像">
            <Eye size={16} strokeWidth={1.6} aria-hidden="true" />
          </span>
        ),
    },
    {
      key: "result",
      title: "判读结果",
      // 弹性列也要给底宽：表格 min-width 992 里它拿 190px，窄屏横向滚动时
      // 判读文字与 AI 拒识原因才不会挤成 0 宽竖条。
      width: "190px",
      sortable: true,
      render: (row) => {
        // AI 拒识与「没有结论」分开说：拒识由复核状态列给独立标识，
        // 这一格只负责说清「模型给了什么 / 为什么不给」。
        if (!row.result) {
          return (
            <span className="admin-diagnosis__noresult">
              <span className="admin-diagnosis__noresult-label">
                {isRejected(row) ? "未出结论" : "无判读结果"}
              </span>
              {row.abstainReason ? (
                <span
                  className="admin-diagnosis__noresult-reason"
                  title={row.abstainReason}
                >
                  {truncate(row.abstainReason, ABSTAIN_LIMIT)}
                </span>
              ) : null}
            </span>
          )
        }
        const view = resultView(row)
        return (
          <span className="admin-diagnosis__result">
            <span className="admin-diagnosis__result-name" title={view.name}>
              {view.name}
            </span>
            <span className="admin-diagnosis__result-sub">
              {view.canonical ? (
                <>
                  <span className="admin-diagnosis__result-code">{view.code}</span>
                  {" · "}
                </>
              ) : (
                <span title="不在模型八类规范名内，按原始标签显示">未归类 · </span>
              )}
              {severityLabel(row.severity ?? undefined)}
            </span>
          </span>
        )
      },
    },
    {
      key: "username",
      title: "用户",
      width: "112px",
      render: (row) => (
        <span className="admin-diagnosis__user" title={row.username || undefined}>
          {row.username || "—"}
        </span>
      ),
    },
    {
      key: "confidence",
      title: "置信度",
      width: "128px",
      mono: true,
      sortable: true,
      render: (row) =>
        // 没有置信度不是 0.0%：AI 拒识的记录后端把置信度置空，读数要说清
        // 「没有读数」，不能画成一条 0% 的进度。
        typeof row.confidence === "number" && !Number.isNaN(row.confidence) ? (
          <span className="admin-diagnosis__reading">
            <span className="admin-diagnosis__reading-label">置信度</span>
            <ConfidenceCell value={row.confidence} />
          </span>
        ) : (
          <span className="admin-diagnosis__reading-none">— 无置信度</span>
        ),
    },
    {
      key: "review",
      title: "复核状态",
      width: "120px",
      // 直接消费 reviewView 的映射，不在此另写一套：AI 拒识 / 待人工复核 /
      // 复审中 / 已复审 / 未复审 的优先级与风险档全部由它裁决。
      render: (row) => {
        const v = reviewView({
          reexamineStatus: row.reexamineStatus,
          requiresReview: row.requiresReview,
          aiRejected: isRejected(row),
        })
        return <RiskTag risk={v.risk}>{v.label}</RiskTag>
      },
    },
    {
      key: "createTime",
      title: "时间",
      width: "156px",
      mono: true,
      sortable: true,
      render: (row) => formatTimestamp(row.createTime),
    },
    {
      key: "action",
      title: "操作",
      width: "132px",
      render: (row) => (
        <div className="admin-dt__row-actions">
          {/* 主动作是「详情」：先看影像与逐项读数，再决定要不要复核。
              复核与删除收进溢出菜单，行内不再堆三个按钮。 */}
          <button
            type="button"
            className="admin-btn admin-btn--primary admin-diagnosis__rowaction"
            onClick={() => openDetail(row)}
          >
            <FileText size={14} strokeWidth={2} aria-hidden="true" />
            详情
          </button>
          <RowMenu
            label={`更多判读操作：${row.id}`}
            items={[
              {
                label: "人工复核",
                icon: <ScanEye size={14} strokeWidth={2} aria-hidden="true" />,
                onSelect: () => {
                  openDetail(row)
                  openReview()
                },
              },
              {
                label: "删除记录",
                icon: <Trash2 size={14} strokeWidth={2} aria-hidden="true" />,
                danger: true,
                onSelect: () => openDelete(row),
              },
            ]}
          />
        </div>
      ),
    },
  ]

  // 三态同源：loading / error / 数据都从同一个查询读；加载与出错时 rows 都是 undefined。
  const rows = listQuery.data?.records
  const total = listQuery.data?.total ?? 0
  const reviewResultEmpty = humanResult.trim().length === 0
  const activeFilters =
    (query.result ? 1 : 0) +
    (query.review ? 1 : 0) +
    (query.startDate ? 1 : 0) +
    (query.endDate ? 1 : 0)

  // 390px 档：筛选面板默认收进一条紧凑工具栏，字段区折叠；
  // 已应用筛选数常驻可见，折叠态也不会骗用户「没有条件在生效」。
  const compact = useMediaQuery("(max-width: 640px)")
  const [filtersOpen, setFiltersOpen] = useState(false)
  const showFields = !compact || filtersOpen

  return (
    <div className="admin-diagnosis">
      <AdminPageHead
        code="04"
        title="诊断管理"
        eyebrow="ADMIN · DIAGNOSIS"
        description="全站判读记录与人工复核队列。紫色只表示管理身份；医学严重度与复核状态始终走风险语义色。"
        meta={
          <span className="admin-filter__note num">
            {listQuery.data ? `共 ${formatStatNumber(total)} 条记录` : "记录数读取中"}
          </span>
        }
      />

      <section className="admin-filter" aria-label="判读记录筛选">
        <form className="admin-diagnosis__form" onSubmit={onSearch}>
          <div className="admin-filter__head">
            <h2 className="admin-filter__title">筛选</h2>
            {activeFilters > 0 ? (
              <span className="admin-filter__count num">已应用 {activeFilters} 项</span>
            ) : null}
            <div className="admin-filter__actions">
              {compact ? (
                <button
                  type="button"
                  className="admin-btn admin-btn--ghost admin-btn--sm"
                  aria-expanded={filtersOpen}
                  onClick={() => setFiltersOpen((open) => !open)}
                >
                  {filtersOpen ? (
                    <ChevronUp size={14} strokeWidth={2} aria-hidden="true" />
                  ) : (
                    <ChevronDown size={14} strokeWidth={2} aria-hidden="true" />
                  )}
                  {filtersOpen ? "收起筛选" : "展开筛选"}
                </button>
              ) : null}
              <button className="admin-btn admin-btn--primary" type="submit">
                查询
              </button>
              <button className="admin-btn admin-btn--ghost" type="button" onClick={onReset}>
                重置
              </button>
            </div>
          </div>
          {showFields ? (
          <>
            {/* 复核状态：枚举筛选用段控件，点一下即生效，少一次「查询」。 */}
            <div className="admin-ledger__group">
              <span className="admin-ledger__grouplabel" id="admin-diagnosis-review-label">
                复核状态 · REVIEW
              </span>
              <div
                className="admin-ledger__chips"
                role="group"
                aria-labelledby="admin-diagnosis-review-label"
              >
                {DIAGNOSIS_REVIEW_FILTER_OPTIONS.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    className="admin-ledger__chip"
                    aria-pressed={query.review === option.value}
                    onClick={() => applyReviewFilter(option.value)}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="admin-filter__fields">
          <label className="admin-diagnosis__field admin-diagnosis__field--narrow">
            <span className="admin-diagnosis__label">疾病名 · RESULT</span>
            <input
              className="admin-diagnosis__input"
              type="text"
              value={resultDraft}
              onChange={(event) => setResultDraft(event.target.value)}
              placeholder="按疾病名模糊检索…"
              aria-label="疾病名"
            />
          </label>
          {/* 起止日期成对换行：拆到两行会让「自」和「至」分家。 */}
          <div className="admin-ledger__daterange">
          <label className="admin-diagnosis__field admin-diagnosis__field--narrow">
            <span className="admin-diagnosis__label">判读自 · FROM</span>
            <input
              className="admin-diagnosis__input"
              type="date"
              value={startDraft}
              onChange={(event) => setStartDraft(event.target.value)}
              aria-label="判读时间起"
            />
          </label>
          <label className="admin-diagnosis__field admin-diagnosis__field--narrow">
            <span className="admin-diagnosis__label">判读至 · TO</span>
            <input
              className="admin-diagnosis__input"
              type="date"
              value={endDraft}
              onChange={(event) => setEndDraft(event.target.value)}
              aria-label="判读时间止"
            />
          </label>
          </div>
            </div>
          </>
          ) : null}
        </form>
      </section>

      {/* 删除失败的页内读数：describeError 的文案，走全站故障语法。 */}
      {actionError ? (
        <FaultNote
          className="admin-diagnosis__fault"
          fault={fault({
            severity: "attention",
            kind: "client",
            title: actionError.text,
            code: actionError.code,
          })}
        />
      ) : null}

      {actionNote ? <p className="admin-diagnosis__note num">{actionNote}</p> : null}

      <BatchBar count={selectedIds.length} onClear={() => setSelectedIds([])} label="判读记录批量操作">
        <button
          type="button"
          className="admin-btn admin-btn--danger"
          disabled={batchBusy}
          onClick={runBatchDelete}
        >
          批量删除
        </button>
      </BatchBar>

      <section className="admin-diagnosis__table" aria-label="判读记录列表">
        <DataTable<AdminDiagnosis>
          columns={columns}
          rows={rows}
          rowKey={(row) => row.id}
          loading={listQuery.isPending}
          error={listFault?.text ?? null}
          emptyText="暂无判读记录"
          emptyContent={
            <AdminEmpty
              icon={ScanEye}
              title="还没有判读记录"
              description={
                activeFilters > 0
                  ? "当前筛选条件下没有记录。放宽疾病名、复核状态或时间范围后再看。"
                  : "患者完成一次影像判读后，记录会出现在这里，等待人工复核。"
              }
            />
          }
          page={{ current: page.current, pageSize: page.pageSize, total }}
          onPageChange={onPageChange}
          sort={sort}
          onSortChange={(next) => {
            setActionError(null)
            setPage((prev) => ({ ...prev, current: 1 }))
            setSelectedIds([])
            setSort(next)
          }}
          selectable
          selectedKeys={selectedIds}
          onSelectionChange={setSelectedIds}
        />
      </section>

      <p className="admin-diagnosis__footer num">
        列出的是全站判读记录（管理员视角，后端按角色放行）
      </p>

      {/* 详情 Drawer：加载 / 错误态在 Drawer 内处理，底部常驻人工复核入口。 */}
      <Drawer open={detailTarget != null} title="判读详情" onClose={closeDetail}>
        {detailBody()}
        <div className="admin-diagnosis__drawer-actions">
          <button type="button" className="admin-btn admin-btn--primary" onClick={openReview}>
            人工复核
          </button>
        </div>
      </Drawer>

      {/* 复核 Modal：只收 human* 字段，AI 判读字段界面上无任何输入。 */}
      <Modal
        open={reviewOpen}
        title="人工复核"
        onClose={closeReview}
        footer={
          <>
            <button
              type="button"
              className="admin-btn admin-btn--ghost"
              onClick={closeReview}
              disabled={submitting}
            >
              取消
            </button>
            <button
              type="button"
              className="admin-btn admin-btn--primary"
              onClick={confirmReview}
              disabled={submitting || reviewResultEmpty}
            >
              {submitting ? "提交中…" : "提交复核"}
            </button>
          </>
        }
      >
        <div className="admin-diagnosis__review">
          <p className="admin-diagnosis__review-note">
            仅填写人工复核结论；AI 判读字段只读，不予修改。
          </p>

          <label className="admin-diagnosis__review-field">
            <span className="admin-diagnosis__review-label">
              人工结论 · HUMAN RESULT（必填）
            </span>
            <textarea
              className="admin-diagnosis__review-input"
              value={humanResult}
              onChange={(event) => setHumanResult(event.target.value)}
              rows={3}
              aria-label="人工结论"
            />
          </label>
          {reviewResultEmpty ? (
            <p className="admin-diagnosis__review-hint">人工结论为必填项，填写后方可提交。</p>
          ) : null}

          <label className="admin-diagnosis__review-field">
            <span className="admin-diagnosis__review-label">
              人工严重程度 · HUMAN SEVERITY
            </span>
            <select
              className="admin-diagnosis__review-select"
              value={humanSeverity}
              onChange={(event) => setHumanSeverity(event.target.value)}
              aria-label="人工严重程度"
            >
              {HUMAN_SEVERITY.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          <label className="admin-diagnosis__review-field">
            <span className="admin-diagnosis__review-label">
              人工建议 · HUMAN RECOMMENDATIONS
            </span>
            <textarea
              className="admin-diagnosis__review-input"
              value={humanRecommendations}
              onChange={(event) => setHumanRecommendations(event.target.value)}
              rows={3}
              aria-label="人工建议"
            />
          </label>

          <label className="admin-diagnosis__review-field">
            <span className="admin-diagnosis__review-label">
              复核备注 · HUMAN REVIEW NOTE
            </span>
            <textarea
              className="admin-diagnosis__review-input"
              value={humanReviewNote}
              onChange={(event) => setHumanReviewNote(event.target.value)}
              rows={3}
              aria-label="复核备注"
            />
          </label>

          {reviewError ? (
            <FaultNote
              className="admin-diagnosis__review-fault"
              fault={fault({
                severity: "attention",
                kind: "client",
                title: reviewError.text,
                code: reviewError.code,
              })}
            />
          ) : null}
        </div>
      </Modal>

      {/* 删除确认 Modal。 */}
      <Modal
        open={deleteTarget != null}
        title="删除判读记录"
        onClose={closeDelete}
        footer={
          <>
            <button
              type="button"
              className="admin-btn admin-btn--ghost"
              onClick={closeDelete}
              disabled={deleting}
            >
              取消
            </button>
            <button
              type="button"
              className="admin-btn admin-btn--danger"
              onClick={confirmDelete}
              disabled={deleting}
            >
              {deleting ? "删除中…" : "确认删除"}
            </button>
          </>
        }
      >
        {deleteTarget ? (
          <p className="admin-diagnosis__modal-text">
            确定删除判读记录{" "}
            <span className="admin-diagnosis__modal-id num">{deleteTarget.id}</span>{" "}
            吗？此操作不可撤销。
          </p>
        ) : null}
      </Modal>
    </div>
  )
}

export default AdminDiagnosisPage
