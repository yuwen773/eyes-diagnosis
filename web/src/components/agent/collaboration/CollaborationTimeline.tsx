import { useEffect, useRef, type Dispatch, type SetStateAction } from "react"
import { MessagesSquare } from "lucide-react"
import {
  roles,
  type CollaborationEvent,
  type CollaborationSnapshot,
} from "@/lib/collaborationProtocol"
import {
  AgentActivityCard,
  AgentHandoffCard,
  AgentMessageCard,
  CollaborationCompletionCard,
  CollaborationEventHeader,
  EvidenceReferenceCard,
  ReviewFeedbackCard,
} from "./CollaborationEventCards"
import type { InspectorTab } from "./EvidenceInspector"

export type TimelinePosition = {
  following: boolean
  top: number
  oldest?: string
  expanded: boolean
  pausedAt?: string
}

export function CollaborationTimeline({
  events,
  snapshot,
  target,
  onTargetApplied,
  position,
  setPosition,
  onInspect,
  currentFeedback,
}: {
  events: CollaborationEvent[]
  snapshot: CollaborationSnapshot
  target: { eventId: string } | null
  onTargetApplied: () => void
  position: TimelinePosition
  setPosition: Dispatch<SetStateAction<TimelinePosition>>
  onInspect: (tab: InspectorTab, eventId?: string) => void
  currentFeedback?: string
}) {
  const viewport = useRef<HTMLDivElement>(null)
  const initialTop = useRef(position.top)
  const { following, expanded, pausedAt } = position
  const lastId = events.at(-1)?.eventId
  const first = following
    ? Math.max(0, events.length - 30)
    : Math.max(
        0,
        events.findIndex((event) => event.eventId === position.oldest)
      )
  const visible = expanded ? events : events.slice(first)
  const canInspectImage =
    snapshot.projectionVersion === "v1:patient" ||
    snapshot.projectionVersion.startsWith("v1:doctor:")
  const canViewResult =
    snapshot.projectionVersion === "v1:patient" &&
    snapshot.reviewStatus === "APPROVED"
  const succeeded = snapshot.executionStatus === "SUCCEEDED"
  const activeEvents = new Set(
    roles.flatMap((role) => {
      if (snapshot.roles[role] !== "RUNNING") return []
      const event = events.findLast(
        (item) =>
          item.actor === role &&
          (item.type === "agent.started" || item.type === "agent.completed")
      )
      return event?.type === "agent.started" ? [event.eventId] : []
    })
  )

  function renderEvent(event: CollaborationEvent) {
    switch (event.type) {
      case "agent.handoff":
        return <AgentHandoffCard event={event} />
      case "evidence.verified":
        return <EvidenceReferenceCard event={event} onInspect={onInspect} />
      case "agent.feedback.requested":
        return <ReviewFeedbackCard event={event} onInspect={onInspect} />
      case "run.completed":
        return (
          <CollaborationCompletionCard
            reviewStatus={snapshot.reviewStatus}
            canViewResult={canViewResult}
            onInspect={onInspect}
          />
        )
      case "agent.summary":
      case "agent.readable":
      case "agent.revision.completed":
        return (
          <AgentMessageCard
            event={event}
            canInspectImage={canInspectImage}
            onInspect={onInspect}
          />
        )
      default:
        return (
          <AgentActivityCard
            event={event}
            active={activeEvents.has(event.eventId)}
          />
        )
    }
  }

  useEffect(() => {
    if (viewport.current) viewport.current.scrollTop = initialTop.current
  }, [])
  useEffect(() => {
    if (following && viewport.current)
      viewport.current.scrollTop = viewport.current.scrollHeight
  }, [lastId, following, expanded])
  useEffect(() => {
    if (!target) return
    const node = Array.from(
      viewport.current?.querySelectorAll<HTMLElement>("[data-event-id]") ?? []
    ).find((element) => element.dataset.eventId === target.eventId)
    if (!node) return
    node.scrollIntoView({ block: "nearest" })
    node.focus({ preventScroll: true })
    onTargetApplied()
  }, [target, onTargetApplied])

  return (
    <section
      className="collab-timeline roundtable-panel"
      aria-labelledby="collab-timeline-title"
    >
      <div className="roundtable-panel__head">
        <h2 id="collab-timeline-title">
          <MessagesSquare size={18} aria-hidden="true" />
          团队协作会话
        </h2>
        {currentFeedback && (
          <span className="roundtable-stage">{currentFeedback}</span>
        )}
      </div>
      {(events.length > 30 || !following) && (
        <div className="roundtable-timeline-actions">
          {events.length > 30 && (
            <button
              className="collab-text-button"
              type="button"
              onClick={() => {
                setPosition((current) => ({
                  ...current,
                  expanded: !expanded,
                  oldest: expanded ? events.at(-30)?.eventId : current.oldest,
                }))
              }}
              aria-expanded={expanded}
            >
              {expanded ? "收起较早记录" : "展开较早记录"}
            </button>
          )}
          {!following && (
            <button
              type="button"
              className="collab-text-button"
              onClick={() => {
                setPosition((current) => ({ ...current, following: true }))
                if (viewport.current)
                  viewport.current.scrollTop = viewport.current.scrollHeight
              }}
            >
              {lastId !== pausedAt && (
                <span className="roundtable-new-dot" aria-label="有新进展" />
              )}
              回到最新进展
            </button>
          )}
        </div>
      )}
      <div
        className="collab-timeline__scroll"
        ref={viewport}
        tabIndex={0}
        role="region"
        aria-label="协作记录滚动区"
        onScroll={(event) => {
          const el = event.currentTarget
          const nearEnd = el.scrollHeight - el.scrollTop - el.clientHeight < 48
          const top = el.scrollTop
          setPosition((previous) => {
            if (previous.top === top && previous.following === nearEnd)
              return previous
            return {
              ...previous,
              top,
              following: nearEnd,
              oldest:
                !nearEnd && previous.following
                  ? visible[0]?.eventId
                  : previous.oldest,
              pausedAt:
                !nearEnd && previous.following ? lastId : previous.pausedAt,
            }
          })
        }}
      >
        {visible.length === 0 && !succeeded && (
          <p className="collab-empty">已核对当前状态，等待接收后续协作记录。</p>
        )}
        {visible.length > 0 && (
          <ol>
            {visible.map((event) => (
              <li
                className="roundtable-event"
                data-role={event.actor}
                data-event-id={event.eventId}
                key={event.eventId}
                tabIndex={-1}
              >
                <CollaborationEventHeader event={event} />
                {renderEvent(event)}
              </li>
            ))}
          </ol>
        )}
        {succeeded &&
          !events.some((event) => event.type === "run.completed") && (
            <CollaborationCompletionCard
              reviewStatus={snapshot.reviewStatus}
              canViewResult={canViewResult}
              onInspect={onInspect}
            />
          )}
      </div>
      <p className="roundtable-timeline__note" role="status">
        {lastId && following
          ? "已同步最新协作记录"
          : lastId !== pausedAt
            ? "有新进展"
            : "记录从本次连接可见的事件开始。"}
      </p>
    </section>
  )
}
