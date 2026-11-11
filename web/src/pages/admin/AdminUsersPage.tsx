import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactElement,
} from "react"

import { SectionHead } from "@/components/SectionHead"
import { DataTable, type Column } from "@/components/admin/DataTable"
import { Toolbar } from "@/components/admin/Toolbar"
import { Modal } from "@/components/admin/Modal"
import { BatchBar } from "@/components/admin/BatchBar"
import { FaultNote } from "@/components/fault"
import {
  createUser,
  deleteUser,
  deleteUsers,
  listUsers,
  updateUser,
  updateUserRole,
  type AdminUser,
  type BatchResult,
  type Page,
  type UserQuery,
} from "@/lib/adminApi"
import {
  canDeleteUser,
  userRoleView,
  USER_ROLE_ASSIGN_OPTIONS,
  USER_ROLE_FILTER_OPTIONS,
} from "@/lib/adminDomain"
import { describeError, type ErrorDetail } from "@/lib/api"
import { fault } from "@/lib/faults"

const DEFAULT_PAGE_SIZE = 10

/** 已应用的筛选条件；空串表示不限。 */
type Query = {
  userAccount: string
  userName: string
  userRole: string
  startDate: string
  endDate: string
}
type Params = UserQuery
/** 加载 / 错误 / 数据三态的全部来源；不在各事件里散着维护布尔量。 */
type View = { data: Page<AdminUser> | null; fault: ErrorDetail | null; loading: boolean }

/** 新建 / 编辑表单的字段（角色是下拉，不给自由输入）。 */
type UserForm = {
  userAccount: string
  userName: string
  userProfile: string
  userRole: string
  userPassword: string
}

const EMPTY_FORM: UserForm = {
  userAccount: "",
  userName: "",
  userProfile: "",
  userRole: "user",
  userPassword: "",
}

/**
 * 用户管理（真实端点）。
 *
 * 取数是事件驱动的：唯一的 load() 由查询 / 重置 / 翻页 / 删除成功后刷新调用，
 * 首次挂载只用一个 useEffect 加载一次。三态全部从 view 派生，按 DataTable 的
 * 自然接线把 rows（加载/出错时为 undefined）、error（describeError 的 text）、
 * loading 一起交给表格——出错时 error 优先于隐式 loading，文案可达。
 *
 * 动作面：单条的新建 / 编辑 / 删除，多条的批量删除 / 批量改角色（封禁·解封）。
 */
export function AdminUsersPage(): ReactElement {
  // 输入草稿与「已应用的查询」分开：打字不触发请求，回车 / 查询按钮才提交。
  const [accountDraft, setAccountDraft] = useState("")
  const [nameDraft, setNameDraft] = useState("")
  const [roleDraft, setRoleDraft] = useState("")
  const [startDraft, setStartDraft] = useState("")
  const [endDraft, setEndDraft] = useState("")
  const [query, setQuery] = useState<Query>({
    userAccount: "",
    userName: "",
    userRole: "",
    startDate: "",
    endDate: "",
  })
  const [page, setPage] = useState({ current: 1, pageSize: DEFAULT_PAGE_SIZE })

  const [view, setView] = useState<View>({ data: null, fault: null, loading: true })
  // 递增序号挡住过期响应：并发 / StrictMode 双挂载下只有最后一次请求能写 view。
  const requestSeq = useRef(0)

  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [deleteTarget, setDeleteTarget] = useState<AdminUser | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [actionError, setActionError] = useState<ErrorDetail | null>(null)
  const [actionNote, setActionNote] = useState<string | null>(null)

  const [createOpen, setCreateOpen] = useState(false)
  const [editTarget, setEditTarget] = useState<AdminUser | null>(null)
  const [form, setForm] = useState<UserForm>(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<ErrorDetail | null>(null)

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
  }, [fetchUsers])

  function toParams(nextPage = page, nextQuery = query): Params {
    return {
      current: nextPage.current,
      pageSize: nextPage.pageSize,
      ...(nextQuery.userAccount ? { userAccount: nextQuery.userAccount } : {}),
      ...(nextQuery.userName ? { userName: nextQuery.userName } : {}),
      ...(nextQuery.userRole ? { userRole: nextQuery.userRole } : {}),
      ...(nextQuery.startDate ? { startDate: nextQuery.startDate } : {}),
      ...(nextQuery.endDate ? { endDate: nextQuery.endDate } : {}),
    }
  }

  /** 事件驱动的取数入口：在事件里同步置 loading，再发请求（effect 只负责首次挂载）。 */
  function startLoad(nextPage = page, nextQuery = query) {
    setActionError(null) // 任何一次重新取数都清掉上一次删除失败的页内读数
    setView({ data: null, fault: null, loading: true })
    const { seq, result } = fetchUsers(toParams(nextPage, nextQuery))
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
    const nextQuery: Query = {
      userAccount: accountDraft.trim(),
      userName: nameDraft.trim(),
      userRole: roleDraft,
      startDate: startDraft,
      endDate: endDraft,
    }
    const nextPage = { ...page, current: 1 }
    setQuery(nextQuery)
    setPage(nextPage)
    setSelectedIds([])
    startLoad(nextPage, nextQuery)
  }

  function onReset() {
    setAccountDraft("")
    setNameDraft("")
    setRoleDraft("")
    setStartDraft("")
    setEndDraft("")
    const nextQuery: Query = {
      userAccount: "",
      userName: "",
      userRole: "",
      startDate: "",
      endDate: "",
    }
    const nextPage = { ...page, current: 1 }
    setQuery(nextQuery)
    setPage(nextPage)
    setSelectedIds([])
    startLoad(nextPage, nextQuery)
  }

  function onPageChange(next: { current: number; pageSize: number }) {
    // pageSize 变化一律回第 1 页（DataTable 已传 current:1，这里再钉死一次）。
    const nextPage =
      next.pageSize !== page.pageSize
        ? { current: 1, pageSize: next.pageSize }
        : { current: next.current, pageSize: next.pageSize }
    setPage(nextPage)
    setSelectedIds([])
    startLoad(nextPage)
  }

  /* ── 单条：新建 / 编辑 / 删除 ─────────────────────────── */

  function openCreate() {
    setForm(EMPTY_FORM)
    setFormError(null)
    setCreateOpen(true)
  }

  function closeCreate() {
    if (saving) return
    setCreateOpen(false)
    setFormError(null)
  }

  function openEdit(row: AdminUser) {
    setForm({
      userAccount: row.userAccount ?? "",
      userName: row.userName ?? "",
      userProfile: row.userProfile ?? "",
      userRole: row.userRole ?? "user",
      userPassword: "",
    })
    setFormError(null)
    setEditTarget(row)
  }

  function closeEdit() {
    if (saving) return
    setEditTarget(null)
    setFormError(null)
  }

  async function submitCreate(event: FormEvent) {
    event.preventDefault()
    if (saving) return
    if (!form.userAccount.trim()) {
      setFormError({ code: 40000, text: "账号不能为空" })
      return
    }
    if (!form.userPassword.trim()) {
      setFormError({ code: 40000, text: "必须提供初始密码" })
      return
    }
    setSaving(true)
    setFormError(null)
    try {
      await createUser({
        userAccount: form.userAccount.trim(),
        userPassword: form.userPassword,
        userName: form.userName.trim() || undefined,
        userProfile: form.userProfile.trim() || undefined,
        userRole: form.userRole,
      })
      setCreateOpen(false)
      setActionNote("已新建用户")
      startLoad()
    } catch (cause) {
      setFormError(describeError(cause))
    } finally {
      setSaving(false)
    }
  }

  async function submitEdit(event: FormEvent) {
    event.preventDefault()
    if (saving || !editTarget) return
    setSaving(true)
    setFormError(null)
    try {
      await updateUser({
        id: editTarget.id,
        userName: form.userName.trim(),
        userProfile: form.userProfile.trim(),
        userRole: form.userRole,
      })
      setEditTarget(null)
      setActionNote("已保存修改")
      startLoad()
    } catch (cause) {
      setFormError(describeError(cause))
    } finally {
      setSaving(false)
    }
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
      setSelectedIds((prev) => prev.filter((id) => id !== target.id))
      startLoad() // 成功后刷新当前页（含 loading 态归位）
    } catch (cause) {
      const detail = describeError(cause)
      setDeleteTarget(null) // 收起弹层，让页内提示露出来
      setActionError(detail)
    } finally {
      setDeleting(false)
    }
  }

  /* ── 批量：删除 / 改角色 ─────────────────────────────── */

  const [batchBusy, setBatchBusy] = useState(false)

  async function runBatch(
    label: string,
    action: () => Promise<BatchResult>,
    clearOnSuccess: boolean,
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
          ? `${label}：成功 ${succeeded} 条，失败 ${failed} 条。${result.message ?? ""}`
          : `${label}：成功 ${succeeded} 条。`,
      )
      if (clearOnSuccess && failed === 0) setSelectedIds([])
      startLoad()
    } catch (cause) {
      setActionError(describeError(cause))
    } finally {
      setBatchBusy(false)
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
    {
      key: "userRole",
      title: "角色",
      width: "116px",
      render: (row) => {
        const view = userRoleView(row.userRole)
        return (
          <span className="risk" data-risk={view.risk}>
            {view.label}
          </span>
        )
      },
    },
    { key: "createTime", title: "创建时间", width: "180px", mono: true },
    {
      key: "action",
      title: "操作",
      width: "150px",
      render: (row) => {
        const allowed = canDeleteUser(row)
        return (
          <div className="admin-users__row-actions">
            <button
              type="button"
              className="btn btn--ghost btn--sm"
              onClick={() => openEdit(row)}
            >
              编辑
            </button>
            <button
              type="button"
              className="btn btn--ghost btn--sm"
              disabled={!allowed}
              title={allowed ? undefined : "无法操作管理员账号"}
              onClick={() => openDelete(row)}
            >
              删除
            </button>
          </div>
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
        <button type="button" className="btn btn--sm" onClick={openCreate}>
          新建用户
        </button>
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
          <label className="admin-users__field admin-users__field--narrow">
            <span className="admin-users__label">角色 · ROLE</span>
            <select
              className="admin-users__input"
              value={roleDraft}
              onChange={(event) => setRoleDraft(event.target.value)}
              aria-label="角色"
            >
              {USER_ROLE_FILTER_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label className="admin-users__field admin-users__field--narrow">
            <span className="admin-users__label">注册自 · FROM</span>
            <input
              className="admin-users__input"
              type="date"
              value={startDraft}
              onChange={(event) => setStartDraft(event.target.value)}
              aria-label="注册时间起"
            />
          </label>
          <label className="admin-users__field admin-users__field--narrow">
            <span className="admin-users__label">注册至 · TO</span>
            <input
              className="admin-users__input"
              type="date"
              value={endDraft}
              onChange={(event) => setEndDraft(event.target.value)}
              aria-label="注册时间止"
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

      {actionNote ? (
        <p className="admin-users__note num">{actionNote}</p>
      ) : null}

      <BatchBar count={selectedIds.length} onClear={() => setSelectedIds([])} label="用户批量操作">
        <button
          type="button"
          className="btn btn--sm"
          disabled={batchBusy}
          onClick={() => runBatch("批量删除", () => deleteUsers(selectedIds), true)}
        >
          批量删除
        </button>
        <button
          type="button"
          className="btn btn--ghost btn--sm"
          disabled={batchBusy}
          onClick={() => runBatch("批量封禁", () => updateUserRole(selectedIds, "ban"), true)}
        >
          批量封禁
        </button>
        <button
          type="button"
          className="btn btn--ghost btn--sm"
          disabled={batchBusy}
          onClick={() => runBatch("批量解除封禁", () => updateUserRole(selectedIds, "user"), true)}
        >
          批量解封
        </button>
      </BatchBar>

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
          selectable
          selectedKeys={selectedIds}
          onSelectionChange={setSelectedIds}
          // 管理员账号不可删，也不可批量降级：勾选它只会得到一个失败回执。
          isRowSelectable={(row) => canDeleteUser(row)}
        />
      </section>

      {/* 新建用户 */}
      <Modal
        open={createOpen}
        title="新建用户"
        onClose={closeCreate}
        footer={
          <>
            <button
              type="button"
              className="btn btn--ghost btn--sm"
              onClick={closeCreate}
              disabled={saving}
            >
              取消
            </button>
            <button type="button" className="btn btn--sm" onClick={submitCreate} disabled={saving}>
              {saving ? "创建中…" : "创建"}
            </button>
          </>
        }
      >
        <form className="admin-form" onSubmit={submitCreate}>
          <label className="admin-form__field">
            <span className="admin-form__label">账号 · ACCOUNT（必填）</span>
            <input
              className="admin-users__input"
              value={form.userAccount}
              onChange={(event) => setForm({ ...form, userAccount: event.target.value })}
              aria-label="账号"
            />
          </label>
          <label className="admin-form__field">
            <span className="admin-form__label">初始密码 · PASSWORD（必填）</span>
            <input
              className="admin-users__input"
              type="password"
              value={form.userPassword}
              onChange={(event) => setForm({ ...form, userPassword: event.target.value })}
              aria-label="初始密码"
            />
          </label>
          <label className="admin-form__field">
            <span className="admin-form__label">用户名 · NAME</span>
            <input
              className="admin-users__input"
              value={form.userName}
              onChange={(event) => setForm({ ...form, userName: event.target.value })}
              aria-label="用户名"
            />
          </label>
          <label className="admin-form__field">
            <span className="admin-form__label">简介 · PROFILE</span>
            <input
              className="admin-users__input"
              value={form.userProfile}
              onChange={(event) => setForm({ ...form, userProfile: event.target.value })}
              aria-label="简介"
            />
          </label>
          <label className="admin-form__field">
            <span className="admin-form__label">角色 · ROLE</span>
            <select
              className="admin-users__input"
              value={form.userRole}
              onChange={(event) => setForm({ ...form, userRole: event.target.value })}
              aria-label="角色"
            >
              {USER_ROLE_ASSIGN_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          {formError ? (
            <FaultNote
              className="admin-form__fault"
              fault={fault({
                severity: "attention",
                kind: "client",
                title: formError.text,
                code: formError.code,
              })}
            />
          ) : null}
        </form>
      </Modal>

      {/* 编辑用户 */}
      <Modal
        open={editTarget != null}
        title="编辑用户"
        onClose={closeEdit}
        footer={
          <>
            <button
              type="button"
              className="btn btn--ghost btn--sm"
              onClick={closeEdit}
              disabled={saving}
            >
              取消
            </button>
            <button type="button" className="btn btn--sm" onClick={submitEdit} disabled={saving}>
              {saving ? "保存中…" : "保存"}
            </button>
          </>
        }
      >
        <form className="admin-form" onSubmit={submitEdit}>
          <label className="admin-form__field">
            <span className="admin-form__label">账号 · ACCOUNT（不可改）</span>
            <input className="admin-users__input" value={form.userAccount} readOnly aria-label="账号" />
          </label>
          <label className="admin-form__field">
            <span className="admin-form__label">用户名 · NAME</span>
            <input
              className="admin-users__input"
              value={form.userName}
              onChange={(event) => setForm({ ...form, userName: event.target.value })}
              aria-label="用户名"
            />
          </label>
          <label className="admin-form__field">
            <span className="admin-form__label">简介 · PROFILE</span>
            <input
              className="admin-users__input"
              value={form.userProfile}
              onChange={(event) => setForm({ ...form, userProfile: event.target.value })}
              aria-label="简介"
            />
          </label>
          <label className="admin-form__field">
            <span className="admin-form__label">角色 · ROLE</span>
            <select
              className="admin-users__input"
              value={form.userRole}
              onChange={(event) => setForm({ ...form, userRole: event.target.value })}
              aria-label="角色"
            >
              {USER_ROLE_ASSIGN_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          {formError ? (
            <FaultNote
              className="admin-form__fault"
              fault={fault({
                severity: "attention",
                kind: "client",
                title: formError.text,
                code: formError.code,
              })}
            />
          ) : null}
        </form>
      </Modal>

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
