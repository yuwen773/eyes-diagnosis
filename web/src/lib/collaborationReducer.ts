import {
  CollaborationProtocolError,
  isTerminal,
  type CollaborationEvent,
  type CollaborationFrame,
  type CollaborationSnapshot,
  type ExecutionStatus,
} from "./collaborationProtocol"

export type CollaborationState = {
  snapshot: CollaborationSnapshot
  events: CollaborationEvent[]
  sequence: number
  cursor: string
}

export function fromSnapshot(
  snapshot: CollaborationSnapshot
): CollaborationState {
  return {
    snapshot,
    events: [],
    sequence: snapshot.snapshotSequence,
    cursor: snapshot.resumeCursor,
  }
}

/** Sequence gaps are authorized filtering. Only the server can interpret a cursor. */
export function collaborationReducer(
  state: CollaborationState,
  frame: CollaborationFrame
): CollaborationState {
  const e = frame.event
  if (!e) return { ...state, cursor: frame.cursor }
  if (
    e.runId !== state.snapshot.runId ||
    e.threadId !== state.snapshot.threadId
  )
    throw new CollaborationProtocolError()
  if (e.sequence <= state.sequence) return state
  const snapshot = { ...state.snapshot, roles: { ...state.snapshot.roles } }
  const current = snapshot.executionStatus
  const transition = (next: ExecutionStatus, allowed: ExecutionStatus[]) => {
    if (!allowed.includes(current)) throw new CollaborationProtocolError()
    snapshot.executionStatus = next
  }
  // A newer fact cannot reopen a terminal execution. Review decisions use a fresh snapshot.
  if (isTerminal(current)) throw new CollaborationProtocolError()
  switch (e.type) {
    case "run.accepted":
      transition("ACCEPTED", ["ACCEPTED"])
      break
    case "run.started":
      transition("RUNNING", ["ACCEPTED", "RUNNING"])
      break
    case "run.cancel_requested":
      transition("CANCEL_REQUESTED", [
        "ACCEPTED",
        "RUNNING",
        "CANCEL_REQUESTED",
      ])
      break
    case "run.cancelled":
      transition("CANCELLED", ["CANCEL_REQUESTED"])
      break
    case "run.restricted":
    case "run.failed":
      transition(e.payload.status, ["ACCEPTED", "RUNNING"])
      snapshot.reason = e.payload.reason
      break
    case "run.review_ready":
      if (current !== "RUNNING") throw new CollaborationProtocolError()
      snapshot.reviewStatus = "PENDING"
      break
    case "run.completed":
      transition("SUCCEEDED", ["RUNNING"])
      snapshot.reviewStatus = "PENDING"
      break
    case "agent.started":
    case "agent.completed":
      if (current !== "RUNNING" || e.actor === "COORDINATOR")
        throw new CollaborationProtocolError()
      snapshot.roles[e.actor] =
        e.type === "agent.started" ? "RUNNING" : "COMPLETED"
      break
    // 既有事件类型（evidence.verified / agent.revision.completed / agent.handoff /
    // agent.readable）不改角色状态——核对与交接由既有 run.completed/review_ready 事实承载。
    case "agent.summary":
    case "agent.readable":
      if (current !== "RUNNING" || e.actor === "COORDINATOR")
        throw new CollaborationProtocolError()
      break
    default:
      if (current !== "RUNNING") throw new CollaborationProtocolError()
  }
  if (
    ["RESTRICTED", "FAILED", "CANCELLED"].includes(snapshot.executionStatus)
  ) {
    for (const role of Object.keys(
      snapshot.roles
    ) as (keyof typeof snapshot.roles)[]) {
      if (snapshot.roles[role] === "RUNNING") snapshot.roles[role] = "STOPPED"
    }
  }
  // Bounded UI window; durable history remains on the server.
  return {
    snapshot,
    events: [...state.events, e].slice(-200),
    sequence: e.sequence,
    cursor: frame.cursor,
  }
}
