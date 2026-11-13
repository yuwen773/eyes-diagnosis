import { useMemo, useState, type FormEvent, type ReactElement } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { useNavigate, useSearchParams } from "react-router-dom"

import { SectionHead } from "@/components/SectionHead"
import { DataTable, type Column, type SortState } from "@/components/admin/DataTable"
import { Toolbar } from "@/components/admin/Toolbar"
import { Modal } from "@/components/admin/Modal"
import { BatchBar } from "@/components/admin/BatchBar"
import { RiskTag } from "@/components/RiskTag"
import { FaultNote } from "@/components/fault"
import {
  changeNewsStatusBatch,
  deleteNews,
  deleteNewsBatch,
  listAdminNews,
  type AdminNews,
  type BatchResult,
  type NewsQuery,
} from "@/lib/adminApi"
import { newsStatusView, NEWS_STATUS_OPTIONS } from "@/lib/adminDomain"
import { describeError, type ErrorDetail } from "@/lib/api"
import { queryKeys } from "@/lib/queryKeys"
import { fault } from "@/lib/faults"

const DEFAULT_PAGE_SIZE = 10
const SUMMARY_LIMIT = 40

/** 已应用的筛选条件。 */
type Query = { title: string; status: string; startDate: string; endDate: string }
type Params = NewsQuery

/** 摘要截 40 字，超出补「…」；空值走表格统一的「—」占位。 */
function truncateSummary(value?: string): string {
  if (!value) return "—"
  return value.length > SUMMARY_LIMIT ? `${value.slice(0, SUMMARY_LIMIT)}…` : value
}

/**
 * 新闻管理（真实端点）。
 *
 * 结构逐字对齐用户管理页：取数事件驱动、唯一 load 由查询 / 重置 / 翻页 /
 * 删除成功后刷新调用，首次挂载只用一个 useEffect 加载一次；三态从 view 派生，
 * 用 requestSeq 递增序号挡住过期响应；删除走确认 Modal + deleting 锁；
 * 删除失败收起弹层、改用 FaultNote 页内读数。
 * 雪花 id 全程 string：列表 / 删除请求路径 / 跳编辑页都不做 Number(id) 转换。
 */
export function AdminNewsPage(): ReactElement {
  const navigate = useNavigate()
  // 下钻入口：仪表盘的「资讯待审核」带 ?status=3 进来，直接落到待审核筛选上。
  const [searchParams] = useSearchParams()
  const initialStatus = ((): string => {
    const value = searchParams.get("status")
    return value !== null && NEWS_STATUS_OPTIONS.some((option) => String(option.value) === value)
      ? value
      : ""
  })()

  // 输入草稿与「已应用的查询」分开：打字不触发请求，回车 / 查询按钮才提交。
  const [titleDraft, setTitleDraft] = useState("")
  const [statusDraft, setStatusDraft] = useState(initialStatus)
  const [startDraft, setStartDraft] = useState("")
  const [endDraft, setEndDraft] = useState("")
  const [query, setQuery] = useState<Query>({
    title: "",
    status: initialStatus,
    startDate: "",
    endDate: "",
  })
  const [page, setPage] = useState({ current: 1, pageSize: DEFAULT_PAGE_SIZE })
  // 服务端排序：字段必须落在后端白名单里。
  const [sort, setSort] = useState<SortState>(null)

  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [deleteTarget, setDeleteTarget] = useState<AdminNews | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [actionError, setActionError] = useState<ErrorDetail | null>(null)
  const [actionNote, setActionNote] = useState<string | null>(null)
  const [batchBusy, setBatchBusy] = useState(false)

  const queryClient = useQueryClient()

  /** 已应用的筛选 + 分页：同时是查询键和请求体。 */
  const { current, pageSize } = page
  const params = useMemo<Params>(
    () => ({
      current,
      pageSize,
      ...(query.title ? { title: query.title } : {}),
      ...(query.status ? { status: Number(query.status) } : {}),
      ...(query.startDate ? { startDate: query.startDate } : {}),
      ...(query.endDate ? { endDate: query.endDate } : {}),
      ...(sort ? { sortField: sort.field, sortOrder: sort.order } : {}),
    }),
    [current, pageSize, query, sort],
  )

  const listQuery = useQuery({
    queryKey: queryKeys.admin.news(params),
    queryFn: () => listAdminNews(params),
  })
  const listFault = listQuery.error ? describeError(listQuery.error) : null

  /** 写操作成功后失效资讯域与统计域（待审核数在仪表盘上）。 */
  const refreshNews = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.admin.newsAll }),
      queryClient.invalidateQueries({ queryKey: queryKeys.admin.statsAll }),
    ])

  function onSearch(event: FormEvent) {
    event.preventDefault()
    setActionError(null)
    setQuery({
      title: titleDraft.trim(),
      status: statusDraft,
      startDate: startDraft,
      endDate: endDraft,
    })
    setPage((prev) => ({ ...prev, current: 1 }))
    setSelectedIds([])
  }

  function onReset() {
    setTitleDraft("")
    setStatusDraft("")
    setStartDraft("")
    setEndDraft("")
    setActionError(null)
    setQuery({ title: "", status: "", startDate: "", endDate: "" })
    setPage((prev) => ({ ...prev, current: 1 }))
    setSelectedIds([])
    setSort(null)
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

  function openDelete(row: AdminNews) {
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
    const id = target.id
    if (!id) return // 缺 id 的空白行不该发出带空路径的请求
    setDeleting(true)
    setActionError(null)
    try {
      await deleteNews(id) // 雪花 id 全程保持 string，绝不转成数字
      setDeleteTarget(null)
      setSelectedIds((prev) => prev.filter((item) => item !== id))
      await refreshNews()
    } catch (cause) {
      const detail = describeError(cause)
      setDeleteTarget(null) // 收起弹层，让页内提示露出来
      setActionError(detail)
    } finally {
      setDeleting(false)
    }
  }

  /** 批量动作：逐条执行，部分失败如实回执。 */
  async function runBatch(
    label: string,
    action: () => Promise<BatchResult>,
  ) {
    if (batchBusy || selectedIds.length === 0) return
    setBatchBusy(true)
    setActionError(null)
    setActionNote(null)
    try {
      const result = await action()
      const succeeded = result.succeeded ?? 0
      const failed = result.failed ?? 0
      setActionNote(
        failed > 0
          ? `${label}：成功 ${succeeded} 篇，失败 ${failed} 篇。${result.message ?? ""}`
          : `${label}：成功 ${succeeded} 篇。`,
      )
      if (failed === 0) setSelectedIds([])
      await refreshNews()
    } catch (cause) {
      setActionError(describeError(cause))
    } finally {
      setBatchBusy(false)
    }
  }

  const columns: Column<AdminNews>[] = [
    { key: "id", title: "ID", width: "176px", mono: true, sortable: true },
    { key: "title", title: "标题", width: "180px", sortable: true },
    { key: "summary", title: "摘要", render: (row) => truncateSummary(row.summary) },
    {
      key: "status",
      title: "状态",
      width: "104px",
      sortable: true,
      render: (row) => {
        // status 由后端 NewsVO 暴露（0 草稿 / 3 待审核 / 1 已发布 / 2 下架）；缺省读「未知」。
        const view = newsStatusView(row.status)
        return <RiskTag risk={view.risk}>{view.label}</RiskTag>
      },
    },
    { key: "author", title: "作者", width: "120px" },
    { key: "publishTime", title: "发布时间", width: "180px", mono: true, sortable: true },
    {
      key: "action",
      title: "操作",
      width: "140px",
      render: (row) => (
        <div className="admin-news__row-actions">
          <button
            type="button"
            className="admin-btn admin-btn--ghost"
            onClick={() => navigate(`/admin/news/${row.id}/edit`)}
          >
            编辑
          </button>
          <button
            type="button"
            className="admin-btn admin-btn--ghost"
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

  return (
    <div className="admin-news">
      <div className="admin-news__head">
        <SectionHead code="03" kicker="新闻管理" en="ADMIN · NEWS" />
        <button
          type="button"
          className="admin-btn admin-btn--primary admin-news__new"
          onClick={() => navigate("/admin/news/new/edit")}
        >
          新建资讯
        </button>
      </div>

      <Toolbar>
        <form className="admin-news__form" onSubmit={onSearch}>
          <label className="admin-news__field">
            <span className="admin-news__label">标题 · TITLE</span>
            <input
              className="admin-news__input"
              type="text"
              value={titleDraft}
              onChange={(event) => setTitleDraft(event.target.value)}
              placeholder="按标题模糊检索…"
              aria-label="标题"
            />
          </label>
          <label className="admin-news__field admin-news__field--narrow">
            <span className="admin-news__label">状态 · STATUS</span>
            <select
              className="admin-news__input"
              value={statusDraft}
              onChange={(event) => setStatusDraft(event.target.value)}
              aria-label="发布状态"
            >
              <option value="">全部状态</option>
              {NEWS_STATUS_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label className="admin-news__field admin-news__field--narrow">
            <span className="admin-news__label">发布自 · FROM</span>
            <input
              className="admin-news__input"
              type="date"
              value={startDraft}
              onChange={(event) => setStartDraft(event.target.value)}
              aria-label="发布时间起"
            />
          </label>
          <label className="admin-news__field admin-news__field--narrow">
            <span className="admin-news__label">发布至 · TO</span>
            <input
              className="admin-news__input"
              type="date"
              value={endDraft}
              onChange={(event) => setEndDraft(event.target.value)}
              aria-label="发布时间止"
            />
          </label>
          <div className="admin-news__actions">
            <button className="admin-btn admin-btn--primary" type="submit">
              查询
            </button>
            <button className="admin-btn admin-btn--ghost" type="button" onClick={onReset}>
              重置
            </button>
          </div>
        </form>
      </Toolbar>

      {actionError ? (
        <FaultNote
          className="admin-news__fault"
          fault={fault({
            severity: "attention",
            kind: "client",
            title: actionError.text,
            code: actionError.code,
          })}
        />
      ) : null}

      {actionNote ? <p className="admin-news__note num">{actionNote}</p> : null}

      <BatchBar count={selectedIds.length} onClear={() => setSelectedIds([])} label="资讯批量操作">
        <button
          type="button"
          className="admin-btn admin-btn--primary"
          disabled={batchBusy}
          onClick={() => runBatch("批量发布", () => changeNewsStatusBatch(selectedIds, 1))}
        >
          批量发布
        </button>
        <button
          type="button"
          className="admin-btn admin-btn--ghost"
          disabled={batchBusy}
          onClick={() => runBatch("批量下架", () => changeNewsStatusBatch(selectedIds, 2))}
        >
          批量下架
        </button>
        <button
          type="button"
          className="admin-btn admin-btn--ghost"
          disabled={batchBusy}
          onClick={() => runBatch("批量删除", () => deleteNewsBatch(selectedIds))}
        >
          批量删除
        </button>
      </BatchBar>

      <section className="admin-news__table" aria-label="资讯列表">
        <DataTable<AdminNews>
          columns={columns}
          rows={rows}
          rowKey={(row) => row.id ?? ""}
          loading={listQuery.isPending}
          error={listFault?.text ?? null}
          emptyText="暂无资讯"
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
          isRowSelectable={(row) => !!row.id}
        />
      </section>

      <Modal
        open={deleteTarget != null}
        title="删除资讯"
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
              className="admin-btn admin-btn--primary"
              onClick={confirmDelete}
              disabled={deleting}
            >
              {deleting ? "删除中…" : "确认删除"}
            </button>
          </>
        }
      >
        {deleteTarget ? (
          <p className="admin-news__modal-text">
            确定删除资讯{" "}
            <span className="admin-news__modal-title">{deleteTarget.title}</span>{" "}
            吗？删除后不可恢复。
          </p>
        ) : null}
      </Modal>
    </div>
  )
}

export default AdminNewsPage
