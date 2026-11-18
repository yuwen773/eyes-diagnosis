import type { MouseEvent } from "react"
import type { StreamMessage } from "@/lib/agentStream"
import { useFault } from "@/components/fault"
import { infoFault } from "@/lib/faults"
import { useStreamingMarkdown } from "@/lib/useStreamingMarkdown"

async function copyText(text: string, onFail: (message: string) => void) {
  try {
    await navigator.clipboard.writeText(text)
  } catch {
    // 剪贴板不可用（非安全上下文等）——不静默，给一句提示
    onFail("复制失败，请手动选择文本复制")
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

/** 助手标识：全站同一个光学虹膜标的简化笔画。 */
function IrisMark() {
  return (
    <svg className="agent-author__mark" width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M2 12C2 12 6 5 12 5C18 5 22 12 22 12C22 12 18 19 12 19C6 19 2 12 2 12Z"
        stroke="currentColor"
        strokeWidth="1.6"
      />
      <circle cx="12" cy="12" r="3" fill="currentColor" />
    </svg>
  )
}

/**
 * 助手消息：**开放式正文**，不是气泡。
 *
 * <p>Iris 的回答是读物：正文占满阅读列，标头只是一行署名。旧版的
 * 「左对齐圆角气泡 + 缩进」把回答压进了一条窄带，右侧留下大片空白。
 *
 * <p>流式期间同样按 Markdown 富文本渲染（增量 + 合帧），不再先显示原始
 * 记号、结束时整篇换一次——那种「纯文本 → 富文本」的跳变正是本轮要修掉的。
 */
export function AssistantMessage({ msg }: { msg: StreamMessage }) {
  const { push } = useFault()
  const html = useStreamingMarkdown(msg.content, Boolean(msg.isLoading))
  const streaming = Boolean(msg.isLoading)

  function handleClick(e: MouseEvent<HTMLDivElement>) {
    if (e.target instanceof Element) {
      const text = resolveCopyText(e.target)
      if (text) void copyText(text, (message) => push(infoFault(message)))
    }
  }

  return (
    <article className="agent-msg agent-msg--assistant" data-msg-id={msg.id}>
      <header className="agent-author">
        <IrisMark />
        <span className="agent-author__name">Iris</span>
        {msg.time ? <span className="agent-author__time">{msg.time}</span> : null}
      </header>

      {/* 流式正文每 60ms 整体换一次 innerHTML：直接给它挂 aria-live 会让读屏
          不停重念全文。这里只用一个隐藏的 status 播报「开始生成」，
          正文本身靠 aria-busy 表示还在写。 */}
      {streaming ? (
        <p className="sr-only" role="status" aria-live="polite">
          Iris 正在生成回答
        </p>
      ) : null}

      <div
        className={`agent-msg__body${streaming ? " is-streaming" : ""}`}
        onClick={handleClick}
        aria-busy={streaming || undefined}
      >
        <div
          className={`markdown-body${streaming ? " is-streaming" : ""}`}
          dangerouslySetInnerHTML={{ __html: html }}
        />
      </div>
    </article>
  )
}
