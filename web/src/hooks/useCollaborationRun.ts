import { createContext, useEffect, useMemo, useSyncExternalStore } from "react"
import {
  collaborationApi,
  CollaborationHttpError,
  type CollaborationApi,
} from "@/lib/collaborationApi"
import {
  CollaborationProtocolError,
  isTerminal,
  type CollaborationSnapshot,
} from "@/lib/collaborationProtocol"
import {
  collaborationReducer,
  fromSnapshot,
  type CollaborationState,
} from "@/lib/collaborationReducer"

export type CollaborationScope = {
  identityKey: string | number | null
  threadId: string
  runId: string | null
  enabled: boolean
}
type Connection =
  | "disabled"
  | "idle"
  | "loading"
  | "connecting"
  | "live"
  | "reconnecting"
  | "closed"
  | "error"
  | "forbidden"
type View = {
  run: CollaborationState | null
  connection: Connection
  cancelling: boolean
  error: string | null
}

/** An instance belongs to exactly one identity/thread/run. Nothing is stored in localStorage. */
class CollaborationSession {
  private view: View
  private listeners = new Set<() => void>()
  private controller: AbortController | null = null
  private epoch = 0
  private active = false
  private cancelPending = false
  private scope: CollaborationScope
  private api: CollaborationApi
  constructor(scope: CollaborationScope, api: CollaborationApi) {
    this.scope = scope
    this.api = api
    this.view = {
      run: null,
      connection: scope.enabled ? "idle" : "disabled",
      cancelling: false,
      error: null,
    }
  }
  getSnapshot = () => this.view
  subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }
  private update(patch: Partial<View>) {
    this.view = { ...this.view, ...patch }
    this.listeners.forEach((listener) => listener())
  }
  private authorized(snapshot: CollaborationSnapshot) {
    if (
      snapshot.runId !== this.scope.runId ||
      snapshot.threadId !== this.scope.threadId
    )
      throw new CollaborationHttpError(403, "SCOPE_MISMATCH")
    return fromSnapshot(snapshot)
  }
  connect = () => {
    this.active = true
    if (
      !this.scope.enabled ||
      this.scope.identityKey === null ||
      !this.scope.threadId ||
      !this.scope.runId
    )
      return
    this.controller?.abort()
    const epoch = ++this.epoch
    const controller = new AbortController()
    this.controller = controller
    void this.follow(epoch, controller.signal)
  }
  disconnect = () => {
    this.active = false
    ++this.epoch
    this.controller?.abort()
    // Changing a selection/unmounting never sends a cancellation request.
  }
  private current(epoch: number) {
    return this.active && this.epoch === epoch
  }
  private stopStream() {
    ++this.epoch
    this.controller?.abort()
  }
  private async follow(epoch: number, signal: AbortSignal) {
    let refresh = true
    let repairs = 0
    let attempts = 0
    while (this.current(epoch) && !signal.aborted) {
      try {
        if (refresh) {
          // Drop the old projection before waiting for replacement authorization.
          this.update({ run: null, connection: "loading", error: null })
          const snapshot = await this.api.snapshot(this.scope.runId!, signal)
          if (!this.current(epoch)) return
          this.update({ run: this.authorized(snapshot), error: null })
          refresh = false
        }
        const run = this.view.run!
        if (isTerminal(run.snapshot.executionStatus)) {
          this.update({ connection: "closed" })
          this.stopStream()
          return
        }
        this.update({ connection: "connecting", error: null })
        await this.api.stream(
          this.scope.runId!,
          run.cursor,
          signal,
          (frame) => {
            if (!this.current(epoch) || signal.aborted) return
            this.update({
              run: collaborationReducer(this.view.run!, frame),
              connection: "live",
              error: null,
            })
            attempts = 0
            repairs = 0
          },
          () => {
            if (this.current(epoch) && !signal.aborted)
              this.update({ connection: "live", error: null })
          }
        )
        if (!this.current(epoch)) return
        if (
          this.view.run &&
          isTerminal(this.view.run.snapshot.executionStatus)
        ) {
          this.update({ connection: "closed" })
          this.stopStream()
          return
        }
      } catch (error) {
        if (!this.current(epoch) || signal.aborted) return
        if (
          error instanceof CollaborationHttpError &&
          [401, 403].includes(error.status)
        ) {
          this.update({
            run: null,
            connection: "forbidden",
            error: error.message,
            cancelling: false,
          })
          this.stopStream()
          return
        }
        if (
          error instanceof CollaborationProtocolError ||
          (error instanceof CollaborationHttpError &&
            [409, 410].includes(error.status))
        ) {
          if (++repairs > 1) {
            this.update({
              run: null,
              connection: "error",
              error: "PROTOCOL_MISMATCH",
            })
            this.stopStream()
            return
          }
          refresh = true
          continue
        }
        if (
          error instanceof CollaborationHttpError &&
          error.status !== 429 &&
          error.status < 500
        ) {
          this.update({ connection: "error", error: error.message })
          this.stopStream()
          return
        }
      }
      if (!this.current(epoch)) return
      // The server reauthorizes every reconnect before opening SSE. The hook hides
      // metadata while offline; retain the last applied cursor for durable replay.
      this.update({ connection: "reconnecting", error: "STREAM_DISCONNECTED" })
      await this.delay(Math.min(1000 * 2 ** attempts++, 15_000), signal)
    }
  }
  private delay(ms: number, signal: AbortSignal) {
    return new Promise<void>((resolve) => {
      if (signal.aborted) {
        resolve()
        return
      }
      const done = () => {
        clearTimeout(timer)
        signal.removeEventListener("abort", done)
        resolve()
      }
      const timer = setTimeout(done, ms)
      signal.addEventListener("abort", done, { once: true })
    })
  }
  retry = () => {
    if (this.active) this.connect()
  }
  cancel = async () => {
    const run = this.view.run
    if (
      !this.active ||
      !this.scope.enabled ||
      !run ||
      this.controller?.signal.aborted ||
      isTerminal(run.snapshot.executionStatus) ||
      this.cancelPending
    )
      return
    const epoch = this.epoch
    const signal = this.controller!.signal
    this.cancelPending = true
    this.update({ cancelling: true, error: null })
    try {
      await this.api.cancel(run.snapshot.runId, signal)
      if (!this.current(epoch)) return
      // The response is an acknowledgement, not a replacement event/snapshot.
      // ALREADY_TERMINAL may be a success; fetch the authoritative review status.
      this.connect()
    } catch (error) {
      if (!this.current(epoch) || signal.aborted) return
      if (
        error instanceof CollaborationHttpError &&
        [401, 403].includes(error.status)
      ) {
        this.controller?.abort()
        ++this.epoch
        this.update({
          run: null,
          connection: "forbidden",
          error: error.message,
        })
      } else this.update({ error: "CANCELLATION_UNCONFIRMED" })
    } finally {
      this.cancelPending = false
      if (this.active) this.update({ cancelling: false })
    }
  }
}

export function useCollaborationRun(scope: CollaborationScope) {
  const { identityKey, threadId, runId, enabled } = scope
  const session = useMemo(
    () =>
      new CollaborationSession(
        { identityKey, threadId, runId, enabled },
        collaborationApi
      ),
    [identityKey, threadId, runId, enabled]
  )
  const view = useSyncExternalStore(
    session.subscribe,
    session.getSnapshot,
    session.getSnapshot
  )
  useEffect(() => {
    session.connect()
    return session.disconnect
  }, [session])
  return {
    ...view,
    run: ["connecting", "reconnecting"].includes(view.connection)
      ? null
      : view.run,
    cancel: session.cancel,
    retry: session.retry,
  }
}

/** Shared by the existing /agent workbench and its upcoming TASK-05 panels. */
export const CollaborationRunContext = createContext<ReturnType<
  typeof useCollaborationRun
> | null>(null)
