import fixture from "./__fixtures__/collaboration.v1.json"
import {
  parseFrame,
  parseSnapshot,
  type CollaborationSnapshot,
  type CollaborationEvent,
} from "./collaborationProtocol"

export function snapshot(patch: Partial<CollaborationSnapshot> = {}) {
  return parseSnapshot({ ...fixture.snapshot, ...patch })
}
export function rawEvent(
  type: CollaborationEvent["type"],
  sequence: number,
  patch: Record<string, unknown> = {}
) {
  const sample = fixture.events.find((e) => e.type === type)!
  return {
    ...sample,
    schemaVersion: 1,
    runId: "run-a",
    threadId: "thread-a",
    sequence,
    eventId: `run-a:${sequence}`,
    occurredAt: "2026-11-11T12:00:00Z",
    ...patch,
  }
}
export function frame(
  type: CollaborationEvent["type"],
  sequence: number,
  patch: Record<string, unknown> = {}
) {
  return parseFrame(
    type,
    `opaque-${sequence}`,
    JSON.stringify(rawEvent(type, sequence, patch))
  )
}
