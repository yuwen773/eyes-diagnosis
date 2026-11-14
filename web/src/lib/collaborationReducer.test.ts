import { describe, expect, it } from "vitest"
import fixture from "./__fixtures__/collaboration.v1.json"
import wire from "./__fixtures__/collaboration.wire.v1.json"
import {
  CollaborationProtocolError,
  parseFrame,
  parseSnapshot,
  type CollaborationEvent,
} from "./collaborationProtocol"
import { collaborationReducer, fromSnapshot } from "./collaborationReducer"
import { frame, rawEvent, snapshot } from "./collaborationTestFixtures"

describe("collaboration v1 contract", () => {
  it("normalizes the snapshot watermark serialized by the actual application JsonConfig", () => {
    expect(wire.snapshot.snapshotSequence).toBe("1")
    expect(parseSnapshot(wire.snapshot).snapshotSequence).toBe(1)
  })
  it.each(wire.events)(
    "consumes actual Jackson wire DTO $type with string long sequence",
    (event) => {
      const frame = parseFrame(event.type, "opaque", JSON.stringify(event))
      expect(frame.event?.sequence).toBe(Number(event.sequence))
    }
  )
  it.each(["9007199254740992", "-1", "1e2", "1.5", "", " 2", "02"])(
    "rejects unsafe or ambiguous string sequence %j",
    (value) => {
      expect(() => frame("run.started", 2, { sequence: value })).toThrow()
    }
  )
  it.each(fixture.events.map((e) => e.type))(
    "validates the complete %s payload",
    (type) => {
      expect(frame(type as CollaborationEvent["type"], 2).event?.type).toBe(
        type
      )
    }
  )
  it.each([
    { schemaVersion: 2 },
    { sequence: -1 },
    { sequence: Number.MAX_SAFE_INTEGER + 1 },
    { eventId: "fact-id-instead-of-run-sequence" },
    { actor: "VISION" },
    { visibility: "CLINICIAN" },
    { payload: { status: "RUNNING", reasoning: "private" } },
    { payload: { status: "SUCCEEDED" } },
    { hiddenDraft: "private" },
    { occurredAt: "yesterday" },
  ])("rejects incompatible or sensitive fields %j", (patch) => {
    expect(() => frame("run.started", 2, patch)).toThrow(
      CollaborationProtocolError
    )
  })
  it("rejects unknown type, mismatched SSE name, empty cursor, malformed JSON and oversized data", () => {
    for (const [name, cursor, data] of [
      [
        "run.future",
        "cursor",
        JSON.stringify(rawEvent("run.started", 2, { type: "run.future" })),
      ],
      ["run.failed", "cursor", JSON.stringify(rawEvent("run.started", 2))],
      ["run.started", "", JSON.stringify(rawEvent("run.started", 2))],
      ["run.started", "cursor", "{"],
      ["run.started", "cursor", "x".repeat(32_769)],
    ])
      expect(() => parseFrame(name, cursor, data)).toThrow(
        CollaborationProtocolError
      )
  })
  it("accepts only versioned metadata heartbeat", () => {
    expect(
      parseFrame("run.heartbeat", "opaque-heartbeat", '{"schemaVersion":1}')
    ).toEqual({ cursor: "opaque-heartbeat", event: null })
    expect(() =>
      parseFrame(
        "run.heartbeat",
        "cursor",
        '{"schemaVersion":1,"draft":"private"}'
      )
    ).toThrow()
  })
  // 2026-11-13 后端 P0-03/R2 首片新增的两类可读投影事件：summary 只携带受控
  // 结构化事实标记；readable 只出现在 CLINICIAN 投影，患者面 fail-closed。
  it("accepts server-controlled agent.summary fact markers with counts", () => {
    for (const summary of [
      "VISION_REVIEW_QUALITY:REVIEW_QUALITY",
      "VISION_REVIEW_QUALITY:NONE",
      "EVIDENCE_FROZEN",
      "DRAFT_PENDING_REVIEW",
      "CRITIC_REWRITE",
      "CRITIC_SUPPLEMENT",
    ]) {
      const parsed = frame("agent.summary", 2, {
        payload: { call: 1, summary, limitationCount: 0 },
      })
      expect(parsed.event?.type).toBe("agent.summary")
    }
  })
  it("rejects agent.summary carrying free text or negative counts", () => {
    for (const payload of [
      { call: 1, summary: "根据图像可能存在青光眼", limitationCount: 0 },
      { call: 1, summary: "VISION ok", limitationCount: 0 },
      { call: 1, summary: "EVIDENCE_FROZEN", limitationCount: -1 },
      { call: 1, summary: "EVIDENCE_FROZEN" },
    ]) {
      expect(() => frame("agent.summary", 2, { payload })).toThrow(
        CollaborationProtocolError
      )
    }
  })
  it("accepts clinician agent.readable only in CLINICIAN projection", () => {
    const payload = {
      call: 1,
      messageId: "msg-1",
      to: "EVIDENCE",
      kind: "HANDOFF",
      content: '{"claims":[]}',
    }
    expect(frame("agent.readable", 2, { payload }).event?.type).toBe(
      "agent.readable"
    )
    expect(() =>
      frame("agent.readable", 2, {
        payload,
        visibility: "PATIENT",
      })
    ).toThrow(CollaborationProtocolError)
    expect(() =>
      frame("agent.readable", 2, {
        payload: { ...payload, content: "" },
      })
    ).toThrow()
  })
  it("validates snapshot enums, required fields and absence of draft content", () => {
    for (const patch of [
      { executionStatus: "REVIEW_READY" },
      { reviewStatus: "PUBLISHED" },
      { roles: { VISION: "APPROVED" } },
      { snapshotSequence: -1 },
      { resumeCursor: "" },
      { draft: "private" },
    ]) {
      expect(() => parseSnapshot({ ...fixture.snapshot, ...patch })).toThrow()
    }
  })
})

describe("collaborationReducer", () => {
  const running = () =>
    fromSnapshot(snapshot({ executionStatus: "RUNNING", snapshotSequence: 2 }))
  it("replays patient-filtered sequence gaps without creating a missing-event failure", () => {
    let state = fromSnapshot(snapshot())
    state = collaborationReducer(state, frame("run.started", 2))
    state = collaborationReducer(state, frame("agent.started", 5))
    state = collaborationReducer(state, frame("agent.completed", 9))
    expect(state.snapshot.roles.VISION).toBe("COMPLETED")
    expect(state.sequence).toBe(9)
    expect(state.cursor).toBe("opaque-9")
  })
  it("ignores duplicates, out-of-order facts and pre-snapshot events without rolling back the cursor", () => {
    const state = collaborationReducer(running(), frame("agent.completed", 9))
    for (const e of [
      frame("agent.completed", 9),
      frame("agent.started", 5),
      frame("run.accepted", 1),
    ]) {
      expect(collaborationReducer(state, e)).toBe(state)
    }
  })
  it("replaces state at the snapshot watermark and advances heartbeats after applied facts", () => {
    const state = fromSnapshot(
      snapshot({
        executionStatus: "RUNNING",
        snapshotSequence: 12,
        roles: { EVIDENCE: "COMPLETED" },
      })
    )
    const replay = collaborationReducer(state, frame("agent.started", 5))
    expect(replay).toBe(state)
    expect(
      collaborationReducer(replay, { event: null, cursor: "opaque-scanned-15" })
        .cursor
    ).toBe("opaque-scanned-15")
    expect(replay.events).toEqual([])
  })
  it("completes execution with a separately pending doctor review", () => {
    const ready = collaborationReducer(running(), frame("run.review_ready", 20))
    expect(ready.snapshot.executionStatus).toBe("RUNNING")
    const completed = collaborationReducer(ready, frame("run.completed", 21))
    expect(completed.snapshot.executionStatus).toBe("SUCCEEDED")
    expect(completed.snapshot.reviewStatus).toBe("PENDING")
  })
  it.each(["SUCCEEDED", "FAILED", "RESTRICTED", "CANCELLED"] as const)(
    "never reopens terminal %s",
    (status) => {
      const state = fromSnapshot(
        snapshot({ executionStatus: status, snapshotSequence: 20 })
      )
      expect(() =>
        collaborationReducer(state, frame("run.started", 21))
      ).toThrow()
      expect(collaborationReducer(state, frame("run.started", 2))).toBe(state)
    }
  )
  it.each(["run.failed", "run.restricted"] as const)(
    "stops in-flight roles on %s without submitting review",
    (type) => {
      const state = fromSnapshot(
        snapshot({
          executionStatus: "RUNNING",
          roles: { VISION: "RUNNING", EVIDENCE: "COMPLETED" },
        })
      )
      const ended = collaborationReducer(state, frame(type, 10))
      expect(ended.snapshot.roles).toEqual({
        VISION: "STOPPED",
        EVIDENCE: "COMPLETED",
      })
      expect(ended.snapshot.reviewStatus).toBe("NOT_SUBMITTED")
    }
  )
  it("holds cancellation pending until the durable cancellation event arrives", () => {
    const pending = collaborationReducer(
      running(),
      frame("run.cancel_requested", 20)
    )
    expect(pending.snapshot.executionStatus).toBe("CANCEL_REQUESTED")
    expect(() =>
      collaborationReducer(pending, frame("agent.completed", 21))
    ).toThrow()
    expect(
      collaborationReducer(pending, frame("run.cancelled", 22)).snapshot
        .executionStatus
    ).toBe("CANCELLED")
  })
  it("refuses a different run or thread before checking sequence", () => {
    for (const patch of [
      { runId: "run-b", eventId: "run-b:1" },
      { threadId: "thread-b" },
    ]) {
      expect(() =>
        collaborationReducer(running(), frame("run.started", 1, patch))
      ).toThrow()
    }
  })
  it("requests snapshot on unexplained state transitions", () => {
    expect(() =>
      collaborationReducer(fromSnapshot(snapshot()), frame("run.completed", 2))
    ).toThrow()
    expect(() =>
      collaborationReducer(running(), frame("run.cancelled", 3))
    ).toThrow()
  })
  it("keeps a bounded timeline while retaining the latest cursor", () => {
    let state = running()
    for (let i = 3; i < 210; i++)
      state = collaborationReducer(state, frame("agent.completed", i))
    expect(state.events).toHaveLength(200)
    expect(state.sequence).toBe(209)
  })
})
