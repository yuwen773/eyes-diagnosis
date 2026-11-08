import { useState } from "react"
import type { StreamMessage } from "@/lib/agentStream"

const FOLD_LIMIT = 120

/** 展开箭头：同 Vue 版 ToolResponseMessage 的 expand-icon。 */
function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={{ transform: open ? "rotate(180deg)" : undefined }}
    >
      <polyline points="6 9 12 15 18 9" />
    </svg>
  )
}

/**
 * 工具返回卡：排版复刻 Vue 版 ToolResponseMessage——头部（「返回」徽标 + 工具名 +
 * 展开箭头），点头部整卡折叠/展开；超过 120 字符默认折叠。
 */
export function ToolResponseMessage({ msg }: { msg: StreamMessage }) {
  const [open, setOpen] = useState(msg.content.length <= FOLD_LIMIT)
  const long = msg.content.length > FOLD_LIMIT

  return (
    <div className="agent-toolcard">
      <button
        type="button"
        className="agent-toolcard__head"
        onClick={() => setOpen((v) => !v)}
        style={{ width: "100%", border: 0, background: "none", cursor: "pointer", color: "inherit" }}
        aria-expanded={open}
      >
        <span className="agent-toolcard__tag" style={{ marginLeft: 0, opacity: 1 }}>
          返回
        </span>
        <span className="agent-toolcard__name">{msg.toolName || "工具"}</span>
        <span className="agent-toolcard__icon" style={{ marginLeft: "auto" }}>
          <ChevronIcon open={open} />
        </span>
      </button>
      {open && <div className="agent-toolcard__body">{msg.content}</div>}
      {long && !open && (
        <button
          type="button"
          className="link"
          style={{ margin: "4px 12px 10px", fontSize: 11 }}
          onClick={() => setOpen(true)}
        >
          展开详情
        </button>
      )}
    </div>
  )
}
