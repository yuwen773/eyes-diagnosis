import { useEffect, useRef, useState } from "react"
import type { CollaborationState } from "@/lib/collaborationReducer"
import { clinicianProjection, eventLabel } from "./collaborationLabels"

export function CollaborationTimeline({ run }: { run: CollaborationState }) {
  const viewport = useRef<HTMLDivElement>(null)
  const follow = useRef(true)
  const [following, setFollowing] = useState(true)
  const [expanded, setExpanded] = useState(false)
  const clinician = clinicianProjection(run.snapshot.projectionVersion)
  const events = run.events.filter(
    (event) => clinician || event.visibility === "PATIENT"
  )
  const visible = expanded ? events : events.slice(-30)
  const lastId = events.at(-1)?.eventId
  useEffect(() => {
    if (follow.current && viewport.current)
      viewport.current.scrollTop = viewport.current.scrollHeight
  }, [lastId])
  return (
    <section
      className="collab-timeline"
      aria-labelledby="collab-timeline-title"
    >
      <div className="collab-section-head">
        <h3 id="collab-timeline-title">协作记录</h3>
        <span className="num">{events.length} 条当前记录</span>
      </div>
      <p className="collab-caption">
        从本次连接后记录真实进展；刷新以当前状态恢复，不重演先前步骤。
      </p>
      {events.length > 30 && (
        <button
          className="collab-text-button"
          type="button"
          onClick={() => setExpanded(!expanded)}
          aria-expanded={expanded}
        >
          {expanded ? "收起较早记录" : "展开较早记录"}
        </button>
      )}
      <div
        className="collab-timeline__scroll"
        ref={viewport}
        tabIndex={0}
        role="region"
        aria-label="协作记录滚动区"
        onScroll={() => {
          const el = viewport.current!
          follow.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48
          setFollowing(follow.current)
        }}
      >
        {visible.length === 0 ? (
          <p className="collab-empty">
            已恢复当前状态，等待后续进展。未执行的阶段不会标记完成。
          </p>
        ) : (
          <ol>
            {visible.map((event) => (
              <li key={event.eventId}>
                <time className="num" dateTime={event.occurredAt}>
                  {new Date(event.occurredAt).toLocaleTimeString("zh-CN", {
                    hour12: false,
                  })}
                </time>
                <div>
                  <p>{eventLabel(event, clinician)}</p>
                  {clinician &&
                    (event.type === "agent.handoff" ||
                      event.type === "agent.feedback.requested") && (
                      <details>
                        <summary>查看交接元数据</summary>
                        <p>
                          角色：
                          {event.actor === "CRITIC"
                            ? "安全复核"
                            : event.actor === "VISION"
                              ? "影像解读"
                              : event.actor === "EVIDENCE"
                                ? "证据检索"
                                : "解释整理"}
                        </p>
                        <p className="num">调用轮次 {event.payload.call}</p>
                        <p>
                          {event.type === "agent.feedback.requested"
                            ? event.payload.action === "REWRITE"
                              ? "要求修订解释"
                              : "要求补充证据"
                            : "该事实已由服务端提交；当前记录不含临床正文或具体质疑条目。"}
                        </p>
                      </details>
                    )}
                </div>
              </li>
            ))}
          </ol>
        )}
      </div>
      {!following && (
        <button
          type="button"
          className="collab-text-button"
          onClick={() => {
            follow.current = true
            setFollowing(true)
            if (viewport.current)
              viewport.current.scrollTop = viewport.current.scrollHeight
          }}
        >
          回到最新进展
        </button>
      )}
    </section>
  )
}
