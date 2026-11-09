import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactElement } from "react"
import { useNavigate } from "react-router-dom"

import { SectionHead } from "@/components/SectionHead"
import { DataTable, type Column } from "@/components/admin/DataTable"
import { Toolbar } from "@/components/admin/Toolbar"
import { Modal } from "@/components/admin/Modal"
import { FaultNote } from "@/components/fault"
import { deleteNews, listAdminNews, type AdminNews, type Page } from "@/lib/adminApi"
import { describeError, type ErrorDetail } from "@/lib/api"
import { fault } from "@/lib/faults"

const DEFAULT_PAGE_SIZE = 10
const SUMMARY_LIMIT = 40

type Params = { current: number; pageSize: number; title?: string }
/** 加载 / 错误 / 数据三态的全部来源；不在各事件里散着维护布尔量。 */
type View = { data: Page<AdminNews> | null; fault: ErrorDetail | null; loading: boolean }

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

  // 输入草稿与「已应用的查询」分开：打字不触发请求，回车 / 查询按钮才提交。
  const [titleDraft, setTitleDraft] = useState("")
  const [query, setQuery] = useState("")
  const [page, setPage] = useState({ current: 1, pageSize: DEFAULT_PAGE_SIZE })

  const [view, setView] = useState<View>({ data: null, fault: null, loading: true })
  // 递增序号挡住过期响应：并发 / StrictMode 双挂载下只有最后一次请求能写 view。
  const requestSeq = useRef(0)

  const [deleteTarget, setDeleteTarget] = useState<AdminNews | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [actionError, setActionError] = useState<ErrorDetail | null>(null)

  /** 纯取数：不碰 state，只返回当前序号，供续体判断是否仍是最后一次请求。 */
  const fetchNews = useCallback((params: Params): { seq: number; result: Promise<Page<AdminNews>> } => {
    const seq = ++requestSeq.current
    return { seq, result: listAdminNews(params) }
  }, [])

  // 首次挂载加载一次：初始 view 已是 loading=true，effect 里只发请求、不写 state。
  // setState 全在 Promise 续体（异步回调）里，符合 react-hooks/set-state-in-effect。
  useEffect(() => {
    const { seq, result } = fetchNews({ current: 1, pageSize: DEFAULT_PAGE_SIZE })
    result.then(
      (data) => {
        if (seq === requestSeq.current) {
          setView({ data: { ...data, records: data.records ?? [] }, fault: null, loading: false })
        }
      },
      (cause) => {
        if (seq === requestSeq.current) {
          setView({ data: null, fault: describeError(cause), loading: false })
        }
      },
    )
  }, [fetchNews])

  function toParams(nextPage = page, nextQuery = query): Params {
    return {
      current: nextPage.current,
      pageSize: nextPage.pageSize,
      ...(nextQuery ? { title: nextQuery } : {}),
    }
  }

  /** 事件驱动的取数入口：在事件里同步置 loading，再发请求（effect 只负责首次挂载）。 */
  function startLoad(nextPage = page, nextQuery = query) {
    setActionError(null) // 任何一次重新取数都清掉上一次删除失败的页内读数
    setView({ data: null, fault: null, loading: true })
    const { seq, result } = fetchNews(toParams(nextPage, nextQuery))
    result.then(
      (data) => {
        if (seq === requestSeq.current) {
          setView({ data: { ...data, records: data.records ?? [] }, fault: null, loading: false })
        }
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
    const nextQuery = titleDraft.trim()
    const nextPage = { ...page, current: 1 }
    setQuery(nextQuery)
    setPage(nextPage)
    startLoad(nextPage, nextQuery)
  }

  function onReset() {
    setTitleDraft("")
    const nextQuery = ""
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
      startLoad() // 成功后刷新当前页（含 loading 态归位）
    } catch (cause) {
      const detail = describeError(cause)
      setDeleteTarget(null) // 收起弹层，让页内提示露出来
      setActionError(detail)
    } finally {
      setDeleting(false)
    }
  }

  const columns: Column<AdminNews>[] = [
    { key: "id", title: "ID", width: "176px", mono: true },
    { key: "title", title: "标题", width: "180px" },
    { key: "summary", title: "摘要", render: (row) => truncateSummary(row.summary) },
    { key: "author", title: "作者", width: "120px" },
    { key: "publishTime", title: "发布时间", width: "180px", mono: true },
    {
      key: "action",
      title: "操作",
      width: "140px",
      render: (row) => (
        <div className="admin-news__row-actions">
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            onClick={() => navigate(`/admin/news/${row.id}/edit`)}
          >
            编辑
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

  return (
    <div className="admin-news">
      <div className="admin-news__head">
        <SectionHead code="03" kicker="新闻管理" en="ADMIN · NEWS" />
        <button
          type="button"
          className="btn btn--sm admin-news__new"
          onClick={() => navigate("/admin/news/new/edit")}
        >
          新建
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
          <div className="admin-news__actions">
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
          className="admin-news__fault"
          fault={fault({
            severity: "attention",
            kind: "client",
            title: actionError.text,
            code: actionError.code,
          })}
        />
      ) : null}

      <section className="admin-news__table" aria-label="新闻列表">
        <DataTable<AdminNews>
          columns={columns}
          rows={rows}
          rowKey={(row) => row.id ?? ""}
          loading={view.loading}
          error={view.fault?.text ?? null}
          emptyText="暂无新闻"
          page={{ current: page.current, pageSize: page.pageSize, total }}
          onPageChange={onPageChange}
        />
      </section>

      <Modal
        open={deleteTarget != null}
        title="删除新闻"
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
          <p className="admin-news__modal-text">
            确定删除新闻{" "}
            <span className="admin-news__modal-title">{deleteTarget.title || deleteTarget.id}</span>{" "}
            吗？此操作不可撤销。
          </p>
        ) : null}
      </Modal>
    </div>
  )
}

export default AdminNewsPage
