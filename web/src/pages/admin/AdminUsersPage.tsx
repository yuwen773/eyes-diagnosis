import { useMemo, useState, type FormEvent, type ReactElement } from "react"
import { ChevronDown, ChevronUp } from "lucide-react"

import { useMediaQuery } from "@/lib/useMediaQuery"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { Pencil, Trash2, UserPlus, Users as UsersIcon } from "lucide-react"

import { AdminEmpty } from "@/components/admin/AdminEmpty"
import { AdminPageHead } from "@/components/admin/AdminPageHead"
import { RowMenu } from "@/components/admin/RowMenu"
import { DataTable, type Column, type SortState } from "@/components/admin/DataTable"
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
  type UserQuery,
} from "@/lib/adminApi"
import {
  canDeleteUser,
  userRoleView,
  formatStatNumber,
  USER_ROLE_ASSIGN_OPTIONS,
  USER_ROLE_FILTER_OPTIONS,
} from "@/lib/adminDomain"
import { describeError, type ErrorDetail } from "@/lib/api"
import { queryKeys } from "@/lib/queryKeys"
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

/** 角色 chip：管理员用管理紫（身份），封禁用医学危险色，普通用户用中性。 */
function RoleChip({ role }: { role?: string | null }) {
  const view = userRoleView(role)
  const tone =
    role === "admin" ? "admin" : role === "ban" ? "critical" : "mute"
  return (
    <span className="admin-chip" data-tone={tone}>
      {view.label}
    </span>
  )
}

/**
 * 用户管理（真实端点）。
 *
 * <p>页面结构：页头（口径 + 主操作）→ 筛选面板 → 批量动作条 → 台账。
 * 表格把「账号 / 名称 / 头像 / 雪花 id」收进一个用户单元格：管理员先认人，
 * 再认 id；长 id 不再单独占一列把表格撑宽。
 *
 * <p>动作面：单条的新建 / 编辑 / 删除，多条的批量删除 / 批量改角色（封禁·解封）。
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
  // 服务端排序：字段必须落在后端白名单里。
  const [sort, setSort] = useState<SortState>(null)

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

  const queryClient = useQueryClient()

  /** 已应用的筛选 + 分页：同时是查询键和请求体。 */
  const { current, pageSize } = page
  const params = useMemo<Params>(
    () => ({
      current,
      pageSize,
      ...(query.userAccount ? { userAccount: query.userAccount } : {}),
      ...(query.userName ? { userName: query.userName } : {}),
      ...(query.userRole ? { userRole: query.userRole } : {}),
      ...(query.startDate ? { startDate: query.startDate } : {}),
      ...(query.endDate ? { endDate: query.endDate } : {}),
      ...(sort ? { sortField: sort.field, sortOrder: sort.order } : {}),
    }),
    [current, pageSize, query, sort],
  )

  const listQuery = useQuery({
    queryKey: queryKeys.admin.users(params),
    queryFn: () => listUsers(params),
  })
  const listFault = listQuery.error ? describeError(listQuery.error) : null

  /** 写操作成功后失效用户域与统计域（新增用户会改统计读数）。 */
  const refreshUsers = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.admin.usersAll }),
      queryClient.invalidateQueries({ queryKey: queryKeys.admin.statsAll }),
    ])

  function onSearch(event: FormEvent) {
    event.preventDefault()
    setActionError(null)
    setQuery({
      userAccount: accountDraft.trim(),
      userName: nameDraft.trim(),
      userRole: roleDraft,
      startDate: startDraft,
      endDate: endDraft,
    })
    setPage((prev) => ({ ...prev, current: 1 }))
    setSelectedIds([])
  }

  function onReset() {
    setAccountDraft("")
    setNameDraft("")
    setRoleDraft("")
    setStartDraft("")
    setEndDraft("")
    setActionError(null)
    setQuery({ userAccount: "", userName: "", userRole: "", startDate: "", endDate: "" })
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
      await refreshUsers()
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
      await refreshUsers()
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
      await refreshUsers()
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
      await refreshUsers()
    } catch (cause) {
      setActionError(describeError(cause))
    } finally {
      setBatchBusy(false)
    }
  }

  const columns: Column<AdminUser>[] = [
    {
      key: "userAccount",
      title: "用户",
      width: "268px",
      sortable: true,
      render: (row) => {
        const name = row.userName || row.userAccount || "未命名"
        return (
          <div className="admin-user-cell">
            <span className="admin-user-cell__avatar" aria-hidden="true">
              {row.userAvatar ? (
                <img src={row.userAvatar} alt="" loading="lazy" />
              ) : (
                name.slice(0, 1)
              )}
            </span>
            <span className="admin-user-cell__text">
              <span className="admin-user-cell__name">{name}</span>
              <span className="admin-user-cell__sub">
                {row.userAccount || "—"} · {row.id}
              </span>
              {/* 简介多数为空，单开一列会留下整列「—」；有内容时并入身份块。 */}
              {row.userProfile ? (
                <span className="admin-user-cell__bio" title={row.userProfile}>
                  {row.userProfile}
                </span>
              ) : null}
            </span>
          </div>
        )
      },
    },
    {
      key: "userRole",
      title: "角色",
      width: "116px",
      sortable: true,
      render: (row) => <RoleChip role={row.userRole} />,
    },
    {
      key: "createTime",
      title: "创建时间",
      width: "180px",
      mono: true,
      sortable: true,
    },
    {
      key: "action",
      title: "操作",
      width: "128px",
      render: (row) => {
        const allowed = canDeleteUser(row)
        return (
          <div className="admin-dt__row-actions">
            {/* 主动作（编辑）收进图标按钮：窄屏下文字版会把操作列撑到
                盖住账号列；标签交给 title/aria-label。 */}
            <button
              type="button"
              className="admin-btn admin-btn--primary admin-btn--icon-sm"
              title="编辑用户"
              aria-label="编辑用户"
              onClick={() => openEdit(row)}
            >
              <Pencil size={14} strokeWidth={2} aria-hidden="true" />
            </button>
            <RowMenu
              label={`更多用户操作：${row.userAccount || row.id}`}
              items={[
                {
                  label: "删除用户",
                  icon: <Trash2 size={14} strokeWidth={2} aria-hidden="true" />,
                  danger: true,
                  disabled: !allowed,
                  hint: allowed ? undefined : "管理员账号不可删除",
                  onSelect: () => openDelete(row),
                },
              ]}
            />
          </div>
        )
      },
    },
  ]

  // 三态同源：loading / error / 数据都从同一个查询读；加载与出错时 rows 都是 undefined。
  const rows = listQuery.data?.records
  const total = listQuery.data?.total ?? 0
  const activeFilters = Object.values(query).filter(Boolean).length

  // 390px 档：筛选面板默认收进一条紧凑工具栏，字段区折叠；
  // 已应用筛选数常驻可见，折叠态也不会骗用户「没有条件在生效」。
  const compact = useMediaQuery("(max-width: 640px)")
  const [filtersOpen, setFiltersOpen] = useState(false)
  const showFields = !compact || filtersOpen

  return (
    <div className="admin-users">
      <AdminPageHead
        code="02"
        title="用户管理"
        eyebrow="ADMIN · USERS"
        description="维护账号、角色与访问状态。管理员账号不可删除，也不会进入批量降级。"
        meta={
          <span className="admin-filter__note num">
            {listQuery.data ? `共 ${formatStatNumber(total)} 个账号` : "账号数读取中"}
          </span>
        }
        actions={
          <button type="button" className="admin-btn admin-btn--primary" onClick={openCreate}>
            <UserPlus size={15} strokeWidth={2} aria-hidden="true" />
            新建用户
          </button>
        }
      />

      <section className="admin-filter" aria-label="用户筛选">
        <form className="admin-users__form" onSubmit={onSearch}>
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
          <div className="admin-filter__fields">
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
          </div>
          ) : null}
        </form>
      </section>

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
          className="admin-btn admin-btn--primary"
          disabled={batchBusy}
          onClick={() => runBatch("批量删除", () => deleteUsers(selectedIds), true)}
        >
          批量删除
        </button>
        <button
          type="button"
          className="admin-btn admin-btn--ghost"
          disabled={batchBusy}
          onClick={() => runBatch("批量封禁", () => updateUserRole(selectedIds, "ban"), true)}
        >
          批量封禁
        </button>
        <button
          type="button"
          className="admin-btn admin-btn--ghost"
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
          loading={listQuery.isPending}
          error={listFault?.text ?? null}
          emptyText="暂无用户"
          emptyContent={
            <AdminEmpty
              icon={UsersIcon}
              title="还没有匹配的用户"
              description={
                activeFilters > 0
                  ? "当前筛选条件下没有账号。放宽筛选或重置后再看全量。"
                  : "系统里还没有用户。新建账号后，它会出现在这里。"
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
              className="admin-btn admin-btn--ghost"
              onClick={closeCreate}
              disabled={saving}
            >
              取消
            </button>
            <button type="button" className="admin-btn admin-btn--primary" onClick={submitCreate} disabled={saving}>
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
              className="admin-btn admin-btn--ghost"
              onClick={closeEdit}
              disabled={saving}
            >
              取消
            </button>
            <button type="button" className="admin-btn admin-btn--primary" onClick={submitEdit} disabled={saving}>
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
