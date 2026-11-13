import type {
  CollaborationEvent,
  CollaborationSnapshot,
  Role,
} from "@/lib/collaborationProtocol"

export const roleNames: Record<Role | "COORDINATOR", string> = {
  VISION: "影像解读",
  EVIDENCE: "证据检索",
  EXPLANATION: "解释整理",
  CRITIC: "安全复核",
  COORDINATOR: "协作调度",
}
export const roleDescriptions: Record<Role, string> = {
  VISION: "解读已有推理快照及质量限制",
  EVIDENCE: "检索与核验受控资料",
  EXPLANATION: "整理辅助解释草稿",
  CRITIC: "检查依据与安全边界",
}
export function clinicianProjection(projection: string) {
  return (
    projection === "v1:admin" || /^v1:doctor:[A-Za-z0-9_-]+$/.test(projection)
  )
}
export const reasons: Record<string, string> = {
  INPUT_RESTRICTED: "影像或推理未满足安全条件，本次不形成判读结论。",
  INFERENCE_NOT_READY: "影像推理仍在处理中。",
  INVALID_CITATION: "引用未通过核验，本次未提交医生复核。",
  SOURCE_INVALIDATED: "资料来源已失效，本次未提交医生复核。",
  INVALID_OUTPUT: "输出未通过安全检查，本次未提交医生复核。",
  PROVIDER_AUTH: "模型服务暂不可用，请联系管理员。",
  PROVIDER_RATE_LIMIT: "模型服务繁忙，请稍后再试。",
  PROVIDER_UNAVAILABLE: "模型服务暂时无法响应，请稍后再试。",
  MODEL_BUSY: "模型服务繁忙，请稍后再试。",
  INTERRUPTED_OR_TIMEOUT: "本次协作已超时，未形成可发布结果。",
  INTERRUPTED: "本次协作已中断，未形成可发布结果。",
}
export function executionLabel(snapshot: CollaborationSnapshot) {
  return {
    ACCEPTED: "任务已受理",
    RUNNING: "正在协作",
    CANCEL_REQUESTED: "正在取消",
    SUCCEEDED: "协作完成",
    RESTRICTED: "安全条件未满足",
    FAILED: "协作未完成",
    CANCELLED: "任务已取消",
  }[snapshot.executionStatus]
}
export const reviewLabels = {
  NOT_SUBMITTED: "尚未提交医生复核",
  PENDING: "待医生复核",
  APPROVED: "该版本已获医生批准",
  REJECTED: "医生复核未通过",
  INVALIDATED: "复核来源已失效",
}
/** agent.summary 是服务端受控枚举；未知标记降级为中性阶段语义，不渲染原文。 */
export function summaryLabel(summary: string, limitationCount: number) {
  if (summary === "EVIDENCE_FROZEN")
    return `受控证据已冻结 · 引用 ${limitationCount} 条`
  if (summary === "DRAFT_PENDING_REVIEW")
    return `辅助草稿待复核 · 说明条目 ${limitationCount} 条`
  if (summary.startsWith("VISION_REVIEW_QUALITY:"))
    return `影像质量已复核 · 限制 ${limitationCount} 条`
  if (summary.startsWith("CRITIC_")) {
    const action = summary.slice("CRITIC_".length)
    return action === "SUPPLEMENT"
      ? `安全复核要求补充证据 · 质疑 ${limitationCount} 条`
      : `安全复核要求修订 · 质疑 ${limitationCount} 条`
  }
  return `角色阶段事实已记录`
}

/** Only render known metadata. Unknown free text never becomes patient-facing content. */
export function eventLabel(event: CollaborationEvent, clinician: boolean) {
  switch (event.type) {
    case "run.accepted":
      return "任务已受理"
    case "run.started":
      return "协作已开始"
    case "agent.started":
      return `${roleNames[event.actor]}开始处理`
    case "agent.completed":
      return `${roleNames[event.actor]}本轮处理完成`
    // patient 投影的阶段事实标记：只展示结构化语义，不展示任何模型文本。
    case "agent.summary":
      return summaryLabel(event.payload.summary, event.payload.limitationCount)
    // clinician 投影：已校验结构化输出记录的到达提示；正文在既有医生复核路径查看。
    case "agent.readable":
      return clinician
        ? `${roleNames[event.actor]}已提交校验记录 · 轮次 ${event.payload.call}`
        : ""
    case "agent.feedback.requested":
      return event.payload.action === "SUPPLEMENT"
        ? "正在补充证据"
        : "正在复核与修订"
    case "agent.handoff":
      return clinician
        ? `${roleNames[event.actor]} → ${roleNames[event.payload.to as Role] ?? "协作调度"}：已交接`
        : ""
    case "evidence.verified":
      return clinician
        ? `受控证据核验完成 · 版本 ${event.payload.evidenceVersion}`
        : ""
    case "agent.revision.completed":
      return clinician
        ? `草稿修订完成 · 版本 ${event.payload.draftVersion}`
        : ""
    case "run.review_ready":
      return "辅助草稿已提交医生复核"
    case "run.completed":
      return "协作完成，待医生复核"
    case "run.restricted":
      return "安全条件未满足，已停止"
    case "run.failed":
      return "协作未完成"
    case "run.cancel_requested":
      return "取消请求已受理"
    case "run.cancelled":
      return "任务已取消"
  }
}
