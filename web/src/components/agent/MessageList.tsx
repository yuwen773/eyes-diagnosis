import {
  Fragment,
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react"

import type { StreamMessage } from "@/lib/agentStream"
import {
  citationKeysByRound,
  EMPTY_RESOURCES,
  messageRoundById,
  type AgentResources,
  type MessageCitations,
} from "@/lib/agentResources"
import { buildThread } from "@/lib/agentSteps"
import { computeUnread } from "@/lib/agentScroll"
import { UserMessage } from "./messages/UserMessage"
import { AssistantMessage } from "./messages/AssistantMessage"
import { ThoughtLine } from "./ThoughtLine"
import { TurnActions } from "./TurnActions"
import { LatticeLoader } from "./LatticeLoader"
import { WelcomeScreen } from "./WelcomeScreen"

/** 距底 80px 内视为贴底。 */
const BOTTOM_EPSILON = 80

/**
 * 单条消息行。memo 的前提在上游已成立：applyStreamEvent 累加时保留历史
 * 消息的对象引用，只有正在流式的那一条会换新对象。因此每片 token 只需
 * 重渲染最后一行，而不是整个列表。
 */
const EMPTY_CITATIONS: MessageCitations = []

const MessageRow = memo(function MessageRow({
  msg,
  citations,
  onPreviewImage,
  onCite,
}: {
  msg: StreamMessage
  citations: MessageCitations
  onPreviewImage?: (url: string) => void
  onCite?: (evidenceKey: string) => void
}) {
  switch (msg.type) {
    case "user":
      return <UserMessage msg={msg} onPreviewImage={onPreviewImage} />
    case "assistant":
      return <AssistantMessage msg={msg} citations={citations} onCite={onCite} />
    default:
      // reasoning / tool-* / confirm 都在 buildThread 里并入「执行过程」块，
      // 不再逐条平铺。走到这里的只可能是历史数据里的未知类型，不渲染。
      return null
  }
})

/**
 * 消息区：中央阅读列 + 真实事件驱动的执行过程。
 *
 * <p>**不再有仪器读数。** 旧版的 `DIAGNOSIS · AGENT` 头与 `N MSG` 计数
 * 已从主视觉里去掉——它们既不携带信息，也把页面拉回「控制台」的语气。
 * 顶栏只留当前会话的真实标题与两个操作钮。
 *
 * <p>正文列宽上限 820px 并水平居中：对话是读物，不是仪表盘，
 * 正文贴着左边缘、右侧留一大片空白是旧版最刺眼的结构问题。
 */
export function MessageList({
  messages,
  resources,
  loading,
  streaming,
  waiting,
  title,
  onSend,
  onPreviewImage,
  onPickImage,
  onCite,
  onRegenerate,
  onSelectVariant,
  headLeft,
  headRight,
}: {
  messages: StreamMessage[]
  /** 会话资源：正文里的证据角标只按这里的片段核验，不认模型自己写的编号。 */
  resources?: AgentResources
  loading: boolean
  streaming: boolean
  /** 等第一条真实事件到达：上传中 / 等待首个回复。 */
  waiting: { active: boolean; label: string }
  /** 当前会话的真实标题（空会话不显示）。 */
  title?: string
  onSend: (text: string) => void
  onPreviewImage?: (url: string) => void
  /** 欢迎屏「上传眼底图像」：预填引导句并打开输入区的选图对话框。 */
  onPickImage: (prefill: string) => void
  /** 点正文里的证据角标：打开资源栏并定位到那一段。 */
  onCite?: (evidenceKey: string) => void
  /** 按这一轮已存的原文重新生成（只给最后一轮）。参数是用户消息的服务端 id。 */
  onRegenerate?: (userMessageId: string) => void
  /** 切换某一轮显示的回答版本。 */
  onSelectVariant?: (userMessageId: string, variantId: string) => void
  /** 顶栏左侧插槽：折叠后的左栏操作钮组。 */
  headLeft?: ReactNode
  /** 顶栏右侧插槽：资源面板切换钮。 */
  headRight?: ReactNode
}) {
  const listRef = useRef<HTMLDivElement>(null)
  const atBottomRef = useRef(true)
  const [unread, setUnread] = useState(0)

  const lastMsg = messages[messages.length - 1]
  const lastMsgId = lastMsg?.id
  const lastContent = lastMsg?.content

  // 滚动容器始终是同一个元素（欢迎屏也渲染在它里面），
  // 否则监听器会挂不上，用户上翻读历史时被强行拉回底部。
  useEffect(() => {
    const el = listRef.current
    if (!el) return
    const onScroll = () => {
      const near = el.scrollHeight - el.scrollTop - el.clientHeight < BOTTOM_EPSILON
      atBottomRef.current = near
      if (near) setUnread(0)
    }
    el.addEventListener("scroll", onScroll, { passive: true })
    return () => el.removeEventListener("scroll", onScroll)
  }, [])

  // 贴底跟随合帧：读 scrollHeight 会强制一次同步布局，SSE 每片都读就是每片
  // 一次回流。用 rAF 把同一帧内的多次请求并成一次读 + 一次写。
  const followRaf = useRef<number | null>(null)
  const followBottom = useCallback(() => {
    if (followRaf.current !== null) return
    followRaf.current = requestAnimationFrame(() => {
      followRaf.current = null
      const el = listRef.current
      if (el) el.scrollTop = el.scrollHeight
    })
  }, [])

  useEffect(
    () => () => {
      if (followRaf.current !== null) cancelAnimationFrame(followRaf.current)
    },
    [],
  )

  // 新消息：贴底则跟随，否则计一条未读
  useEffect(() => {
    if (messages.length === 0) return
    if (atBottomRef.current) {
      followBottom()
    } else {
      setUnread((n) => computeUnread(n, { atBottom: false, isNewMessage: true, isContentGrowth: false }))
    }
    // 只跟消息条数：内容增长在下面的 effect 里处理
  }, [messages.length, followBottom])

  // 流式内容增长：贴底时跟随滚动，但不增加未读计数
  useEffect(() => {
    if (lastContent === undefined) return
    if (atBottomRef.current) followBottom()
  }, [lastContent, lastMsgId, followBottom])

  // 收口那一刻的排版会变（分段边界被整篇渲染替换，未闭合的表格/围栏收拢），
  // 高度可能跳一次而内容字符串已经不再变化——单独跟一次，避免停在半截。
  const wasStreaming = useRef(streaming)
  useEffect(() => {
    if (wasStreaming.current && !streaming && atBottomRef.current) followBottom()
    wasStreaming.current = streaming
  }, [streaming, followBottom])

  function scrollToBottom() {
    const el = listRef.current
    if (!el) return
    atBottomRef.current = true
    setUnread(0)
    el.scrollTop = el.scrollHeight
  }

  const empty = messages.length === 0 && !loading
  // 过程块只由真实事件派生；消息对象引用在累加时保持稳定，
  // 所以历史行仍然被 memo 跳过，只有正在流式的那一行会重渲染。
  const thread = useMemo(() => buildThread(messages, streaming), [messages, streaming])

  // 引用核验表只在资源变化时重算；消息→回合是纯整数映射，可以跟着消息走，
  // 这样行组件拿到的是稳定的数组与数字，memo 仍然只放行正在流式的那一行。
  //
  // 资源数组每片 token 都会换新（deriveResources 跟着 messages 走），所以这里
  // 再按「这一回合的证据键」做一层身份缓存：键没变就复用旧数组，否则历史行
  // 的 citations prop 每片都换引用，memo 会全线失效、整篇重渲。
  // 用「证据内容签名」而不是 resources 的引用做依赖：resources 数组每片
  // token 都换新，跟引用算等于让每条历史行的 citations prop 每片换引用，
  // memo 全线失效。键与回合都不变时，直接复用上一次的结果。
  const citationSignature = (resources?.documents ?? [])
    .map((doc) => `${doc.id}#${(doc.rounds ?? (doc.round ? [doc.round] : [])).join(",")}|${doc.title}`)
    .join("|")
  const citationsByRound = useMemo(
    () => citationKeysByRound(resources ?? EMPTY_RESOURCES),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 只随证据内容变，不随数组引用变
    [citationSignature],
  )
  const roundById = useMemo(() => messageRoundById(messages), [messages])

  // 每回合的用户提问（版本切换器挂在它这一轮的最后一条之后）。
  const turnUserByRound = useMemo(() => {
    const byRound = new Map<number, StreamMessage>()
    for (const message of messages) {
      if (message.type !== "user") continue
      const round = roundById.get(message.id)
      if (round) byRound.set(round, message)
    }
    return byRound
  }, [messages, roundById])
  const lastRound = useMemo(
    () => Math.max(0, ...[...turnUserByRound.keys()]),
    [turnUserByRound],
  )
  const lastIndexByRound = useMemo(() => {
    const byRound = new Map<number, number>()
    thread.forEach((item, index) => {
      const round =
        item.type === "process" ? (item.round ?? 0) : (roundById.get(item.message.id) ?? 0)
      byRound.set(round, index)
    })
    return byRound
  }, [thread, roundById])

  return (
    <div className="agent-thread">
      <div className="agent-thread__bar">
        <div className="agent-thread__bar-side">{headLeft}</div>
        <div className="agent-thread__bar-center">
          {title ? <h1 className="agent-thread__title">{title}</h1> : null}
        </div>
        <div className="agent-thread__bar-side is-right">{headRight}</div>
      </div>

      <div className="agent-thread__scroll" ref={listRef}>
        <div className={`agent-thread__column${empty ? " is-empty" : ""}`}>
          {loading ? <div className="agent-load">读取历史会话…</div> : null}
          {empty ? <WelcomeScreen onSend={onSend} onPickImage={onPickImage} /> : null}

          {thread.map((item, index) => {
            const row =
              item.type === "process" ? (
                <ThoughtLine key={item.id} steps={item.steps} active={item.active} />
              ) : (
                <MessageRow
                  key={item.message.id}
                  msg={item.message}
                  citations={
                    citationsByRound.get(roundById.get(item.message.id) ?? 0) ?? EMPTY_CITATIONS
                  }
                  onPreviewImage={onPreviewImage}
                  onCite={onCite}
                />
              )
            const round =
              item.type === "process" ? (item.round ?? 0) : (roundById.get(item.message.id) ?? 0)
            const turnUser = turnUserByRound.get(round)
            const isLastTurn = round === lastRound
            // 版本条挂在这一轮最后一条之后；只有最后一轮能重新生成。
            // 刚发的这一轮还没有服务端 id（要等历史回读）：此时重新生成按
            // 「本会话最后一条提问」处理，由服务端解析，界面不必猜 id。
            if (!turnUser || (!turnUser.serverId && !isLastTurn) || lastIndexByRound.get(round) !== index) {
              return <Fragment key={item.type === "process" ? item.id : item.message.id}>{row}</Fragment>
            }
            const userMessageId = turnUser.serverId
            return (
              <Fragment key={item.type === "process" ? item.id : item.message.id}>
                {row}
                <TurnActions
                  variantIds={turnUser.variantIds}
                  selectedVariantId={turnUser.selectedVariantId}
                  canRegenerate={isLastTurn && Boolean(onRegenerate)}
                  busy={streaming}
                  onRegenerate={() => onRegenerate?.(userMessageId ?? "")}
                  onSelectVariant={(variantId) => {
                    // 没有服务端 id 的一轮不可能已经有多版本，这里只是防御。
                    if (userMessageId) onSelectVariant?.(userMessageId, variantId)
                  }}
                />
              </Fragment>
            )
          })}
        </div>
      </div>

      {/* 等待态独立成一条，不塞进滚动列：塞进去会被列底裁掉半截，
          而它恰恰是用户最该看见的一行。 */}
      {waiting.active ? (
        <div className="agent-thread__status">
          <LatticeLoader label={waiting.label} />
        </div>
      ) : null}

      {unread > 0 ? (
        <button type="button" className="agent-msglist__unread" onClick={scrollToBottom}>
          <span className="agent-msglist__unread-dot" aria-hidden="true" />
          {unread} 条新消息
        </button>
      ) : null}
    </div>
  )
}
