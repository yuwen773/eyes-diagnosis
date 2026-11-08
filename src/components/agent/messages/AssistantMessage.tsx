import { useMemo } from "react"
import type { MouseEvent } from "react"
import type { StreamMessage } from "@/lib/agentStream"
import { renderMarkdown } from "@/lib/markdown"

async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text)
  } catch {
    // 剪贴板不可用（非安全上下文等）——不静默，给一句提示
    window.alert("复制失败，请手动选择文本复制")
  }
}

/** 从事件目标取复制的文本：copy-btn 带 data-code，否则取相邻 code 块文本。 */
function resolveCopyText(target: Element): string | null {
  const btn = target.closest(".copy-btn")
  if (!btn) return null
  const explicit = btn.getAttribute("data-code")
  if (explicit) return explicit
  const code = btn.closest("pre")?.querySelector("code")
  return code?.textContent ?? null
}

/** 助手消息标头的眼睛图标：构图同 Vue 版（眼形 + 瞳孔 + 两侧节点），节点不做闪烁动画。 */
function AgentEyeIcon() {
  return (
    <svg className="agent-msg__aiicon" width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M2 12C2 12 6 5 12 5C18 5 22 12 22 12C22 12 18 19 12 19C6 19 2 12 2 12Z"
        stroke="currentColor"
        strokeWidth="1.5"
        opacity="0.8"
      />
      <circle cx="12" cy="12" r="2" fill="currentColor" />
      <circle cx="6" cy="12" r="1" fill="currentColor" opacity="0.5" />
      <circle cx="18" cy="12" r="1" fill="currentColor" opacity="0.5" />
    </svg>
  )
}

/**
 * 助手消息：排版复刻 Vue 版 AssistantMessage——左对齐圆角气泡 +
 * 「EyeSight」serif 标头（构图同 Vue 的眼睛图标，令牌换反相带）。
 * 流式中正文按纯文本渲染（带光标），markdown 只在回合结束时渲染一次——
 * 每来一个 token 就对累积全文做一遍 markdown+hljs 是 O(n²) 的无用开销。
 */
export function AssistantMessage({ msg }: { msg: StreamMessage }) {
  // 流式期间正文按纯文本渲染（带光标），markdown 只在回合结束时渲染一次
  const html = useMemo(
    () => (msg.isLoading ? "" : renderMarkdown(msg.content)),
    [msg.isLoading, msg.content],
  )

  function handleClick(e: MouseEvent<HTMLDivElement>) {
    if (e.target instanceof Element) {
      const text = resolveCopyText(e.target)
      if (text) void copyText(text)
    }
  }

  return (
    <div className="agent-msg--assistant">
      <div className="agent-msg__bubble-ai">
        <div className="agent-msg__aihead">
          <AgentEyeIcon />
          <span className="agent-msg__ainame">EyeSight</span>
        </div>
        {msg.isLoading ? (
          <div className="agent-msg__text">
            <span className="agent-msg__streaming">{msg.content}</span>
            <span className="caret-blink" aria-hidden="true" />
          </div>
        ) : (
          <div
            className="markdown-body"
            onClick={handleClick}
            dangerouslySetInnerHTML={{ __html: html }}
          />
        )}
        {msg.time && <div className="agent-msg__time num">{msg.time}</div>}
      </div>
    </div>
  )
}
