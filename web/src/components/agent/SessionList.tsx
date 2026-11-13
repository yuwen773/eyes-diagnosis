import { useState } from "react"
import { ChevronLeft, Plus } from "lucide-react"
import type { AgentSessionVO } from "@/lib/api"

type Group = { label: string; sessions: AgentSessionVO[] }

/** 置顶区 + 今天/昨天/更早 分组（按 updatedTime 本地零点比较）。 */
function groupSessions(sessions: AgentSessionVO[]): { pinned: AgentSessionVO[]; groups: Group[] } {
  const pinned: AgentSessionVO[] = []
  const today: AgentSessionVO[] = []
  const yesterday: AgentSessionVO[] = []
  const earlier: AgentSessionVO[] = []

  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
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
 * 会话列表：分组、行内重命名、多选批量删、置顶、导出。
 * 所有操作上抛页面执行——组件自己不调 API，页面成功后刷新列表。
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
  onRename: (id: string, title: string) => void
  onDelete: (id: string) => void
  onBatchDelete: (ids: string[]) => void
  onTogglePin: (id: string, pinned: boolean) => void
  onExport: (id: string, format: "markdown" | "json") => void
  onCollapse: () => void
}) {
  const [selectMode, setSelectMode] = useState(false)
  const [checked, setChecked] = useState<Set<string>>(new Set())
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draftTitle, setDraftTitle] = useState("")
  const [menuId, setMenuId] = useState<string | null>(null)

  const { pinned, groups } = groupSessions(sessions)

  function toggleCheck(id: string) {
    setChecked((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function startRename(s: AgentSessionVO) {
    setMenuId(null)
    setEditingId(s.sessionId)
    setDraftTitle(s.title || "")
  }

  function submitRename() {
    if (editingId && draftTitle.trim()) {
      onRename(editingId, draftTitle.trim())
    }
    setEditingId(null)
  }

  function renderRow(s: AgentSessionVO) {
    const isActive = s.sessionId === activeId
    return (
      <li key={s.sessionId} className={`agent-session${isActive ? " is-active" : ""}`}>
        {selectMode ? (
          <label className="agent-session__checkline">
            <input
              type="checkbox"
              checked={checked.has(s.sessionId)}
              onChange={() => toggleCheck(s.sessionId)}
            />
            <span className="agent-session__title">{s.title || "新对话"}</span>
          </label>
        ) : (
          <>
            {editingId === s.sessionId ? (
              <input
                className="agent-session__rename"
                value={draftTitle}
                autoFocus
                onChange={(e) => setDraftTitle(e.target.value)}
                onBlur={submitRename}
                onKeyDown={(e) => {
                  if (e.key === "Enter") submitRename()
                  if (e.key === "Escape") setEditingId(null)
                }}
              />
            ) : (
              <button
                type="button"
                className="agent-session__main"
                onClick={() => onSelect(s.sessionId)}
              >
                <span className="agent-session__title">{s.title || "新对话"}</span>
                <span className="agent-session__meta num">{s.updatedTime?.slice(0, 10)}</span>
              </button>
            )}
            <button
              type="button"
              className="agent-session__menu-btn"
              aria-label="会话操作"
              onClick={() => setMenuId(menuId === s.sessionId ? null : s.sessionId)}
            >
              ⋯
            </button>
            {menuId === s.sessionId && (
              <div className="agent-session__menu">
                <button type="button" onClick={() => startRename(s)}>重命名</button>
                <button
                  type="button"
                  onClick={() => {
                    setMenuId(null)
                    onTogglePin(s.sessionId, !s.isPinned)
                  }}
                >
                  {s.isPinned ? "取消置顶" : "置顶"}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setMenuId(null)
                    onExport(s.sessionId, "markdown")
                  }}
                >
                  导出 Markdown
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setMenuId(null)
                    onExport(s.sessionId, "json")
                  }}
                >
                  导出 JSON
                </button>
                <button
                  type="button"
                  className="is-danger"
                  onClick={() => {
                    setMenuId(null)
                    if (window.confirm(`删除会话「${s.title || "新对话"}」？`)) onDelete(s.sessionId)
                  }}
                >
                  删除
                </button>
              </div>
            )}
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
          {/* 「选择」是列表头的小动作，不跟主操作抢同一行按钮位。 */}
          {!selectMode ? (
            <button
              type="button"
              className="agent-sessions__select"
              onClick={() => setSelectMode(true)}
            >
              选择
            </button>
          ) : null}
          <button
            type="button"
            className="agent-sessions__collapse"
            onClick={onCollapse}
            aria-label="收起会话栏"
            title="收起会话栏"
          >
            <ChevronLeft size={14} strokeWidth={2} aria-hidden="true" />
          </button>
        </div>
        <div className="agent-sessions__actions">
          {selectMode ? (
            <>
              <button
                type="button"
                className="agent-sessions__select"
                style={{ color: "var(--risk-critical)" }}
                disabled={checked.size === 0 || busy}
                onClick={() => {
                  if (window.confirm(`删除选中的 ${checked.size} 个会话？`)) {
                    onBatchDelete([...checked])
                    setChecked(new Set())
                    setSelectMode(false)
                  }
                }}
              >
                删除 {checked.size}
              </button>
              <button
                type="button"
                className="agent-sessions__select"
                onClick={() => {
                  setSelectMode(false)
                  setChecked(new Set())
                }}
              >
                取消
              </button>
            </>
          ) : (
            <button
              type="button"
              className="agent-sessions__newchat"
              onClick={onNewChat}
              disabled={busy}
            >
              <Plus size={14} strokeWidth={2.5} aria-hidden="true" />
              <span>新对话</span>
            </button>
          )}
        </div>
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
    </aside>
  )
}
