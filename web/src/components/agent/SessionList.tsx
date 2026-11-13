import { useRef, useState } from "react"
import {
  ChevronLeft,
  Download,
  Ellipsis,
  Pencil,
  Pin,
  PinOff,
  Plus,
  Trash2,
} from "lucide-react"
import type { AgentSessionVO } from "@/lib/api"
import { Dialog } from "@/components/ui/dialog"
import { Menu, MenuItem, MenuSeparator } from "@/components/ui/menu"

type Group = { label: string; sessions: AgentSessionVO[] }

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
const pad = (n: number) => String(n).padStart(2, "0")

/** 置顶区 + 今天/昨天/更早 分组（按 updatedTime 本地零点比较）。 */
function groupSessions(sessions: AgentSessionVO[]): { pinned: AgentSessionVO[]; groups: Group[] } {
  const pinned: AgentSessionVO[] = []
  const today: AgentSessionVO[] = []
  const yesterday: AgentSessionVO[] = []
  const earlier: AgentSessionVO[] = []

  const now = new Date()
  const todayStart = startOfDay(now)
  const yesterdayStart = startOfDay(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1))

  for (const s of sessions) {
    if (s.isPinned) {
      pinned.push(s)
      continue
    }
    const t = s.updatedTime ? new Date(s.updatedTime.replace(" ", "T")).getTime() : 0
    if (t >= todayStart) today.push(s)
    else if (t >= yesterdayStart) yesterday.push(s)
    else earlier.push(s)
  }

  const groups: Group[] = []
  if (today.length > 0) groups.push({ label: "今天", sessions: today })
  if (yesterday.length > 0) groups.push({ label: "昨天", sessions: yesterday })
  if (earlier.length > 0) groups.push({ label: "更早", sessions: earlier })
  return { pinned, groups }
}

/**
 * 行内日期读数：今天 / 昨天给到时刻，更早只给日期。
 * 用真实 updatedTime 换算，不做「刚刚 / 3 分钟前」这类会随着刷新失真的措辞。
 */
function formatSessionStamp(value?: string): string {
  if (!value) return ""
  const time = new Date(value.replace(" ", "T"))
  if (Number.isNaN(time.getTime())) return value.slice(0, 10)

  const now = new Date()
  const day = startOfDay(time)
  const today = startOfDay(now)
  const clock = `${pad(time.getHours())}:${pad(time.getMinutes())}`

  if (day === today) return `今天 ${clock}`
  if (day === startOfDay(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1))) {
    return `昨天 ${clock}`
  }
  if (time.getFullYear() === now.getFullYear()) {
    return `${pad(time.getMonth() + 1)}-${pad(time.getDate())}`
  }
  return `${time.getFullYear()}-${pad(time.getMonth() + 1)}-${pad(time.getDate())}`
}

/**
 * 会话列表：分组、行内重命名、多选批量删、置顶、导出。
 * 所有操作上抛页面执行——组件自己不调 API，页面成功后刷新列表。
 *
 * 行级操作菜单、删除确认都走 Base UI（Portal + 定位 + 焦点管理），不再手写
 * absolute 定位和 window.confirm。异步操作（重命名 / 删除）以页面返回的
 * boolean 作为「服务端真的成功了」的唯一依据：失败时保留输入、保留选中、
 * 保留会话本身，不假装成功。
 */
export function SessionList({
  sessions,
  activeId,
  busy,
  onNewChat,
  onSelect,
  onRename,
  onDelete,
  onBatchDelete,
  onTogglePin,
  onExport,
  onCollapse,
}: {
  sessions: AgentSessionVO[]
  activeId: string
  busy: boolean
  onNewChat: () => void
  onSelect: (id: string) => void
  onRename: (id: string, title: string) => Promise<boolean>
  onDelete: (id: string) => Promise<boolean>
  onBatchDelete: (ids: string[]) => Promise<boolean>
  onTogglePin: (id: string, pinned: boolean) => void
  onExport: (id: string, format: "markdown" | "json") => void
  onCollapse: () => void
}) {
  const [selectMode, setSelectMode] = useState(false)
  const [checked, setChecked] = useState<Set<string>>(new Set())
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draftTitle, setDraftTitle] = useState("")
  const [renameState, setRenameState] = useState<"editing" | "saving" | "error">("editing")
  const renameBusy = useRef(false)
  const renameOriginalRef = useRef("")
  const [menuId, setMenuId] = useState<string | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<AgentSessionVO | null>(null)
  const [deletePending, setDeletePending] = useState(false)
  const [deleteError, setDeleteError] = useState("")
  const [batchOpen, setBatchOpen] = useState(false)
  const [batchPending, setBatchPending] = useState(false)
  const [batchError, setBatchError] = useState("")

  const { pinned, groups } = groupSessions(sessions)
  // 只把当前列表里真实存在的勾选项交给删除接口——刷新后消失的 id 不再冒充。
  const selectedIds = sessions.filter((s) => checked.has(s.sessionId)).map((s) => s.sessionId)

  function toggleCheck(id: string) {
    setChecked((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function exitSelectMode() {
    setSelectMode(false)
    setChecked(new Set())
  }

  function startRename(s: AgentSessionVO) {
    setMenuId(null)
    setEditingId(s.sessionId)
    setDraftTitle(s.title || "")
    setRenameState("editing")
    // 记住原题：菜单关闭时 Base UI 会把焦点还给触发钮，刚挂载的输入框会被
    // 顺带 blur——没有改动就提交会直接把编辑框合上，用户根本看不到输入态。
    renameOriginalRef.current = s.title || ""
  }

  function cancelRename() {
    if (renameBusy.current) return
    setEditingId(null)
    setRenameState("editing")
  }

  async function submitRename() {
    if (!editingId || renameBusy.current) return
    const title = draftTitle.trim()
    if (!title) {
      // 空标题没有可提交的内容：保持原样退出，不静默改成空串。
      setEditingId(null)
      setRenameState("editing")
      return
    }

    renameBusy.current = true
    setRenameState("saving")
    try {
      const ok = await onRename(editingId, title)
      if (ok) {
        setEditingId(null)
        setRenameState("editing")
      } else {
        // 失败不把用户输入吞掉：输入框留在原地，草稿可供重试。
        setRenameState("error")
      }
    } finally {
      renameBusy.current = false
    }
  }

  function requestDelete(s: AgentSessionVO) {
    setMenuId(null)
    setDeleteError("")
    setDeleteTarget(s)
  }

  async function confirmDelete() {
    if (!deleteTarget || deletePending) return
    setDeletePending(true)
    setDeleteError("")
    const target = deleteTarget
    try {
      const ok = await onDelete(target.sessionId)
      if (ok) {
        setDeleteTarget(null)
      } else {
        setDeleteError("删除失败，会话仍然保留。")
      }
    } finally {
      setDeletePending(false)
    }
  }

  async function confirmBatchDelete() {
    if (batchPending || selectedIds.length === 0) return
    setBatchPending(true)
    setBatchError("")
    try {
      const ok = await onBatchDelete(selectedIds)
      if (ok) {
        // 只有服务端确认成功后才清理选择。
        setBatchOpen(false)
        setSelectMode(false)
        setChecked(new Set())
      } else {
        setBatchError("删除失败，选中的会话仍然保留。")
      }
    } finally {
      setBatchPending(false)
    }
  }

  function renderMenu(s: AgentSessionVO) {
    const title = s.title || "新对话"
    return (
      <Menu
        label={`会话操作：${title}`}
        popupClassName="agent-session__menu"
        positionerClassName="agent-session__positioner"
        align="end"
        sideOffset={6}
        open={menuId === s.sessionId}
        onOpenChange={(open) => setMenuId(open ? s.sessionId : null)}
        trigger={
          <button type="button" className="agent-session__menu-btn" aria-label={`会话操作：${title}`}>
            <Ellipsis aria-hidden="true" />
          </button>
        }
      >
        <MenuItem
          className="agent-session__menu-item"
          render={<button type="button" />} nativeButton
          onClick={() => startRename(s)}
        >
          <Pencil className="agent-session__menu-icon" aria-hidden="true" />
          重命名
        </MenuItem>
        <MenuItem
          className="agent-session__menu-item"
          render={<button type="button" />} nativeButton
          onClick={() => {
            setMenuId(null)
            onTogglePin(s.sessionId, !s.isPinned)
          }}
        >
          {s.isPinned ? (
            <PinOff className="agent-session__menu-icon" aria-hidden="true" />
          ) : (
            <Pin className="agent-session__menu-icon" aria-hidden="true" />
          )}
          {s.isPinned ? "取消置顶" : "置顶"}
        </MenuItem>
        <MenuSeparator className="agent-session__menu-sep" />
        <MenuItem
          className="agent-session__menu-item"
          render={<button type="button" />} nativeButton
          onClick={() => {
            setMenuId(null)
            onExport(s.sessionId, "markdown")
          }}
        >
          <Download className="agent-session__menu-icon" aria-hidden="true" />
          导出 Markdown
        </MenuItem>
        <MenuItem
          className="agent-session__menu-item"
          render={<button type="button" />} nativeButton
          onClick={() => {
            setMenuId(null)
            onExport(s.sessionId, "json")
          }}
        >
          <Download className="agent-session__menu-icon" aria-hidden="true" />
          导出 JSON
        </MenuItem>
        <MenuSeparator className="agent-session__menu-sep" />
        <MenuItem
          className="agent-session__menu-item is-destructive"
          render={<button type="button" />} nativeButton
          onClick={() => requestDelete(s)}
        >
          <Trash2 className="agent-session__menu-icon" aria-hidden="true" />
          删除
        </MenuItem>
      </Menu>
    )
  }

  function renderRow(s: AgentSessionVO) {
    const isActive = s.sessionId === activeId
    const title = s.title || "新对话"

    return (
      <li key={s.sessionId} className={`agent-session${isActive ? " is-active" : ""}`}>
        {selectMode ? (
          <label className="agent-session__checkline">
            <input
              type="checkbox"
              checked={checked.has(s.sessionId)}
              onChange={() => toggleCheck(s.sessionId)}
            />
            <span className="agent-session__checktext">
              <span className="agent-session__title">{title}</span>
              <span className="agent-session__meta num">{formatSessionStamp(s.updatedTime)}</span>
            </span>
          </label>
        ) : editingId === s.sessionId ? (
          <div className="agent-session__renamebox">
            <input
              className="agent-session__rename"
              value={draftTitle}
              autoFocus
              disabled={renameState === "saving"}
              aria-label="会话标题"
              aria-invalid={renameState === "error"}
              onChange={(e) => setDraftTitle(e.target.value)}
              onBlur={(e) => {
                // 保存中 / 已失败时不因失焦重复提交：失败后输入框留在原地等重试。
                if (renameState !== "editing") return
                // 焦点被抢走（菜单关闭归还焦点）而标题没改：直接退出，不空提交。
                const changed = draftTitle.trim() !== renameOriginalRef.current
                if (!changed && !e.currentTarget.matches(":focus")) {
                  // 失焦且无改动 → 关闭编辑框
                  setEditingId(null)
                  setRenameState("editing")
                  return
                }
                if (changed) void submitRename()
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault()
                  void submitRename()
                }
                if (e.key === "Escape") {
                  e.preventDefault()
                  cancelRename()
                }
              }}
            />
            {renameState === "error" ? (
              <span className="agent-session__rename-error" role="alert">
                重命名失败，草稿已保留 · 回车重试
              </span>
            ) : null}
            {renameState === "saving" ? (
              <span className="agent-session__rename-state num" aria-live="polite">
                保存中…
              </span>
            ) : null}
          </div>
        ) : (
          <>
            <button
              type="button"
              className="agent-session__main"
              aria-current={isActive ? "true" : undefined}
              onClick={() => onSelect(s.sessionId)}
            >
              <span className="agent-session__row">
                <span className="agent-session__title">{title}</span>
                {s.isPinned ? (
                  <span className="agent-session__pin" title="已置顶">
                    <Pin aria-hidden="true" />
                    <span className="sr-only">已置顶</span>
                  </span>
                ) : null}
              </span>
              <span className="agent-session__meta num">{formatSessionStamp(s.updatedTime)}</span>
            </button>
            {renderMenu(s)}
          </>
        )}
      </li>
    )
  }

  return (
    <aside className="agent-sessions">
      <div className="agent-sessions__head">
        <div className="agent-sessions__brand">
          <span className="agent-sessions__brandname">会话</span>
          <button
            type="button"
            className="agent-sessions__collapse"
            onClick={onCollapse}
            aria-label="收起会话栏"
            title="收起会话栏"
          >
            <ChevronLeft aria-hidden="true" />
          </button>
        </div>

        {selectMode ? (
          <div className="agent-sessions__actions agent-sessions__actions--select">
            <span className="agent-sessions__count num" aria-live="polite">
              已选 {selectedIds.length}
            </span>
            <button
              type="button"
              className="agent-sessions__danger"
              disabled={selectedIds.length === 0 || batchPending}
              onClick={() => {
                setBatchError("")
                setBatchOpen(true)
              }}
            >
              <Trash2 aria-hidden="true" />
              删除
            </button>
            <button type="button" className="agent-sessions__select" onClick={exitSelectMode}>
              取消
            </button>
          </div>
        ) : (
          <div className="agent-sessions__actions">
            <button
              type="button"
              className="agent-sessions__newchat"
              onClick={onNewChat}
              disabled={busy}
            >
              <Plus aria-hidden="true" />
              <span>新对话</span>
            </button>
            <button
              type="button"
              className="agent-sessions__select"
              onClick={() => setSelectMode(true)}
            >
              选择
            </button>
          </div>
        )}
      </div>

      <div className="agent-sessions__body">
        {sessions.length === 0 && (
          <div className="agent-sessions__empty">
            <p className="num">暂无历史会话</p>
            <p className="agent-sessions__emptyhint">
              新的提问会自动出现在这里，
              <br />
              按今天 / 昨天 / 更早归档。
            </p>
          </div>
        )}
        {pinned.length > 0 && (
          <section>
            <div className="agent-sessions__label num">置顶</div>
            <ul className="agent-sessions__list">{pinned.map(renderRow)}</ul>
          </section>
        )}
        {groups.map((g) => (
          <section key={g.label}>
            <div className="agent-sessions__label num">{g.label}</div>
            <ul className="agent-sessions__list">{g.sessions.map(renderRow)}</ul>
          </section>
        ))}
      </div>

      <Dialog
        open={deleteTarget !== null}
        title="删除会话"
        onClose={() => {
          if (!deletePending) setDeleteTarget(null)
        }}
        className="agent-confirm"
      >
        <h2 className="agent-confirm__title">删除这个会话？</h2>
        <p className="agent-confirm__body">
          「{deleteTarget?.title || "新对话"}」将从会话列表中移除，对话内容无法恢复。
        </p>
        {deleteError ? (
          <p className="agent-confirm__error" role="alert">
            {deleteError}
          </p>
        ) : null}
        <div className="agent-confirm__actions">
          <button
            type="button"
            className="agent-confirm__cancel"
            disabled={deletePending}
            onClick={() => setDeleteTarget(null)}
          >
            取消
          </button>
          <button
            type="button"
            className="agent-confirm__danger"
            disabled={deletePending}
            onClick={() => void confirmDelete()}
          >
            {deletePending ? "删除中…" : "删除"}
          </button>
        </div>
      </Dialog>

      <Dialog
        open={batchOpen}
        title="批量删除会话"
        onClose={() => {
          if (!batchPending) setBatchOpen(false)
        }}
        className="agent-confirm"
      >
        <h2 className="agent-confirm__title">删除选中的 {selectedIds.length} 个会话？</h2>
        <p className="agent-confirm__body">
          只删除当前勾选的会话，未选中的会话不受影响。对话内容无法恢复。
        </p>
        {batchError ? (
          <p className="agent-confirm__error" role="alert">
            {batchError}
          </p>
        ) : null}
        <div className="agent-confirm__actions">
          <button
            type="button"
            className="agent-confirm__cancel"
            disabled={batchPending}
            onClick={() => setBatchOpen(false)}
          >
            取消
          </button>
          <button
            type="button"
            className="agent-confirm__danger"
            disabled={batchPending || selectedIds.length === 0}
            onClick={() => void confirmBatchDelete()}
          >
            {batchPending ? "删除中…" : `删除 ${selectedIds.length}`}
          </button>
        </div>
      </Dialog>
    </aside>
  )
}
