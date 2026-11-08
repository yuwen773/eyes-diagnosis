import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactElement } from "react"

import { SectionHead } from "@/components/SectionHead"
import { DataTable, type Column } from "@/components/admin/DataTable"
import { Toolbar } from "@/components/admin/Toolbar"
import { Modal } from "@/components/admin/Modal"
import { FaultNote } from "@/components/fault"
import { deleteUser, listUsers, type AdminUser, type Page } from "@/lib/adminApi"
import { canDeleteUser } from "@/lib/adminDomain"
import { describeError, type ErrorDetail } from "@/lib/api"
import { fault } from "@/lib/faults"

const DEFAULT_PAGE_SIZE = 10

type Query = { userAccount: string; userName: string }
type Params = { current: number; pageSize: number; userAccount?: string; userName?: string }
/** 加载 / 错误 / 数据三态的全部来源；不在各事件里散着维护布尔量。 */
type View = { data: Page<AdminUser> | null; fault: ErrorDetail | null; loading: boolean }

/** 角色 → 风险档 + 中文标签。只吃 --risk-* 语义色，与品牌信号橙解耦。 */
const ROLE_VIEW: Record<string, { label: string; risk: string }> = {
  admin: { label: "管理员", risk: "attention" },
  user: { label: "普通用户", risk: "normal" },
  ban: { label: "已封禁", risk: "critical" },
}

function roleTag(role?: string): ReactElement {
  const known = role ? ROLE_VIEW[role] : undefined
  // 未知角色走 .risk[data-risk="unknown"] 的 default 档，并原样显示后端给的值。
  return (
    <span className="risk" data-risk={known ? known.risk : "unknown"}>
      {known ? known.label : role || "—"}
    </span>
  )
}

/**
 * 用户管理（真实端点）。
 *
 * 取数是事件驱动的：唯一的 load() 由查询 / 重置 / 翻页 / 删除成功后刷新调用，
 * 首次挂载只用一个 useEffect 加载一次。三态全部从 view 派生，按 DataTable 的
 * 自然接线把 rows（加载/出错时为 undefined）、error（describeError 的 text）、
 * loading 一起交给表格——出错时 error 优先于隐式 loading，文案可达。
 */
export function AdminUsersPage(): ReactElement {
  // 输入草稿与「已应用的查询」分开：打字不触发请求，回车 / 查询按钮才提交。
  const [accountDraft, setAccountDraft] = useState("")
  const [nameDraft, setNameDraft] = useState("")
  const [query, setQuery] = useState<Query>({ userAccount: "", userName: "" })
  const [page, setPage] = useState({ current: 1, pageSize: DEFAULT_PAGE_SIZE })

  const [view, setView] = useState<View>({ data: null, fault: null, loading: true })
  // 递增序号挡住过期响应：并发 / StrictMode 双挂载下只有最后一次请求能写 view。
  const requestSeq = useRef(0)

  const [deleteTarget, setDeleteTarget] = useState<AdminUser | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [actionError, setActionError] = useState<ErrorDetail | null>(null)

  /** 纯取数：不碰 state，只返回当前序号，供续体判断是否仍是最后一次请求。 */
  const fetchUsers = useCallback((params: Params): { seq: number; result: Promise<Page<AdminUser>> } => {
    const seq = ++requestSeq.current
    return { seq, result: listUsers(params) }
  }, [])

  // 首次挂载加载一次：初始 view 已是 loading=true，effect 里只发请求、不写 state。
  // setState 全在 Promise 续体（异步回调）里，符合 react-hooks/set-state-in-effect。
  useEffect(() => {
    const { seq, result } = fetchUsers({ current: 1, pageSize: DEFAULT_PAGE_SIZE })
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
  }, [fetchUsers])

  function toParams(nextPage = page, nextQuery = query): Params {
    return {
      current: nextPage.current,
      pageSize: nextPage.pageSize,
      ...(nextQuery.userAccount ? { userAccount: nextQuery.userAccount } : {}),
      ...(nextQuery.userName ? { userName: nextQuery.userName } : {}),
    }
  }

  /** 事件驱动的取数入口：在事件里同步置 loading，再发请求（effect 只负责首次挂载）。 */
  function startLoad(nextPage = page, nextQuery = query) {
    setView({ data: null, fault: null, loading: true })
    const { seq, result } = fetchUsers(toParams(nextPage, nextQuery))
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
    const nextQuery = { userAccount: accountDraft.trim(), userName: nameDraft.trim() }
    const nextPage = { ...page, current: 1 }
    setQuery(nextQuery)
    setPage(nextPage)
    startLoad(nextPage, nextQuery)
  }

  function onReset() {
    setAccountDraft("")
    setNameDraft("")
    const nextQuery: Query = { userAccount: "", userName: "" }
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

  function openDelete(row: AdminUser) {
    // 二次兜底：即便按钮被绕过，管理员账号也不会进入确认流程。
    if (!canDeleteUser(row)) return
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
      await deleteUser(target.id) // 雪花 id 全程保持 string，绝不转成数字
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

  const columns: Column<AdminUser>[] = [
    { key: "id", title: "ID", width: "176px", mono: true },
    { key: "userAccount", title: "账号", width: "132px" },
    { key: "userName", title: "用户名", width: "120px" },
    {
      key: "userAvatar",
      title: "头像",
      width: "76px",
      render: (row) =>
        row.userAvatar ? (
          <img
            className="admin-users__avatar"
            src={row.userAvatar}
            alt={row.userName || row.userAccount || "头像"}
            width={32}
            height={32}
            loading="lazy"
          />
        ) : (
          <span className="admin-users__avatar-fallback" aria-hidden="true" />
        ),
    },
    { key: "userProfile", title: "简介" },
    { key: "userRole", title: "角色", width: "116px", render: (row) => roleTag(row.userRole) },
    { key: "createTime", title: "创建时间", width: "180px", mono: true },
    {
      key: "action",
      title: "操作",
      width: "100px",
      render: (row) => {
        const allowed = canDeleteUser(row)
        return (
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            disabled={!allowed}
            title={allowed ? undefined : "无法操作管理员账号"}
            onClick={() => openDelete(row)}
          >
            删除
          </button>
        )
      },
    },
  ]

  // 三态同源：loading / error / 数据都从 view 读；加载与出错时 rows 都是 undefined。
  const rows = view.data?.records
  const total = view.data?.total ?? 0

  return (
    <div className="admin-users">
      <div className="admin-users__head">
        <SectionHead code="02" kicker="用户管理" en="ADMIN · USERS" />
      </div>

      <Toolbar>
        <form className="admin-users__form" onSubmit={onSearch}>
          <label className="admin-users__field">
            <span className="admin-users__label">账号 · ACCOUNT</span>
            <input
              className="admin-users__input"
              type="text"
              value={accountDraft}
              onChange={(event) => setAccountDraft(event.target.value)}
              placeholder="按账号模糊检索…"
              aria-label="账号"
            />
          </label>
          <label className="admin-users__field">
            <span className="admin-users__label">用户名 · NAME</span>
            <input
              className="admin-users__input"
              type="text"
              value={nameDraft}
              onChange={(event) => setNameDraft(event.target.value)}
              placeholder="按用户名模糊检索…"
              aria-label="用户名"
            />
          </label>
          <div className="admin-users__actions">
            <button className="btn btn--sm" type="submit">
              查询
            </button>
            <button className="btn btn--ghost btn--sm" type="button" onClick={onReset}>
              重置
            </button>
          </div>
        </form>
      </Toolbar>

      {/* 删除失败的页内读数：describeError 的文案，走全站故障语法（等宽标签 +
          结论 + 状态码，只吃 --risk-* 语义色），不是临时拼的一句话。 */}
      {actionError ? (
        <FaultNote
          className="admin-users__fault"
          fault={fault({
            severity: "attention",
            kind: "client",
            title: actionError.text,
            code: actionError.code,
          })}
        />
      ) : null}

      <section className="admin-users__table" aria-label="用户列表">
        <DataTable<AdminUser>
          columns={columns}
          rows={rows}
          rowKey={(row) => row.id}
          loading={view.loading}
          error={view.fault?.text ?? null}
          emptyText="暂无用户"
          page={{ current: page.current, pageSize: page.pageSize, total }}
          onPageChange={onPageChange}
        />
      </section>

      <Modal
        open={deleteTarget != null}
        title="删除用户"
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
          <p className="admin-users__modal-text">
            确定删除账号{" "}
            <span className="admin-users__modal-account num">
              {deleteTarget.userAccount || deleteTarget.userName || deleteTarget.id}
            </span>{" "}
            吗？此操作不可撤销。
          </p>
        ) : null}
      </Modal>
    </div>
  )
}

export default AdminUsersPage
