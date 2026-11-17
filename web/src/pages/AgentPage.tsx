import "@/styles/agent.css"

import { useCallback, useEffect, useRef, useState } from "react"
import { Menu, PanelRight } from "lucide-react"
import {
  batchDeleteSessions,
  deleteSession,
  exportSession,
  generateTitle,
  getChatHistory,
  getSessions,
  updatePinStatus,
  updateSessionTitle,
  type AgentSessionVO,
} from "@/lib/api"
import { useAgentStream, mapHistoryMessage } from "@/lib/agentStream"
import { createAgentUploader } from "@/lib/agentUpload"
import { useSession } from "@/lib/session"
import { loadThreadId, saveThreadId } from "@/lib/threadStorage"
import { newId } from "@/lib/id"
import { useMediaQuery } from "@/lib/useMediaQuery"
import { faultFromError } from "@/lib/faults"
import { useFault } from "@/components/fault"
import { Dialog } from "@/components/ui/dialog"
import { MessageList } from "@/components/agent/MessageList"
import { ChatInput, type ChatInputHandle } from "@/components/agent/ChatInput"
import { SessionList } from "@/components/agent/SessionList"
import { ResourcePanel } from "@/components/agent/ResourcePanel"
import { ProductHeader } from "@/components/shell/ProductHeader"
import { IrisPageLoading } from "@/components/system/IrisStates"

const HISTORY_PAGE_SIZE = 100

/**
 * 断点：1024px 以下会话导航与资源面板都改成抽屉。
 *
 * 旧版用 900px，768px 平板上会挤成「导航 + 窄对话」两列，正文宽度不到
 * 400px。1024 把平板也交给抽屉，桌面才有完整的 264 / 320 两根侧栏。
 */
const COMPACT_QUERY = "(max-width: 1023px)"

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
  const { status, user } = useSession()

  // 与 useAgentStream 的 messages 单一数据源：历史加载也走 setMessages
  const stream = useAgentStream()
  const { messages, isStreaming, resources, send, abort, pushUser, setMessages, reset } = stream
  // 上传器每次创建返新对象——不固定住的话 handleSend 的 useCallback
  // 依赖每渲染都变，等于没有 memo。用惰性 state 只建一次。
  const [uploader] = useState(createAgentUploader)

  const [threadId, setThreadId] = useState(() => newId())
  // 追踪当前会话：发送期间用户可能切会话，闭包里的 threadId 是旧值，
  // 判断「是否还在这个会话」必须读 ref。渲染期写 ref 在并发模式下不安全，
  // 所以在 effect 里同步。
  const threadIdRef = useRef(threadId)
  useEffect(() => {
    threadIdRef.current = threadId
  }, [threadId])
  // 历史响应的序号：切会话后，旧请求晚到也不能把内容写进新会话。
  const historySeq = useRef(0)
  // 当前登录身份的稳定键：登录/登出/换账号时要清掉上一个身份的会话态。
  const userKey = user?.id ?? null
  const lastUserKeyRef = useRef<string | null | undefined>(undefined)
  const [currentThreadId, setCurrentThreadId] = useState("")
  const [sessions, setSessions] = useState<AgentSessionVO[]>([])
  // 紧凑档（平板与手机）：会话导航与资源面板都是抽屉，不占正文宽度。
  const compact = useMediaQuery(COMPACT_QUERY)
  // 桌面档：导航栏可以自己收起（正文更宽）；紧凑档不再有这个状态。
  const [navCollapsed, setNavCollapsed] = useState(false)
  // 紧凑档的抽屉开关。
  const [navOpen, setNavOpen] = useState(false)
  const [panelOpen, setPanelOpen] = useState(false)
  const [historyLoading, setHistoryLoading] = useState(false)
  const [previewUrl, setPreviewUrl] = useState("")
  const previewCloseRef = useRef<HTMLButtonElement>(null)
  const [busy, setBusy] = useState(false)
  // 上传中：给「图片还在路上」一个诚实的反馈，不假装已经收到回复。
  const [uploading, setUploading] = useState(false)
  // 欢迎屏「上传眼底图像」→ 输入区选图：文件对话框必须由用户手势同步打开
  // （WebKit 限制），所以持有输入区的 ref 直接调 pickImage()，不走 effect/信号。
  const chatInputRef = useRef<ChatInputHandle>(null)
  const pickImage = useCallback((prefill: string) => {
    // 先预填引导句再开对话框：选完图回来，草稿已经在了。
    chatInputRef.current?.prefill(prefill)
    chatInputRef.current?.pickImage()
  }, [])
  // 失败一律走全站统一的瞬时读数，不再在正文里插一条横幅。
  const { push: pushFault } = useFault()

  // 图片预览是一层模态：焦点移入关闭钮，Esc 关闭，关闭后归还给触发元素。
  useEffect(() => {
    if (!previewUrl) return
    const trigger = document.activeElement as HTMLElement | null
    previewCloseRef.current?.focus({ preventScroll: true })
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setPreviewUrl("")
    }
    document.addEventListener("keydown", onKey)
    return () => {
      document.removeEventListener("keydown", onKey)
      if (trigger && document.contains(trigger)) trigger.focus({ preventScroll: true })
    }
  }, [previewUrl])

  const refreshSessions = useCallback(async () => {
    try {
      setSessions(await getSessions())
    } catch (e) {
      console.warn("加载会话列表失败", e)
    }
  }, [])

  const loadHistoryMessages = useCallback(
    async (id: string) => {
      const seq = ++historySeq.current
      // 加载态在发起请求的那一刻置位；调用方是事件处理器或初始化 effect。
      setHistoryLoading(true)
      try {
        const data = await getChatHistory(id, undefined, HISTORY_PAGE_SIZE)
        // 晚到的旧会话历史不能覆盖当前会话——序号变了或人已经切走，直接丢弃。
        if (seq !== historySeq.current || threadIdRef.current !== id) return
        setMessages((data.messages ?? []).map(mapHistoryMessage))
      } catch (e) {
        if (seq === historySeq.current) pushFault(faultFromError(e, { intent: "load" }))
      } finally {
        if (seq === historySeq.current) setHistoryLoading(false)
      }
    },
    [setMessages, pushFault],
  )

  useEffect(() => {
    if (status !== "authed") return
    // 登录身份变了（首次登录 / 换账号）：先清掉上一个身份的会话态，
    // 再按新身份的 key 恢复；否则会拿别人的会话 id 去拉历史。
    if (lastUserKeyRef.current !== userKey) {
      lastUserKeyRef.current = userKey
      setThreadId(newId())
      setCurrentThreadId("")
      // 会话列表也要清：reset() 只清消息与资源。refreshSessions() 是异步的，
      // 且失败时只 console.warn——不清就会让上一个身份的会话标题留在左栏，
      // 甚至一直留到刷新失败之后。标题本身是敏感信息。
      setSessions([])
      reset()
    }
    const savedThreadId = loadThreadId(userKey)
    // refreshSessions 的首个操作是 await getSessions()，状态更新不在 effect 同步阶段。
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refreshSessions()
    if (savedThreadId) {
      void loadHistoryMessages(savedThreadId)
      // 没有已保存的会话时保留初始化时生成的 threadId：
      // 用空串覆盖会让首条消息以空 threadId 发出，后端随即另建一个会话，
      // 前端却仍把消息挂在这个空 id 上，两边就此分叉。
      setCurrentThreadId(savedThreadId)
      setThreadId(savedThreadId)
    }
  }, [status, userKey, reset, refreshSessions, loadHistoryMessages])

  // 发送互斥：从「开始上传」到「这一回合的流结束」为止。
  //
  // <p>`isStreaming` 要等上传完、`send()` 真正开始才变 true——上传那几秒里
  // 再触发一次发送会并发上传并推入第二条用户消息。ref 同步置位，跨上传与
  // 流式两段生命周期；被拦下的调用直接返回 false，输入区据此把原文留住。
  const sendingRef = useRef(false)

  const handleSend = useCallback(
    async (text: string, files: File[] = []): Promise<boolean> => {
      if ((!text.trim() && files.length === 0) || isStreaming) return false
      if (sendingRef.current) return false
      sendingRef.current = true

      try {
        // 必须在 pushUser 之前判断：用户消息推入后 messages 已非空，
        // 放到后面判断会让"是否首条消息"永远为假，标题生成从不触发。
        const isFirstMessage = messages.length === 0
        // 本回合用的会话 id：发送过程中用户可能切了会话，收尾时只能写回这一个
        const usedThreadId = threadId

        let imageUrls: string[] = []
        if (files.length > 0) {
          setUploading(true)
          try {
            const result = await uploader.uploadFiles(files)
            imageUrls = result.urls
          } catch (e) {
            pushFault(faultFromError(e, { intent: "upload" }))
            return false
          } finally {
            setUploading(false)
          }
        }

        const localId = newId()
        pushUser({
          id: localId,
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
            saveThreadId(userKey, usedThreadId)
            setCurrentThreadId(usedThreadId)
          }

          // 首条消息触发 AI 生成标题，完成后刷新列表
          if (isFirstMessage) {
            void generateTitle(usedThreadId, text)
              .then(() => refreshSessions())
              .catch((e) => console.warn("标题生成触发失败", e))
          }
          return true
        } catch (e) {
          uploader.commitFailure(imageUrls)
          // 发送失败：**只有服务端压根没受理**才撤回乐观用户气泡。
          //
          // 后端在开流之前就把用户消息落库了（AgentController 先 saveUserMessage 再
          // diagnosisAgent.stream）。只要这一回合已经流出了任何内容，这条用户消息在
          // 服务端一定存在；此时撤回会得到「界面没有提问、服务端有记录」，用户按提示
          // 重试还会再写一条同样的用户轮次。所以：本条之后还有消息（assistant/工具卡）
          // 就全部保留；一条都没有才当作「没发出去」。找不到本条时什么也不做——
          // 那说明用户中途切走了会话，改的是别的线程的数组。
          setMessages((prev) => {
            const index = prev.findIndex((message) => message.id === localId)
            if (index < 0) return prev
            const producedTurnContent = prev.length > index + 1
            return producedTurnContent ? prev : prev.filter((message) => message.id !== localId)
          })
          pushFault(faultFromError(e, { intent: "send" }))
          return false
        }
      } finally {
        sendingRef.current = false
      }
    },
    [isStreaming, messages.length, threadId, userKey, uploader, pushUser, send, setMessages, refreshSessions, pushFault],
  )

  const handleNewChat = useCallback(() => {
    saveThreadId(userKey, "")
    setCurrentThreadId("")
    setThreadId(newId())
    reset()
    setPanelOpen(false)
    // 紧凑档上会话栏是盖住对话的抽屉：选完就收回去，别让用户再手动收一次。
    if (compact) setNavOpen(false)
  }, [reset, userKey, compact])

  const handleSelectHistory = useCallback(
    async (id: string) => {
      setCurrentThreadId(id)
      setThreadId(id)
      saveThreadId(userKey, id)
      reset()
      setPanelOpen(false)
      if (compact) setNavOpen(false)
      await loadHistoryMessages(id)
    },
    [reset, userKey, loadHistoryMessages, compact],
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
        pushFault(faultFromError(e, { intent: "load" }))
        return false
      } finally {
        setBusy(false)
      }
    },
    [refreshSessions, pushFault],
  )

  const handleDelete = useCallback(
    (id: string) => {
      // 返回值是「服务端真的删掉了」的唯一依据：会话列表据此决定收起确认框，
      // 失败时保留会话与当前选择，不假装成功。
      return afterSessionChange(() => deleteSession(id)).then((ok) => {
        // 删除失败时不清空当前对话——否则会话还在服务端，用户却以为删掉了
        if (ok && id === currentThreadId) handleNewChat()
        return ok
      })
    },
    [afterSessionChange, currentThreadId, handleNewChat],
  )

  const handleBatchDelete = useCallback(
    (ids: string[]) => {
      return afterSessionChange(() => batchDeleteSessions(ids)).then((ok) => {
        if (ok && ids.includes(currentThreadId)) handleNewChat()
        return ok
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

  // 子组件的 memo 依赖：这些回调必须引用稳定，否则 SessionList / MessageList
  // 每片 token 都会因为收到新 props 而整棵重渲染。
  const handleSelectSession = useCallback(
    (id: string) => void handleSelectHistory(id),
    [handleSelectHistory],
  )
  const handleRenameSession = useCallback(
    (id: string, title: string) => afterSessionChange(() => updateSessionTitle(id, title)),
    [afterSessionChange],
  )
  const handleTogglePinSession = useCallback(
    (id: string, pinned: boolean) =>
      void afterSessionChange(() => updatePinStatus(id, pinned)),
    [afterSessionChange],
  )
  const handleCollapseSessions = useCallback(() => setNavCollapsed(true), [])
  const handleSendText = useCallback((text: string) => void handleSend(text), [handleSend])

  // 会话栏的全部操作打包成一份：桌面侧栏与紧凑档抽屉共用同一份组件。
  const sessionPanel = (
    <SessionList
      sessions={sessions}
      activeId={currentThreadId}
      busy={busy}
      onNewChat={handleNewChat}
      onSelect={handleSelectSession}
      onRename={handleRenameSession}
      onDelete={handleDelete}
      onBatchDelete={handleBatchDelete}
      onTogglePin={handleTogglePinSession}
      onExport={handleExport}
      onCollapse={compact ? undefined : handleCollapseSessions}
    />
  )

  // 顶栏标题用真实会话标题；新会话没有标题就写「新对话」，不编号。
  const threadTitle =
    sessions.find((s) => s.sessionId === currentThreadId)?.title?.trim() ||
    (currentThreadId ? "新对话" : "")

  // 等待态：上传中，或已发送但第一条真实事件还没到。
  const lastMessage = messages[messages.length - 1]
  const awaitingFirstEvent =
    isStreaming && messages.length > 0 && lastMessage?.type === "user"
  const waiting = uploading
    ? { active: true, label: "正在上传图片" }
    : { active: awaitingFirstEvent, label: "正在接收回复" }

  const resourcePanel = (
    <ResourcePanel
      open
      resources={resources}
      onClose={() => setPanelOpen(false)}
      onPreviewImage={setPreviewUrl}
    />
  )

  if (status === "loading") {
    return (
      <div className="is-field is-brand-page">
        <ProductHeader scene="intelligence" />
        <main className="agent-viewport">
          <IrisPageLoading title="正在核对登录状态" hint="正在准备对话工作区，请稍候。" />
        </main>
      </div>
    )
  }

  // 未登录不拦页面：先把界面给出来，等真的调 agent 接口拿到 40100/40101
  // 再由路由层跳登录页（带回跳地址）。
  return (
    <div className="is-field is-brand-page">
      <ProductHeader scene="intelligence" />

      <main className="agent-viewport">
        <div
          className={`agent-workspace${compact ? " is-compact" : ""}${
            !compact && navCollapsed ? " is-nav-collapsed" : ""
          }${panelOpen && !compact ? " is-rail-open" : ""}`}
        >
          {/* 桌面：会话导航常驻左栏（收起靠宽度动画，从 DOM 摘掉会让
              中栏自动排进左列而塌成窄条）。紧凑档：改抽屉，见下。 */}
          {!compact ? (
            <div className={`agent-nav${navCollapsed ? " is-collapsed" : ""}`}>
              {sessionPanel}
            </div>
          ) : null}

          <div className="agent-main">
            <MessageList
              messages={messages}
              loading={historyLoading}
              streaming={isStreaming}
              waiting={waiting}
              title={threadTitle}
              onSend={handleSendText}
              onPreviewImage={setPreviewUrl}
              onPickImage={pickImage}
              headLeft={
                <>
                  {compact ? (
                    <button
                      type="button"
                      className="agent-iconbtn"
                      onClick={() => setNavOpen(true)}
                      aria-label="打开会话列表"
                      title="会话列表"
                    >
                      <Menu size={18} strokeWidth={2} aria-hidden="true" />
                    </button>
                  ) : navCollapsed ? (
                    <button
                      type="button"
                      className="agent-iconbtn"
                      onClick={() => setNavCollapsed(false)}
                      aria-label="展开会话栏"
                      title="展开会话栏"
                    >
                      <Menu size={18} strokeWidth={2} aria-hidden="true" />
                    </button>
                  ) : null}
                  {status === "anon" ? (
                    <span className="agent-anon">未登录 · 发送时将引导登录</span>
                  ) : null}
                </>
              }
              headRight={
                <button
                  type="button"
                  className={`agent-iconbtn${panelOpen ? " is-active" : ""}`}
                  onClick={() => setPanelOpen((v) => !v)}
                  aria-expanded={panelOpen}
                  aria-label="资源面板"
                  title="资源面板"
                >
                  <PanelRight size={18} strokeWidth={2} aria-hidden="true" />
                  {resources.images.length + resources.links.length > 0 ? (
                    <span className="agent-iconbtn__badge">
                      {resources.images.length + resources.links.length}
                    </span>
                  ) : null}
                </button>
              }
            />

            <div className="agent-composer">
              <ChatInput
                ref={chatInputRef}
                disabled={false}
                streaming={isStreaming}
                onSend={handleSend}
                onStop={abort}
              />
            </div>
          </div>

          {/* 桌面：资源面板是右侧常驻栏；紧凑档：改抽屉。 */}
          {!compact && panelOpen ? (
            <div className="agent-rail">{resourcePanel}</div>
          ) : null}
        </div>
      </main>

      {/* 紧凑档抽屉：会话导航 */}
      {compact ? (
        <Dialog
          open={navOpen}
          title="会话"
          onClose={() => setNavOpen(false)}
          className="agent-drawer is-left"
        >
          {sessionPanel}
        </Dialog>
      ) : null}

      {/* 紧凑档抽屉：资源面板 */}
      {compact && panelOpen ? (
        <Dialog
          open={panelOpen}
          title="资源面板"
          onClose={() => setPanelOpen(false)}
          className="agent-drawer is-right"
        >
          {resourcePanel}
        </Dialog>
      ) : null}

      {previewUrl && (
        <div
          className="agent-preview"
          onClick={() => setPreviewUrl("")}
          role="dialog"
          aria-modal="true"
          aria-label="图片预览"
        >
          <button
            ref={previewCloseRef}
            type="button"
            className="agent-preview__close"
            aria-label="关闭预览"
            onClick={(e) => {
              e.stopPropagation()
              setPreviewUrl("")
            }}
          >
            ✕
          </button>
          <img src={previewUrl} alt="预览" onClick={(e) => e.stopPropagation()} />
          <a
            className="agent-preview__open"
            href={previewUrl}
            target="_blank"
            rel="noreferrer"
            onClick={(e) => e.stopPropagation()}
          >
            原图 ↗
          </a>
        </div>
      )}
    </div>
  )
}
