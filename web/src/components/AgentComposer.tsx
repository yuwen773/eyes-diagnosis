import { useEffect, useRef, useState } from "react"
import type { ClipboardEvent, KeyboardEvent } from "react"
import { Link, useNavigate } from "react-router-dom"
import { ElectricBorder } from "@/components/ElectricBorder"
import { saveDraft } from "@/lib/agentDraft"
import { useSession } from "@/lib/session"

/** 自适应高度上限：落地页只做引子，输入到三行左右就打住，别把边框撑高。 */
const MAX_HEIGHT = 132

/**
 * 落地页的问诊输入框：电流边框包着一条真输入。
 *
 * 提交不是「假演示」：文字存进 agentDraft，跳到 /agent，真实输入框挂载时
 * 会自动把草稿取回来。图片没法跨页传递，所以附件按钮直接带人去 Agent 页，
 * 不在落地页伪造附件芯片。
 */
export function AgentComposer({ dark }: { dark: boolean }) {
  const navigate = useNavigate()
  const { status } = useSession()
  const [text, setText] = useState("")
  const [hint, setHint] = useState("")
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = "auto"
    el.style.height = `${Math.min(el.scrollHeight, MAX_HEIGHT)}px`
  }, [text])

  function submit() {
    const trimmed = text.trim()
    if (!trimmed) return
    saveDraft(trimmed)
    navigate("/agent")
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== "Enter" || event.shiftKey) return
    // 中文输入法组字确认的 Enter 不发送
    if (event.nativeEvent.isComposing) return
    event.preventDefault()
    submit()
  }

  function handlePaste(event: ClipboardEvent<HTMLTextAreaElement>) {
    if (event.clipboardData.files.length === 0) return
    event.preventDefault()
    setHint("图片请在 Agent 页上传，文字会随草稿带过去")
  }

  return (
    <div className="composer">
      <ElectricBorder
        color={dark ? "#e2622b" : "#d9541f"}
        glowColor={dark ? "#e2622b" : "#d9541f"}
        theme={dark ? "dark" : "light"}
        borderRadius={22}
        thickness={1.9}
        strands={4}
        speed={0.9}
        chaos={0.36}
        spread={0.32}
        glow={0.72}
        intensity={dark ? 1 : 0.92}
        flicker={0.4}
        arcs={dark ? 1 : 0}
        cursorRadius={170}
        className="composer__border"
      >
        <div className="composer__box">
          <div className="composer__head">
            <span className="composer__eyebrow">ASK · 诊断 Agent</span>
            <span className="composer__state num">
              {status === "authed" ? "已登录 · 草稿跟随" : "未登录 · 发送时引导登录"}
            </span>
          </div>

          <textarea
            ref={textareaRef}
            className="composer__textarea"
            rows={2}
            value={text}
            placeholder="描述症状，或上传一张眼底照片…"
            aria-label="向诊断 Agent 提问"
            onChange={(event) => {
              setText(event.target.value)
              setHint("")
            }}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
          />

          <div className="composer__row">
            <button
              type="button"
              className="composer__icon"
              aria-label="添加图片"
              title="在 Agent 页上传图片"
              onClick={() => {
                // 已经打好的字先存草稿，别让一次附件跳转把它吃掉
                if (text.trim()) saveDraft(text.trim())
                navigate("/agent")
              }}
            >
              <svg
                width="19"
                height="19"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
              </svg>
            </button>

            <span className="composer__mode num">
              <svg
                width="13"
                height="13"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <circle cx="12" cy="12" r="9" />
                <path d="M12 3v18M3 12h18" />
              </svg>
              全面诊断
            </span>

            <span className="composer__spacer" />

            <button
              type="button"
              className="composer__send"
              aria-label="发送"
              disabled={text.trim().length === 0}
              onClick={submit}
            >
              <svg
                width="17"
                height="17"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <line x1="12" y1="19" x2="12" y2="5" />
                <polyline points="5 12 12 5 19 12" />
              </svg>
            </button>
          </div>
        </div>
      </ElectricBorder>

      <div className="composer__foot">
        <p className="composer__hint num">
          {hint || "ENTER 发送 · SHIFT+ENTER 换行"}
        </p>
        <p className="small composer__note">
          Agent 不确诊、不开处方；涉及用药与手术，一律建议到眼科门诊。
        </p>
        <Link
          to="/agent"
          className="link composer__cta"
          data-cursor
          data-cursor-label="诊断 Agent"
        >
          {status === "authed" ? "进入完整诊断 Agent" : "登录后体验诊断 Agent"}
          <span className="link__mark">→</span>
        </Link>
      </div>
    </div>
  )
}

export default AgentComposer
