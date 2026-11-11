import {
  useMemo,
  useState,
  type FormEvent,
  type ReactElement,
  type ReactNode,
} from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { useSearchParams } from "react-router-dom"

import { SectionHead } from "@/components/SectionHead"
import { DataTable, type Column } from "@/components/admin/DataTable"
import { Toolbar } from "@/components/admin/Toolbar"
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
} from "@/lib/domain"
import { fault } from "@/lib/faults"

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
    <div className="admin-diagnosis__fact">
      <dt className="admin-diagnosis__fact-label">{label}</dt>
      <dd className={"admin-diagnosis__fact-value" + (mono ? " num" : "")}>{value}</dd>
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
  const [reviewDraft, setReviewDraft] = useState<DiagnosisReviewFilter>(initialReview)
  const [startDraft, setStartDraft] = useState("")
  const [endDraft, setEndDraft] = useState("")
  const [query, setQuery] = useState<Query>({
    result: "",
    review: initialReview,
    startDate: "",
    endDate: "",
  })
  const [page, setPage] = useState({ current: 1, pageSize: DEFAULT_PAGE_SIZE })

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
    }),
    [current, pageSize, query],
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
      review: reviewDraft,
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
    setReviewDraft("")
    setStartDraft("")
    setEndDraft("")
    setActionError(null)
    setQuery({ result: "", review: "", startDate: "", endDate: "" })
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
    return (
      <div className="admin-diagnosis__detail">
        {detail.url ? (
          <figure className="admin-diagnosis__detail-figure">
            <img
              className="admin-diagnosis__detail-img"
              src={detail.url}
              alt="判读影像"
              loading="lazy"
            />
            <figcaption className="num">影像 · SOURCE</figcaption>
          </figure>
        ) : (
          <p className="admin-diagnosis__detail-noimg num">— · 无影像</p>
        )}

        <dl className="admin-diagnosis__facts">
          <FactRow label="结果" value={detail.result || "—"} />
          <FactRow
            label="置信度"
            value={confidencePercent(detail.confidence ?? detail.probability)}
            mono
          />
          <FactRow label="严重程度" value={severityLabel(detail.severity)} />
          <FactRow label="模型版本" value={detail.modelVersion || "—"} mono />
          <FactRow label="预处理版本" value={detail.preprocessVersion || "—"} mono />
          <FactRow label="推理策略版本" value={detail.inferencePolicyVersion || "—"} mono />
          <FactRow
            label="人工复核状态"
            value={humanReviewStatusLabel(detail.humanReviewStatus)}
          />
        </dl>

        <section className="admin-diagnosis__section">
          <h3 className="admin-diagnosis__section-title">建议 · RECOMMENDATIONS</h3>
          {recos.length > 0 ? (
            <ol className="admin-diagnosis__recos">
              {recos.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ol>
          ) : (
            <p className="admin-diagnosis__note">—</p>
          )}
        </section>

        {detail.abstainReason ? (
          <section className="admin-diagnosis__section">
            <h3 className="admin-diagnosis__section-title">AI 拒识原因</h3>
            <p className="admin-diagnosis__note">{detail.abstainReason}</p>
          </section>
        ) : null}

        {hasHumanReview ? (
          <section className="admin-diagnosis__section">
            <h3 className="admin-diagnosis__section-title">人工复核记录 · HUMAN REVIEW</h3>
            <dl className="admin-diagnosis__facts">
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
    { key: "id", title: "ID", width: "176px", mono: true },
    {
      key: "url",
      title: "诊断图像",
      width: "76px",
      render: (row) =>
        row.url ? (
          <img
            className="admin-diagnosis__thumb"
            src={row.url}
            alt={`判读影像 ${row.id}`}
            width={48}
            height={48}
            loading="lazy"
          />
        ) : (
          "—"
        ),
    },
    { key: "username", title: "用户", width: "120px" },
    {
      key: "result",
      title: "结果",
      render: (row) =>
        row.result ? (
          row.result
        ) : (
          // AI 拒识行 result 为空 → 「—」+ 拒识原因摘要（完整原因在 title 与详情里）。
          <span className="admin-diagnosis__result-empty">
            <span>—</span>
            {row.abstainReason ? (
              <span className="admin-diagnosis__abstain" title={row.abstainReason}>
                拒识 · {truncate(row.abstainReason, ABSTAIN_LIMIT)}
              </span>
            ) : null}
          </span>
        ),
    },
    {
      key: "confidence",
      title: "置信度",
      width: "96px",
      mono: true,
      render: (row) => confidencePercent(row.confidence),
    },
    {
      key: "review",
      title: "复审状态",
      width: "126px",
      // 直接消费 reviewView 的映射，不在此另写一套：AI 拒识 / 待人工复核 /
      // 复审中 / 已复审 / 未复审 的优先级与风险档全部由它裁决。
      render: (row) => {
        const v = reviewView(row)
        return <RiskTag risk={v.risk}>{v.label}</RiskTag>
      },
    },
    {
      key: "createTime",
      title: "时间",
      width: "160px",
      mono: true,
      render: (row) => formatTimestamp(row.createTime),
    },
    {
      key: "action",
      title: "操作",
      width: "196px",
      render: (row) => (
        <div className="admin-diagnosis__row-actions">
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            onClick={() => openDetail(row)}
          >
            详情
          </button>
          {/* 复核是这张表的主动作之一：不该藏在详情抽屉底部，得在行上直接点得到。 */}
          <button
            type="button"
            className="btn btn--sm"
            onClick={() => {
              openDetail(row)
              openReview()
            }}
          >
            复核
          </button>
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            onClick={() => openDelete(row)}
          >
            删除
          </button>
        </div>
      ),
    },
  ]

  // 三态同源：loading / error / 数据都从同一个查询读；加载与出错时 rows 都是 undefined。
  const rows = listQuery.data?.records
  const total = listQuery.data?.total ?? 0
  const reviewResultEmpty = humanResult.trim().length === 0

  return (
    <div className="admin-diagnosis">
      <div className="admin-diagnosis__head">
        <SectionHead code="04" kicker="诊断管理" en="ADMIN · DIAGNOSIS" />
      </div>

      <Toolbar>
        <form className="admin-diagnosis__form" onSubmit={onSearch}>
          <label className="admin-diagnosis__field">
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
          <label className="admin-diagnosis__field admin-diagnosis__field--narrow">
            <span className="admin-diagnosis__label">复核状态 · REVIEW</span>
            <select
              className="admin-diagnosis__input"
              value={reviewDraft}
              onChange={(event) => setReviewDraft(event.target.value as DiagnosisReviewFilter)}
              aria-label="复核状态"
            >
              {DIAGNOSIS_REVIEW_FILTER_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
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
          <div className="admin-diagnosis__actions">
            <button className="btn btn--sm" type="submit">
              查询
            </button>
            <button className="btn btn--ghost btn--sm" type="button" onClick={onReset}>
              重置
            </button>
          </div>
        </form>
      </Toolbar>

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
          className="btn btn--sm"
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
          page={{ current: page.current, pageSize: page.pageSize, total }}
          onPageChange={onPageChange}
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
          <button type="button" className="btn btn--sm" onClick={openReview}>
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
              className="btn btn--ghost btn--sm"
              onClick={closeReview}
              disabled={submitting}
            >
              取消
            </button>
            <button
              type="button"
              className="btn btn--sm"
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
              className="btn btn--ghost btn--sm"
              onClick={closeDelete}
              disabled={deleting}
            >
              取消
            </button>
            <button
              type="button"
              className="btn btn--sm"
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
