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
import {
  useAgentStream,
  mapHistoryMessage,
  parseServerTime,
  AgentSendError,
  type StreamMessage,
} from "@/lib/agentStream"
import { createAgentUploader } from "@/lib/agentUpload"
import { useSession } from "@/lib/session"
import { loadThreadId, saveThreadId } from "@/lib/threadStorage"
import { newId } from "@/lib/id"
import { formatClock } from "@/lib/time"
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
 * 历史核对时允许的时钟偏差。服务端时间不带时区、按本地解析，客户端与服务端
 * 也可能有偏差；10 分钟足够宽，又能把「用户半小时前问过一模一样的话」排除掉。
 */
const RECONCILE_CLOCK_SKEW_MS = 10 * 60 * 1000

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
  // 每推入一条用户气泡就加一。历史响应回来时这个值变了，说明这期间用户
  // 又发了消息——晚到的历史是旧的，不能整表覆盖。
  const turnCounter = useRef(0)
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

  // 当前身份的 ref 版本：异步回调回来时要能和「现在是谁」比对。
  const userKeyRef = useRef<string | null>(null)
  useEffect(() => {
    userKeyRef.current = userKey
  }, [userKey])

  // 会话列表请求的序号与发起时的身份：换账号后旧响应晚到，既不能覆盖新列表，
  // 也不能把别人的会话标题留在左栏。
  const sessionsSeq = useRef(0)
  const refreshSessions = useCallback(async () => {
    const seq = ++sessionsSeq.current
    const expectedUser = userKeyRef.current
    try {
      const list = await getSessions()
      if (seq !== sessionsSeq.current || userKeyRef.current !== expectedUser) return
      setSessions(list)
    } catch (e) {
      console.warn("加载会话列表失败", e)
    }
  }, [])

  const loadHistoryMessages = useCallback(
    async (id: string) => {
      const seq = ++historySeq.current
      const expectedUser = userKeyRef.current
      const turnsAtRequest = turnCounter.current
      // 合并去重的时间门槛：只承认「本轮之后才落库」的那条才算副本。
      const requestedAt = Date.now()
      // 加载态在发起请求的那一刻置位；调用方是事件处理器或初始化 effect。
      setHistoryLoading(true)
      try {
        const data = await getChatHistory(id, undefined, HISTORY_PAGE_SIZE)
        // 晚到的旧会话历史不能覆盖当前会话——序号变了或人已经切走，直接丢弃。
        if (seq !== historySeq.current || threadIdRef.current !== id) return
        // 换了账号：这条历史属于上一个身份，不写回。
        if (userKeyRef.current !== expectedUser) return
        const raw = data.messages ?? []
        const history = raw.map(mapHistoryMessage)
        // 时间门槛与 reconcileDelivery 同一口径：只比内容会把「用户十分钟前问过
        // 一模一样的一句话」当成副本删掉，而删的是带 delivery / images 的本地气泡。
        const tailAt = parseServerTime(raw[raw.length - 1]?.createdTime)
        const freshTail = tailAt === null || tailAt >= requestedAt - RECONCILE_CLOCK_SKEW_MS
        if (turnCounter.current !== turnsAtRequest) {
          // 请求期间用户又发了消息：历史里没有这一轮，整表替换会把它抹掉。
          // 但直接丢弃会让这段历史**永远**加载不上（守卫不会复位）。所以把
          // 本地这一轮接在历史后面——既不丢历史，也不丢提问。
          setMessages((prev) => {
            // 本地回合从**第一条带 delivery 的用户气泡**开始，之后才是流里长出来的
            // 助手内容、推理与工具卡。只挑用户气泡会把助手回复和工具卡一起扔掉
            // （用户看到「问题还在、回答没了」），整表替换则连提问都抹掉。
            const localStart = prev.findIndex(
              (message) => message.type === "user" && message.delivery,
            )
            const local = localStart < 0 ? [] : prev.slice(localStart)
            const tail = history[history.length - 1]
            const first = local[0]
            // 这一页偶尔已经包含刚发的那条（新会话的第一页就是整段会话）：
            // 此时本地第一条用户气泡是它的副本，只丢这一条，后面的照接。
            const duplicated =
              freshTail &&
              first?.type === "user" &&
              tail?.type === "user" &&
              tail.content === first.content
            return [...history, ...(duplicated ? local.slice(1) : local)]
          })
          return
        }
        setMessages(history)
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

  /** 只改这一条气泡的送达状态，不动其它消息。 */
  const markDelivery = useCallback(
    (id: string, delivery: NonNullable<StreamMessage["delivery"]>) => {
      setMessages((prev) => {
        const index = prev.findIndex((message) => message.id === id)
        if (index < 0) return prev
        const current = prev[index]
        if (current.delivery === delivery) return prev
        const next = [...prev]
        next[index] = { ...current, delivery }
        return next
      })
    },
    [setMessages],
  )

  /**
   * 发送结果未知时，用历史接口核对这条提问到底有没有落库。
   *
   * <p>只读、不重发：如果服务端其实收到了，自动重试会写出一条重复的用户轮次。
   * 核对本身失败（断网、超时）就停在「未确认」——那正是我们知道的全部。
   *
   * <p>`sentAt` 是发起发送时客户端的时间。服务端时间取本地时区，两边时钟
   * 可能有偏差，所以只用来排除**明显更早**的同文消息（用户以前问过一模一样的
   * 问题），不作为精确判据。
   */
  const reconcileDelivery = useCallback(
    async (localId: string, threadId: string, text: string, sentAt: number) => {
      const expectedUser = userKeyRef.current
      try {
        const data = await getChatHistory(threadId, undefined, HISTORY_PAGE_SIZE)
        // 核对期间换了账号：这条结果属于上一个身份的会话，一律不许写回。
        if (userKeyRef.current !== expectedUser) return
        // 不带游标返回的是**最早**一页。hasMore 为真说明后面还有消息，
        // 刚发的那条不可能在这一页里——没有判断依据，停在「未确认」。
        if (data.hasMore) return
        const lastUser = [...(data.messages ?? [])]
          .reverse()
          .find((message) => (message.role ?? "").toUpperCase() === "USER")
        // 只能「升级」不能「证伪」：查不到 ≠ 没送到（落库还在队列里），
        // 所以绝不标成「未送达」。
        if (!lastUser || lastUser.content !== text) return
        const at = parseServerTime(lastUser.createdTime)
        if (at !== null && at < sentAt - RECONCILE_CLOCK_SKEW_MS) return
        markDelivery(localId, "accepted")
      } catch {
        // 核对不了就保持「未确认」：不猜服务端有没有收到。
      }
    },
    [markDelivery],
  )

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
        turnCounter.current += 1
        // 发起时间：历史核对用它排除「以前问过一模一样的话」
        const sentAt = Date.now()
        // 发送期间换了账号：收尾一律不许把旧身份的结果写进新身份
        const expectedUser = userKeyRef.current
        pushUser({
          id: localId,
          type: "user",
          content: text,
          time: formatClock(new Date()),
          images: imageUrls,
          delivery: "sending",
        })

        try {
          // 响应头一到就在回调里翻成「已受理」：此后流中途断掉，这一轮也确实
          // 已经受理了，不能因为流没跑完就退回「未确认」。
          const outcome = await send(text, usedThreadId, imageUrls, () =>
            markDelivery(localId, "accepted"),
          )
          if (!outcome.accepted) {
            // 没等到响应头就结束了——只可能是被中止（abort 时 fetch-event-source
            // 是 resolve 不是 reject，所以这里走的是成功分支）。服务端收没收到
            // **不知道**：不写回会话 id、不生成标题（那等于替用户断言这轮成功了），
            // 也不删图片（可能已经被那条消息引用），只用历史接口核对。
            uploader.commitUnknown(imageUrls)
            markDelivery(localId, "unconfirmed")
            void reconcileDelivery(localId, usedThreadId, text, sentAt)
            // 「停止」是用户对**这一条**的处置：草稿留给他重试。
            // 切走会话/换账号则是「这一条已经不属于当前界面」——把上一个会话的
            // 原文灌回新会话的输入框，下一次回车就发到错误的会话里。
            return outcome.abortedBy !== "user"
          }
          uploader.commitSuccess(imageUrls)
          markDelivery(localId, "accepted")
          // 只在仍停留在这个会话、且还是同一个身份时才写回
          if (threadIdRef.current === usedThreadId && userKeyRef.current === expectedUser) {
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
          // 发送失败分三种，不能混为一谈：
          //   ① 拿到了 2xx 流响应头（`accepted`）——用户消息**已入队**（落库是
          //      会话队列里的异步任务，可能还没写）。撤回气泡会得到「界面没有
          //      提问、服务端有记录」，重试还会再写一条；图片也不能删，那条消息
          //      可能已经引用它们。
          //   ② 服务端**明确拒绝**（未登录 / 无权限）——唯一能断言「没有进记录」
          //      的情况：撤回语气最硬，图片也确实没人引用。
          //   ③ 其余（网络失败、超时、5xx、断流）——请求可能已经到了并落库，
          //      只是响应没回来。「没有助手内容」**不能**推断「服务端没收到」，
          //      所以不撤气泡、不删图片，标成「未确认」用历史接口核对；
          //      绝不自动重发。
          const accepted = e instanceof AgentSendError ? e.accepted : false
          const rejected = e instanceof AgentSendError ? e.rejected : false
          const inner = e instanceof AgentSendError ? e.cause : e
          if (accepted) {
            markDelivery(localId, "accepted")
            uploader.commitSuccess(imageUrls)
          } else if (rejected) {
            markDelivery(localId, "failed")
            uploader.commitFailure(imageUrls)
          } else {
            markDelivery(localId, "unconfirmed")
            uploader.commitUnknown(imageUrls)
            void reconcileDelivery(localId, usedThreadId, text, sentAt)
          }
          pushFault(faultFromError(inner, { intent: "send" }))
          return false
        }
      } finally {
        sendingRef.current = false
      }
    },
    [isStreaming, messages.length, threadId, userKey, uploader, pushUser, send, refreshSessions, pushFault, markDelivery, reconcileDelivery],
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
