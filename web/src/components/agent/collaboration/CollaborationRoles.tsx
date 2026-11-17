import { useState } from "react"
import {
  CircleCheck,
  LoaderCircle,
  ShieldCheck,
  UsersRound,
  X,
} from "lucide-react"
import { Dialog } from "@/components/ui/dialog"
import {
  isTerminal,
  roles,
  type CollaborationEvent,
  type CollaborationSnapshot,
  type Role,
} from "@/lib/collaborationProtocol"
import { eventLabel, roleDescriptions, roleNames } from "./collaborationLabels"
import { personas } from "./collaborationPersonas"

export function AgentAvatar({
  role,
  size = 40,
}: {
  role: Role
  size?: 24 | 32 | 40 | 48 | 64
}) {
  return (
    <img
      className="roundtable-avatar"
      data-role={role}
      src={personas[role].image}
      alt=""
      width={size}
      height={size}
    />
  )
}

function roleStatus(
  role: Role,
  snapshot?: CollaborationSnapshot,
  feedback?: CollaborationEvent
) {
  const state = snapshot?.roles[role] ?? "WAITING"
  if (!snapshot) return "尚未启动"
  if (state === "RUNNING") return "处理中"
  if (state === "STOPPED")
    return snapshot.executionStatus === "FAILED" ? "处理已中断" : "已停止"
  if (
    role === "CRITIC" &&
    snapshot.executionStatus === "RUNNING" &&
    feedback?.type === "agent.feedback.requested"
  )
    return feedback.payload.action === "SUPPLEMENT"
      ? "已请求补证"
      : "已请求修订"
  if (state === "COMPLETED") return "本轮已完成"
  return isTerminal(snapshot.executionStatus) ? "未执行" : "等待执行"
}

export function CollaborationRoles({
  snapshot,
  events = [],
  onHistory,
}: {
  snapshot?: CollaborationSnapshot
  events?: CollaborationEvent[]
  onHistory?: (eventId: string) => void
}) {
  const [selected, setSelected] = useState<Role | null>(null)
  const criticAction = events.findLast(
    (event) =>
      event.actor === "CRITIC" &&
      (event.type === "agent.feedback.requested" ||
        event.type === "agent.started")
  )
  const history = selected
    ? events.filter((event) => event.actor === selected)
    : []
  const summaries = history.filter((event) => event.type === "agent.summary")
  const latest = history.at(-1)

  return (
    <section
      className="roundtable-panel roundtable-team"
      aria-label={snapshot ? "协作角色状态" : "协作角色职责"}
    >
      <div className="roundtable-panel__head">
        <h2>
          <UsersRound size={18} aria-hidden="true" />
          团队成员
        </h2>
      </div>
      <ul className="roundtable-team__list">
        {roles.map((role) => {
          const state = snapshot?.roles[role] ?? "WAITING"
          const status = roleStatus(role, snapshot, criticAction)
          return (
            <li key={role}>
              <button
                type="button"
                className="collab-role roundtable-member"
                data-role={role}
                data-state={state}
                aria-label={`${personas[role].name} · ${roleNames[role]} · ${status}`}
                aria-haspopup="dialog"
                onClick={() => setSelected(role)}
              >
                <AgentAvatar role={role} size={48} />
                <span className="roundtable-member__copy">
                  <strong>
                    {personas[role].name} <small>{personas[role].alias}</small>
                  </strong>
                  <span className="roundtable-member__duty">
                    {roleNames[role]}
                  </span>
                  <span className="collab-role__status">
                    {state === "RUNNING" ? (
                      <LoaderCircle size={13} aria-hidden="true" />
                    ) : role === "CRITIC" && status.startsWith("已请求") ? (
                      <ShieldCheck size={13} aria-hidden="true" />
                    ) : (
                      state === "COMPLETED" && (
                        <CircleCheck size={13} aria-hidden="true" />
                      )
                    )}
                    {status}
                  </span>
                </span>
              </button>
            </li>
          )
        })}
      </ul>
      {selected && (
        <Dialog
          open
          title={`${personas[selected].name} 成员详情`}
          onClose={() => setSelected(null)}
          className="roundtable-dialog"
          backdropClassName="roundtable-backdrop"
        >
          <header className="roundtable-dialog__head" data-role={selected}>
            <AgentAvatar role={selected} size={64} />
            <div>
              <h2>
                {personas[selected].name}{" "}
                <small>{personas[selected].alias}</small>
              </h2>
              <p>
                {roleNames[selected]} ·{" "}
                {roleStatus(selected, snapshot, criticAction)}
              </p>
            </div>
            <button
              className="collab-button roundtable-icon-button"
              type="button"
              aria-label="关闭成员详情"
              onClick={() => setSelected(null)}
            >
              <X size={18} aria-hidden="true" />
            </button>
          </header>
          <p>{personas[selected].profile}</p>
          <p>{roleDescriptions[selected]}。</p>
          {snapshot && (
            <dl>
              <dt>当前任务</dt>
              <dd className="num">{snapshot.taskId}</dd>
            </dl>
          )}
          <h3>可查看的阶段成果</h3>
          {summaries.length ? (
            <ul>
              {summaries.map((event) => (
                <li key={event.eventId}>{eventLabel(event, false)}</li>
              ))}
            </ul>
          ) : (
            <p>当前会话没有该成员可查看的阶段摘要。</p>
          )}
          {latest && onHistory && (
            <button
              className="collab-button"
              type="button"
              onClick={() => {
                setSelected(null)
                onHistory(latest.eventId)
              }}
            >
              定位参与记录
            </button>
          )}
        </Dialog>
      )}
    </section>
  )
}
