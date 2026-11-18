import {
  ArrowLeftRight,
  BookOpenCheck,
  CheckCircle2,
  ClipboardCheck,
  Image,
  LoaderCircle,
  ShieldCheck,
} from "lucide-react"
import type {
  CollaborationEvent,
  CollaborationSnapshot,
} from "@/lib/collaborationProtocol"
import { AgentAvatar } from "./CollaborationRoles"
import { eventLabel, reviewLabels, roleNames } from "./collaborationLabels"
import { personas } from "./collaborationPersonas"
import type { InspectorTab } from "./EvidenceInspector"

type Inspect = (tab: InspectorTab, eventId?: string) => void
const handoffPurpose = {
  VISION_READY: "提供影像质量与适用限制",
  EVIDENCE_READY: "提供已冻结的受控证据",
  DRAFT_READY: "提交辅助草稿供安全复核",
  SUPPLEMENT_REQUESTED: "请求补充证据",
  REWRITE_REQUESTED: "请求修订说明",
} as const

export function AgentMessageCard({
  event,
  canInspectImage,
  onInspect,
}: {
  event: CollaborationEvent
  canInspectImage: boolean
  onInspect: Inspect
}) {
  const imageSummary =
    event.type === "agent.summary" &&
    event.actor === "VISION" &&
    event.payload.summary.startsWith("VISION_REVIEW_QUALITY:")
  return (
    <div className="roundtable-event__card roundtable-event__card--message">
      <p>{eventLabel(event, true)}</p>
      {imageSummary && canInspectImage && (
        <button
          type="button"
          className="roundtable-event__action"
          onClick={() => onInspect("image")}
        >
          <Image size={15} aria-hidden="true" />
          查看本次影像
        </button>
      )}
    </div>
  )
}

export function AgentHandoffCard({
  event,
}: {
  event: Extract<CollaborationEvent, { type: "agent.handoff" }>
}) {
  const purpose = Object.entries(handoffPurpose).find(
    ([kind]) => kind === event.payload.kind
  )?.[1]
  return (
    <div className="roundtable-event__card roundtable-event__card--handoff">
      <p>
        <ArrowLeftRight size={16} aria-hidden="true" />
        {eventLabel(event, true)}
      </p>
      <details>
        <summary>查看交接元数据</summary>
        {purpose && <p>{purpose}</p>}
        <p className="num">调用轮次 {event.payload.call}</p>
        <p>当前记录不含临床正文或具体质疑条目。</p>
      </details>
    </div>
  )
}

export function EvidenceReferenceCard({
  event,
  onInspect,
}: {
  event: Extract<CollaborationEvent, { type: "evidence.verified" }>
  onInspect: Inspect
}) {
  return (
    <div className="roundtable-event__card roundtable-event__card--evidence">
      <p>
        <BookOpenCheck size={16} aria-hidden="true" />
        受控证据已核验
      </p>
      <button
        type="button"
        className="roundtable-event__action"
        onClick={() => onInspect("evidence", event.eventId)}
      >
        查看核验记录{" "}
        <span className="num">v{event.payload.evidenceVersion}</span>
      </button>
    </div>
  )
}

export function ReviewFeedbackCard({
  event,
  onInspect,
}: {
  event: Extract<CollaborationEvent, { type: "agent.feedback.requested" }>
  onInspect: Inspect
}) {
  return (
    <div className="roundtable-event__card roundtable-event__card--feedback">
      <p>
        <ShieldCheck size={16} aria-hidden="true" />
        {event.payload.action === "SUPPLEMENT"
          ? "已请求补充证据"
          : "已请求修订说明"}
      </p>
      <button
        type="button"
        className="roundtable-event__action"
        onClick={() => onInspect("review", event.eventId)}
      >
        查看复核反馈
      </button>
    </div>
  )
}

export function AgentActivityCard({
  event,
  active,
}: {
  event: CollaborationEvent
  active: boolean
}) {
  const Icon =
    event.type === "agent.started"
      ? LoaderCircle
      : event.type === "agent.completed"
        ? CheckCircle2
        : ClipboardCheck
  return (
    <div
      className="roundtable-event__card roundtable-event__card--activity"
      data-active={active}
    >
      <p>
        <Icon size={15} aria-hidden="true" />
        {eventLabel(event, false)}
      </p>
    </div>
  )
}

export function CollaborationCompletionCard({
  reviewStatus,
  canViewResult,
  onInspect,
}: {
  reviewStatus: CollaborationSnapshot["reviewStatus"]
  canViewResult: boolean
  onInspect: Inspect
}) {
  return (
    <div className="roundtable-event__card roundtable-event__card--complete">
      <p>
        <CheckCircle2 size={16} aria-hidden="true" />
        AI 协作已完成
      </p>
      <p className="roundtable-event__detail">
        {reviewLabels[reviewStatus]}。医生复核状态单独记录。
      </p>
      {canViewResult && (
        <button
          type="button"
          className="roundtable-event__action"
          onClick={() => onInspect("evidence")}
        >
          查看获准的辅助说明
        </button>
      )}
    </div>
  )
}

export function CollaborationEventHeader({
  event,
}: {
  event: CollaborationEvent
}) {
  const role = event.actor
  return (
    <div className="roundtable-event__head">
      {role === "COORDINATOR" ? (
        <span>协作调度</span>
      ) : (
        <>
          <AgentAvatar role={role} size={32} />
          <strong>{personas[role].name}</strong>
          <span className="roundtable-event__role">{roleNames[role]}</span>
        </>
      )}
      <time className="num" dateTime={event.occurredAt}>
        {new Date(event.occurredAt).toLocaleTimeString("zh-CN", {
          hour12: false,
        })}
      </time>
    </div>
  )
}
