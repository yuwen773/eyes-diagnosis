import type { StreamMessage } from "@/lib/agentStream"

/**
 * 工具确认——信息性终点卡，无确认按钮。
 *
 * 后端 TOOL_CONFIRM 来自图中断（InterruptionMetadata），中断即流结束、
 * 状态无持久化、没有确认回传端点。Vue 版的「确认」按钮只弹 toast、
 * 不发请求，是假交互；这里如实呈现为「已暂停」的通知卡。
 */
export function ConfirmMessage({ msg }: { msg: StreamMessage }) {
  return (
    <div className="trace agent-msg agent-msg--confirm">
      <div className="trace__role">HOLD</div>
      <div className="trace__content">
        <div className="agent-msg__confirm-head">工具执行已暂停</div>
        <div className="trace__text agent-msg__confirm-detail">{msg.content}</div>
        <div className="trace__note">如需继续，请直接发送下一条消息。</div>
      </div>
    </div>
  )
}
