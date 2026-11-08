import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactElement,
  type ReactNode,
} from "react"

import { SectionHead } from "@/components/SectionHead"
import { DataTable, type Column } from "@/components/admin/DataTable"
import { Toolbar } from "@/components/admin/Toolbar"
import { Modal } from "@/components/admin/Modal"
import { Drawer } from "@/components/admin/Drawer"
import { RiskTag } from "@/components/RiskTag"
import { FaultNote } from "@/components/fault"
import {
  listDiagnoses,
  getDiagnosis,
  submitReview,
  deleteDiagnosis,
  type AdminDiagnosis,
  type Page,
} from "@/lib/adminApi"
import { reviewView } from "@/lib/adminDomain"
import { describeError, type ErrorDetail, type DiagnosisResult } from "@/lib/api"
import {
  severityLabel,
  formatTimestamp,
  fixed,
  normalizeConfidence,
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

type Query = string
type Params = { current: number; pageSize: number; result?: string }
/** 加载 / 错误 / 数据三态的全部来源；不在各事件里散着维护布尔量。 */
type View = { data: Page<AdminDiagnosis> | null; fault: ErrorDetail | null; loading: boolean }

/**
 * 置信度 → 百分比读数（一位小数）。
 *
 * 后端置信度可能是 0–1 概率，也可能是 0–100 百分数（见 domain.ts 的
 * normalizeConfidence 契约，rankClasses / RecordSheet 都先归一再用）。这里
 * 先过 normalizeConfidence 归一到 0–1，再 ×100；若后端回 85（百分数形态）
 * 也得 85.0% 而不是 8500.0%。列表列与 Drawer 详情（兜底链 confidence ??
 * probability）共用本函数，两处量纲因此都对齐既有原语。
 * 不另做数值转换（雪花 id 全程 string，页面里不出现任何 Number(...)）。
 */
function confidencePercent(value?: number): string {
  // undefined / NaN → 「—」：normalizeConfidence 会把它们收成 0，先拦掉，
  // 否则会误显示成「0.0%」。NaN 用自不等判定（value !== value），避免引入
  // Number(...) 调用。
  if (value === undefined || value !== value) return "—"
  const reading = fixed(normalizeConfidence(value) * 100, 1)
  return reading === "—" ? "—" : `${reading}%`
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
 * 详情 Drawer 与复核 Modal 会同时打开（Task 4 的弹层栈专为此设计）：复核只收
 * 四个 human* 字段，AI 判读字段界面上无任何输入。getDiagnosis 的加载 / 错误态
 * 在 Drawer 内自洽处理，另用 detailSeq 挡住快速开关时的过期响应。
 * 雪花 id 全程 string：列表 / 详情 / 复核 / 删除都不做 Number(id) 转换。
 */
export function AdminDiagnosisPage(): ReactElement {
  // 输入草稿与「已应用的查询」分开：打字不触发请求，回车 / 查询按钮才提交。
  const [resultDraft, setResultDraft] = useState("")
  const [query, setQuery] = useState<Query>("")
  const [page, setPage] = useState({ current: 1, pageSize: DEFAULT_PAGE_SIZE })

  const [view, setView] = useState<View>({ data: null, fault: null, loading: true })
  const requestSeq = useRef(0)

  const [deleteTarget, setDeleteTarget] = useState<AdminDiagnosis | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [actionError, setActionError] = useState<ErrorDetail | null>(null)

  const [detailTarget, setDetailTarget] = useState<AdminDiagnosis | null>(null)
  const [detail, setDetail] = useState<DiagnosisResult | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailFault, setDetailFault] = useState<ErrorDetail | null>(null)
  const detailSeq = useRef(0)

  const [reviewOpen, setReviewOpen] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [reviewError, setReviewError] = useState<ErrorDetail | null>(null)
  const [humanResult, setHumanResult] = useState("")
  const [humanSeverity, setHumanSeverity] = useState<string>("NOT_ASSESSED")
  const [humanRecommendations, setHumanRecommendations] = useState("")
  const [humanReviewNote, setHumanReviewNote] = useState("")

  /** 纯取数：不碰 state，只返回当前序号，供续体判断是否仍是最后一次请求。 */
  const fetchDiagnoses = useCallback(
    (params: Params): { seq: number; result: Promise<Page<AdminDiagnosis>> } => {
      const seq = ++requestSeq.current
      return { seq, result: listDiagnoses(params) }
    },
    [],
  )

  // 首次挂载加载一次：初始 view 已是 loading=true，effect 里只发请求、不写 state。
  // setState 全在 Promise 续体（异步回调）里，符合 react-hooks/set-state-in-effect。
  useEffect(() => {
    const { seq, result } = fetchDiagnoses({ current: 1, pageSize: DEFAULT_PAGE_SIZE })
    result.then(
      (data) => {
        if (seq === requestSeq.current) setView({ data, fault: null, loading: false })
      },
      (cause) => {
        if (seq === requestSeq.current) {
          setView({ data: null, fault: describeError(cause), loading: false })
        }
      },
    )
  }, [fetchDiagnoses])

  function toParams(nextPage = page, nextQuery = query): Params {
    return {
      current: nextPage.current,
      pageSize: nextPage.pageSize,
      ...(nextQuery ? { result: nextQuery } : {}),
    }
  }

  /** 事件驱动的取数入口：在事件里同步置 loading，再发请求（effect 只负责首次挂载）。 */
  function startLoad(nextPage = page, nextQuery = query) {
    setActionError(null) // 任何一次重新取数都清掉上一次删除失败的页内读数
    setView({ data: null, fault: null, loading: true })
    const { seq, result } = fetchDiagnoses(toParams(nextPage, nextQuery))
    result.then(
      (data) => {
        if (seq === requestSeq.current) setView({ data, fault: null, loading: false })
      },
      (cause) => {
        if (seq === requestSeq.current) {
          setView({ data: null, fault: describeError(cause), loading: false })
        }
      },
    )
  }

  function onSearch(event: FormEvent) {
    event.preventDefault()
    const nextQuery = resultDraft.trim()
    const nextPage = { ...page, current: 1 }
    setQuery(nextQuery)
    setPage(nextPage)
    startLoad(nextPage, nextQuery)
  }

  function onReset() {
    setResultDraft("")
    const nextQuery: Query = ""
    const nextPage = { ...page, current: 1 }
    setQuery(nextQuery)
    setPage(nextPage)
    startLoad(nextPage, nextQuery)
  }

  function onPageChange(next: { current: number; pageSize: number }) {
    // pageSize 变化一律回第 1 页（DataTable 已传 current:1，这里再钉死一次）。
    const nextPage =
      next.pageSize !== page.pageSize
        ? { current: 1, pageSize: next.pageSize }
        : { current: next.current, pageSize: next.pageSize }
    setPage(nextPage)
    startLoad(nextPage)
  }

  /* ── 详情 Drawer ──────────────────────────────────────────── */

  function openDetail(row: AdminDiagnosis) {
    const seq = ++detailSeq.current
    setActionError(null)
    setDetailTarget(row)
    setDetail(null)
    setDetailFault(null)
    setDetailLoading(true)
    setReviewOpen(false)
    setReviewError(null)
    getDiagnosis(row.id).then(
      (data) => {
        if (seq === detailSeq.current) {
          setDetail(data)
          setDetailLoading(false)
        }
      },
      (cause) => {
        if (seq === detailSeq.current) {
          setDetailFault(describeError(cause))
          setDetailLoading(false)
        }
      },
    )
  }

  /** 收起 Drawer 并作废仍在飞行的详情请求（快速开关时不让旧响应写回来）。 */
  function clearDetail() {
    ++detailSeq.current
    setDetailTarget(null)
    setDetail(null)
    setDetailFault(null)
    setDetailLoading(false)
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

        {detail.humanReviewNote ? (
          <section className="admin-diagnosis__section">
            <h3 className="admin-diagnosis__section-title">人工复核备注</h3>
            <p className="admin-diagnosis__note">{detail.humanReviewNote}</p>
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
      startLoad()
    } catch (cause) {
      // 失败：保持弹层不丢已填内容，按 Task 7 的 describeError → fault → FaultNote 语法页内提示。
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
      startLoad() // 成功后刷新当前页（含 loading 态归位）
    } catch (cause) {
      const detail = describeError(cause)
      setDeleteTarget(null) // 收起弹层，让页内提示露出来
      setActionError(detail)
    } finally {
      setDeleting(false)
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
      width: "140px",
      render: (row) => (
        <div className="admin-diagnosis__row-actions">
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            onClick={() => openDetail(row)}
          >
            详情
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

  // 三态同源：loading / error / 数据都从 view 读；加载与出错时 rows 都是 undefined。
  const rows = view.data?.records
  const total = view.data?.total ?? 0
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

      <section className="admin-diagnosis__table" aria-label="判读记录列表">
        <DataTable<AdminDiagnosis>
          columns={columns}
          rows={rows}
          rowKey={(row) => row.id}
          loading={view.loading}
          error={view.fault?.text ?? null}
          emptyText="暂无判读记录"
          page={{ current: page.current, pageSize: page.pageSize, total }}
          onPageChange={onPageChange}
        />
      </section>

      <p className="admin-diagnosis__footer num">
        列出的是你名下的判读记录（后端数据边界，见设计文档 §7）
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
