import { useMemo } from "react"
import type { CSSProperties, MouseEvent } from "react"
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

/** 助手消息：markdown 渲染 + 代码块复制（事件委托）。流式中尾追闪烁光标。 */
export function AssistantMessage({ msg }: { msg: StreamMessage }) {
  const html = useMemo(() => renderMarkdown(msg.content), [msg.content])
  const bodyStyle: CSSProperties | undefined = msg.isLoading
    ? { "--caret-after": "" } as CSSProperties
    : undefined

  function handleClick(e: MouseEvent<HTMLDivElement>) {
    if (e.target instanceof Element) {
      const text = resolveCopyText(e.target)
      if (text) void copyText(text)
    }
  }

  return (
    <div className="trace agent-msg agent-msg--assistant" style={bodyStyle}>
      <div className="trace__role">AGENT</div>
      <div className="trace__content">
        {msg.isLoading ? (
          <div className="trace__text">
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
        {msg.time && <div className="trace__note num">{msg.time}</div>}
      </div>
    </div>
  )
}
