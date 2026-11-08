import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Link } from "react-router-dom"
import {
  ApiError,
  batchDeleteSessions,
  deleteSession,
  describeError,
  exportSession,
  generateTitle,
  getChatHistory,
  getSessions,
  updatePinStatus,
  updateSessionTitle,
  type AgentSessionVO,
} from "@/lib/api"
import { useAgentStream, mapHistoryMessage } from "@/lib/agentStream"
import { useAgentUpload } from "@/lib/agentUpload"
import { useSession } from "@/lib/session"
import { MessageList } from "@/components/agent/MessageList"
import { ChatInput } from "@/components/agent/ChatInput"
import { SessionList } from "@/components/agent/SessionList"
import { ResourcePanel } from "@/components/agent/ResourcePanel"
import { SiteFooter } from "@/components/SiteFooter"
import { SiteHeader } from "@/components/SiteHeader"

const THREAD_ID_KEY = "agent_current_thread_id"
const HISTORY_PAGE_SIZE = 100

const generateThreadId = () =>
  typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`

const loadThreadId = () => localStorage.getItem(THREAD_ID_KEY) || ""

const saveThreadId = (id: string) => {
  if (id) localStorage.setItem(THREAD_ID_KEY, id)
  else localStorage.removeItem(THREAD_ID_KEY)
}

/** 文件名净化：去掉路径分隔符与系统不允许的字符。 */
function safeFileName(name: string): string {
  const cleaned = name.replace(/[\\/:*?"<>|]/g, "_").trim()
  return cleaned || "会话"
}

/** Blob 下载：必须挂进 DOM 再点击，且 revoke 要等一拍，否则部分浏览器下载静默失败。 */
function downloadText(content: string, filename: string, mime: string) {
  const blob = new Blob([content], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = filename
  a.style.display = "none"
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  window.setTimeout(() => URL.revokeObjectURL(url), 0)
}

export function AgentPage() {
  const { status } = useSession()

  // 与 useAgentStream 的 messages 单一数据源：历史加载也走 setMessages
  const stream = useAgentStream()
  const { messages, isStreaming, resources, send, abort, pushUser, setMessages, reset } = stream
  // useAgentUpload 每次调用返新对象——不固定住的话 handleSend 的 useCallback
  // 依赖每渲染都变，等于没有 memo。
  const uploader = useMemo(() => useAgentUpload(), [])

  const [threadId, setThreadId] = useState(() => generateThreadId())
  // 追踪当前会话：发送期间用户可能切会话，闭包里的 threadId 是旧值，
  // 判断「是否还在这个会话」必须读 ref。
  const threadIdRef = useRef(threadId)
  threadIdRef.current = threadId
  const [currentThreadId, setCurrentThreadId] = useState("")
  const [sessions, setSessions] = useState<AgentSessionVO[]>([])
  const [sessionsCollapsed, setSessionsCollapsed] = useState(false)
  const [panelOpen, setPanelOpen] = useState(false)
  const [historyLoading, setHistoryLoading] = useState(false)
  const [previewUrl, setPreviewUrl] = useState("")
  const [notice, setNotice] = useState("")
  const [busy, setBusy] = useState(false)

  const refreshSessions = useCallback(async () => {
    try {
      setSessions(await getSessions())
    } catch (e) {
      console.warn("加载会话列表失败", e)
    }
  }, [])

  const loadHistoryMessages = useCallback(
    async (id: string) => {
      setHistoryLoading(true)
      try {
        const data = await getChatHistory(id, undefined, HISTORY_PAGE_SIZE)
        const mapped = (data.messages ?? []).map(mapHistoryMessage)
        setMessages(mapped)
      } catch (e) {
        setNotice(describeError(e).text)
      } finally {
        setHistoryLoading(false)
      }
    },
    [setMessages],
  )

  useEffect(() => {
    if (status !== "authed") return
    const savedThreadId = loadThreadId()
    void refreshSessions()
    if (savedThreadId) {
      void loadHistoryMessages(savedThreadId)
      // 没有已保存的会话时保留初始化时生成的 threadId：
      // 用空串覆盖会让首条消息以空 threadId 发出，后端随即另建一个会话，
      // 前端却仍把消息挂在这个空 id 上，两边就此分叉。
      setCurrentThreadId(savedThreadId)
      setThreadId(savedThreadId)
    }
  }, [status, refreshSessions, loadHistoryMessages])

  const handleSend = useCallback(
    async (text: string, files: File[] = []) => {
      if ((!text.trim() && files.length === 0) || isStreaming) return

      // 必须在 pushUser 之前判断：用户消息推入后 messages 已非空，
      // 放到后面判断会让"是否首条消息"永远为假，标题生成从不触发。
      const isFirstMessage = messages.length === 0
      // 本回合用的会话 id：发送过程中用户可能切了会话，收尾时只能写回这一个
      const usedThreadId = threadId

      let imageUrls: string[] = []
      try {
        if (files.length > 0) {
          const result = await uploader.uploadFiles(files)
          imageUrls = result.urls
        }
      } catch {
        setNotice("图片上传失败，无法发送消息")
        return
      }

      pushUser({
        id: crypto.randomUUID(),
        type: "user",
        content: text,
        time: new Date().toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" }),
        images: imageUrls,
      })

      try {
        await send(text, usedThreadId, imageUrls)
        uploader.commitSuccess(imageUrls)
        // 只在仍停留在这个会话时才写回——用户中途切走就别覆盖他的选择
        if (threadIdRef.current === usedThreadId) {
          saveThreadId(usedThreadId)
          setCurrentThreadId(usedThreadId)
        }
        setNotice("")

        // 首条消息触发 AI 生成标题，完成后刷新列表
        if (isFirstMessage) {
          void generateTitle(usedThreadId, text)
            .then(() => refreshSessions())
            .catch((e) => console.warn("标题生成触发失败", e))
        }
      } catch (e) {
        uploader.commitFailure(imageUrls)
        setNotice(
          e instanceof ApiError && e.code === -1
            ? "连接中断，消息可能没有送达"
            : "消息发送失败，请检查网络后重试",
        )
      }
    },
    [isStreaming, messages.length, threadId, uploader, pushUser, send, refreshSessions],
  )

  const handleNewChat = useCallback(() => {
    saveThreadId("")
    setCurrentThreadId("")
    setThreadId(generateThreadId())
    reset()
    setPanelOpen(false)
  }, [reset])

  const handleSelectHistory = useCallback(
    async (id: string) => {
      setCurrentThreadId(id)
      setThreadId(id)
      saveThreadId(id)
      reset()
      setPanelOpen(false)
      await loadHistoryMessages(id)
    },
    [reset, loadHistoryMessages],
  )

  /** 删除/置顶/重命名后刷新列表（Vue 版这里漏绑导致列表不刷新，勿复刻）。 */
  const afterSessionChange = useCallback(
    async (action: () => Promise<unknown>) => {
      setBusy(true)
      try {
        await action()
        await refreshSessions()
        return true
      } catch (e) {
        setNotice(describeError(e).text)
        return false
      } finally {
        setBusy(false)
      }
    },
    [refreshSessions],
  )

  const handleDelete = useCallback(
    (id: string) => {
      void afterSessionChange(() => deleteSession(id)).then((ok) => {
        // 删除失败时不清空当前对话——否则会话还在服务端，用户却以为删掉了
        if (ok && id === currentThreadId) handleNewChat()
      })
    },
    [afterSessionChange, currentThreadId, handleNewChat],
  )

  const handleBatchDelete = useCallback(
    (ids: string[]) => {
      void afterSessionChange(() => batchDeleteSessions(ids)).then((ok) => {
        if (ok && ids.includes(currentThreadId)) handleNewChat()
      })
    },
    [afterSessionChange, currentThreadId, handleNewChat],
  )

  const handleExport = useCallback(
    (id: string, format: "markdown" | "json") => {
      void afterSessionChange(async () => {
        const content = await exportSession(id, format)
        const session = sessions.find((s) => s.sessionId === id)
        const base = safeFileName(session?.title || "会话")
        downloadText(
          content,
          `${base}.${format === "json" ? "json" : "md"}`,
          format === "json" ? "application/json" : "text/markdown",
        )
      })
    },
    [afterSessionChange, sessions],
  )

  if (status === "loading") {
    return (
      <div className="is-field">
        <SiteHeader />
        <main className="wrap">
          <p className="num" style={{ color: "var(--fg-3)" }}>
            LOADING…
          </p>
        </main>
        <div className="wrap">
          <SiteFooter />
        </div>
      </div>
    )
  }

  if (status === "anon") {
    return (
      <div className="is-field">
        <SiteHeader />
        <main className="wrap">
          <div className="notice">
            Agent 对话需要登录。<Link to="/login?redirect=/agent">去登录</Link>
          </div>
        </main>
        <div className="wrap">
          <SiteFooter />
        </div>
      </div>
    )
  }

  return (
    <div className="is-field">
      <SiteHeader />

      <main className="wrap">
        <div className="agent-layout">
          {!sessionsCollapsed && (
            <SessionList
              sessions={sessions}
              activeId={currentThreadId}
              busy={busy}
              onNewChat={handleNewChat}
              onSelect={(id) => void handleSelectHistory(id)}
              onRename={(id, title) =>
                void afterSessionChange(() => updateSessionTitle(id, title))
              }
              onDelete={handleDelete}
              onBatchDelete={handleBatchDelete}
              onTogglePin={(id, pinned) =>
                void afterSessionChange(() => updatePinStatus(id, pinned))
              }
              onExport={handleExport}
              onCollapse={() => setSessionsCollapsed(true)}
            />
          )}

          <div className="agent-main">
            <div className="agent-main__bar">
              {sessionsCollapsed && (
                <>
                  <button type="button" className="btn btn--ghost btn--sm" onClick={() => setSessionsCollapsed(false)}>
                    会话
                  </button>
                  <button type="button" className="btn btn--ghost btn--sm" onClick={handleNewChat}>
                    新建
                  </button>
                </>
              )}
              <button
                type="button"
                className="btn btn--ghost btn--sm"
                style={{ marginLeft: "auto" }}
                onClick={() => setPanelOpen((v) => !v)}
              >
                资源{resources.images.length + resources.links.length > 0
                  ? ` ${resources.images.length + resources.links.length}`
                  : ""}
              </button>
            </div>

            {notice && (
              <div className="notice agent-notice" role="status">
                {notice}
              </div>
            )}

            <MessageList
              messages={messages}
              loading={historyLoading}
              streaming={isStreaming}
              onSend={(text) => void handleSend(text)}
            />

            <ChatInput
              disabled={false}
              streaming={isStreaming}
              onSend={(text, files) => void handleSend(text, files)}
              onStop={abort}
            />
          </div>

          {panelOpen && (
            <ResourcePanel
              open
              resources={resources}
              onClose={() => setPanelOpen(false)}
              onPreviewImage={(url) => setPreviewUrl(url)}
            />
          )}
        </div>
      </main>

      {previewUrl && (
        <div className="agent-preview" onClick={() => setPreviewUrl("")} role="dialog" aria-label="图片预览">
          <img src={previewUrl} alt="预览" onClick={(e) => e.stopPropagation()} />
          <a
            className="agent-preview__open num"
            href={previewUrl}
            target="_blank"
            rel="noreferrer"
            onClick={(e) => e.stopPropagation()}
          >
            原图 ↗
          </a>
        </div>
      )}

      <div className="wrap">
        <SiteFooter />
      </div>
    </div>
  )
}
