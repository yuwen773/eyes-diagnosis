import { useEffect, useMemo, useState } from "react"
import { Check, ChevronDown, CircleDashed, CircleHelp, CircleSlash, Pause, Sparkles, XCircle } from "lucide-react"

import type { AgentStep } from "@/lib/agentSteps"
import { stepStateLabel } from "@/lib/agentSteps"
import { renderMarkdown } from "@/lib/markdown"

/** 折叠时输出预览的最大长度——原始内容默认不抢正文的阅读空间。 */
const PREVIEW_LIMIT = 180

/** 单步的状态图标：完成 / 执行中 / 未确认 / 已暂停 / 失败 / 已取消。 */
function StateIcon({ state }: { state: AgentStep["state"] }) {
  if (state === "done") {
    return <Check size={13} strokeWidth={2.6} aria-hidden="true" />
  }
  if (state === "running") {
    return <CircleDashed size={13} strokeWidth={2.2} aria-hidden="true" />
  }
  if (state === "paused") {
    return <Pause size={13} strokeWidth={2.4} aria-hidden="true" />
  }
  if (state === "failed") {
    return <XCircle size={13} strokeWidth={2.4} aria-hidden="true" />
  }
  if (state === "cancelled") {
    return <CircleSlash size={13} strokeWidth={2.2} aria-hidden="true" />
  }
  // 未确认：不是「还在转」，是一个问号——结果不知道。
  return <CircleHelp size={13} strokeWidth={2} aria-hidden="true" />
}

function StepDetail({ step }: { step: AgentStep }) {
  if (step.kind === "reasoning") {
    if (!step.text) return null
    return (
      <div
        className="thought__reasoning markdown-body"
        dangerouslySetInnerHTML={{ __html: renderMarkdown(step.text) }}
      />
    )
  }

  if (step.kind === "confirm") {
    return (
      <p className="thought__note">
        {step.note || "工具执行已中断，本次回合结束。"}
        <span className="thought__note-tail">如需继续，请直接发送下一条消息。</span>
      </p>
    )
  }

  // 工具步：参数与返回各自成段，原始内容默认折叠在展开区里。
  const unresolved = step.state === "pending"
  return (
    <div className="thought__detail">
      {unresolved ? (
        <p className="thought__empty">
          本次回合已结束，没有收到这个工具的返回，无法确认它是否执行完成。
        </p>
      ) : null}
      {step.args && step.args.length > 0 ? (
        <dl className="thought__args">
          {step.args.map((arg) => (
            <div className="thought__arg" key={arg.key}>
              <dt className="thought__argkey">{arg.key}</dt>
              <dd className="thought__argval">{arg.value}</dd>
            </div>
          ))}
        </dl>
      ) : null}
      {step.output ? (
        <pre className="thought__output">
          {step.output.length > PREVIEW_LIMIT
            ? `${step.output.slice(0, PREVIEW_LIMIT)}…`
            : step.output}
        </pre>
      ) : null}
      {!step.output && !unresolved && step.args && step.args.length === 0 ? (
        <p className="thought__empty">该工具没有可展示的返回内容。</p>
      ) : null}
    </div>
  )
}

/**
 * 执行过程（Thought Line）。
 *
 * <p>只展示已经真实发生过的步骤——数据来自 `buildThread`，那里不生成事件。
 * 步骤默认折叠，原始参数与返回不抢占正文阅读空间；点标题才展开。
 *
 * <p>「模型推理」一栏如实标注它是模型内部推理，不是可核验的医学证据；
 * 「已暂停」是信息性终点，不提供批准动作（后端没有确认回传端点）。
 */
export function ThoughtLine({ steps }: { steps: AgentStep[] }) {
  const [openId, setOpenId] = useState<string | null>(null)

  const summary = useMemo(() => {
    const tools = steps.filter((s) => s.kind === "tool").length
    if (tools === 0) return "执行过程"
    return `执行过程 · ${tools} 个工具调用`
  }, [steps])

  // 运行中的真实进度：只报**已经过去的时间**，不编造百分比或「预计剩余」。
  // 计时从本组件第一次看到 running 的那一帧起算；读数只在 running 的步骤上渲染，
  // 下一轮工具调用重新起算——不复用上一轮的读数。
  const runningCount = steps.filter((s) => s.state === "running").length
  const [elapsedSeconds, setElapsedSeconds] = useState(0)
  useEffect(() => {
    if (runningCount === 0) return
    const startedAt = Date.now()
    const timer = window.setInterval(
      () => setElapsedSeconds(Math.floor((Date.now() - startedAt) / 1000)),
      1000,
    )
    return () => window.clearInterval(timer)
  }, [runningCount])

  if (steps.length === 0) return null

  return (
    <section className="thought" aria-label={summary}>
      <p className="thought__summary">
        <Sparkles size={13} strokeWidth={2} aria-hidden="true" />
        <span>{summary}</span>
      </p>

      <ol className="thought__steps">
        {steps.map((step) => {
          const open = openId === step.id
          const hasDetail =
            step.kind === "reasoning"
              ? Boolean(step.text)
              : step.kind === "confirm"
                ? true
                : Boolean(step.output) ||
                  Boolean(step.args && step.args.length > 0) ||
                  // 未确认的步骤即使没有参数也要能展开：那里写着为什么没有结果。
                  step.state === "pending"

          return (
            <li
              key={step.id}
              className={`thought__step is-${step.state}${open ? " is-open" : ""}`}
            >
              <span className="thought__rail" aria-hidden="true">
                <span className="thought__dot">
                  <StateIcon state={step.state} />
                </span>
              </span>

              <button
                type="button"
                className="thought__head"
                aria-expanded={hasDetail ? open : undefined}
                disabled={!hasDetail}
                onClick={() => setOpenId(open ? null : step.id)}
              >
                <span className="thought__label">{step.label}</span>
                {step.toolName && step.toolName !== step.label ? (
                  <span className="thought__toolname num">{step.toolName}</span>
                ) : null}
                {step.state === "running" && elapsedSeconds > 0 ? (
                  <span className="thought__elapsed num" aria-hidden="true">
                    {elapsedSeconds}s
                  </span>
                ) : null}
                <span className={`thought__state is-${step.state}`}>
                  {stepStateLabel(step.state)}
                </span>
                {hasDetail ? (
                  <ChevronDown
                    className="thought__chevron"
                    size={14}
                    strokeWidth={2}
                    aria-hidden="true"
                  />
                ) : null}
              </button>

              {open && hasDetail ? (
                <div className="thought__body">
                  <StepDetail step={step} />
                </div>
              ) : null}
            </li>
          )
        })}
      </ol>
    </section>
  )
}
