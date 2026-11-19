import { useEffect, useMemo, useState } from "react"
import {
  Ban,
  Check,
  ChevronDown,
  CircleDashed,
  CircleHelp,
  CircleX,
  Clock,
  Minus,
  Pause,
  Sparkles,
} from "lucide-react"

import type { AgentStep } from "@/lib/agentSteps"
import { stepStateLabel } from "@/lib/agentSteps"
import { renderMarkdown } from "@/lib/markdown"

/** 折叠时输出预览的最大长度——原始内容默认不抢正文的阅读空间。 */
const PREVIEW_LIMIT = 180

/** 单步的状态图标：完成 / 已返回 / 执行中 / 未确认 / 已暂停 / 失败 / 超时 / 已中断。 */
function StateIcon({ state }: { state: AgentStep["state"] }) {
  if (state === "done") {
    return <Check size={13} strokeWidth={2.6} aria-hidden="true" />
  }
  if (state === "returned") {
    // 结果回来了，但没拿到成败判定——不给实心对勾，那是在替后端下结论。
    return <Minus size={13} strokeWidth={2.4} aria-hidden="true" />
  }
  if (state === "running") {
    return <CircleDashed size={13} strokeWidth={2.2} aria-hidden="true" />
  }
  if (state === "paused") {
    return <Pause size={13} strokeWidth={2.4} aria-hidden="true" />
  }
  if (state === "error") {
    return <CircleX size={13} strokeWidth={2.2} aria-hidden="true" />
  }
  if (state === "timeout") {
    return <Clock size={13} strokeWidth={2.2} aria-hidden="true" />
  }
  if (state === "cancelled") {
    return <Ban size={13} strokeWidth={2.2} aria-hidden="true" />
  }
  // 未确认：不是「还在转」，是一个问号——结果不知道。
  return <CircleHelp size={13} strokeWidth={2} aria-hidden="true" />
}

/**
 * 单个运行中步骤的真实用时。
 *
 * <p>计时状态挂在**这一步自己身上**：并发调用时两行各有各的起点，先开始的工具不会
 * 因为后一个开始而被清零；换步或结束即卸载，读数自然丢弃，不需要在 effect 里
 * 同步 setState 复位。只报已经过去的时间，不编造百分比或「预计剩余」。
 */
function RunningElapsed() {
  const [seconds, setSeconds] = useState(0)
  useEffect(() => {
    const startedAt = Date.now()
    const timer = window.setInterval(
      () => setSeconds(Math.floor((Date.now() - startedAt) / 1000)),
      1000,
    )
    return () => window.clearInterval(timer)
  }, [])
  // 第一秒之前不摆一个「0s」出来假装在动。
  if (seconds === 0) return null
  // 读屏软件读到的是完整句子，视觉上仍只是紧凑的读数。
  return (
    <span className="thought__elapsed num" aria-label={`已用时 ${seconds} 秒`}>
      {seconds}s
    </span>
  )
}

/** 工具结果未返回时的说明：只陈述事实，不说「完成」也不承诺「待返回」。 */
function UnresolvedNote({ state }: { state: AgentStep["state"] }) {
  if (state === "running") {
    return <p className="thought__empty">正在执行…</p>
  }
  if (state === "paused") {
    return <p className="thought__empty">工具执行已暂停，本次回合结束。</p>
  }
  return (
    <p className="thought__empty thought__unresolved">
      本次回合已结束，没有收到这个工具的返回，无法确认它是否执行完成。
    </p>
  )
}

/** 失败类的说明：状态来自真实观察，不把失败包装成完成。 */
function failureNote(step: AgentStep): string | null {
  if (step.state === "error") {
    // 无效输出不是「服务坏了」：换一张图或改问法可能有用，重试同一个请求没用。
    if ((step.errorCategory ?? "").toUpperCase() === "INVALID_OUTPUT") {
      return "工具返回的内容不可用，本次结果不能当作医学证据。"
    }
    return "工具返回了错误，本次结果不能当作医学证据。"
  }
  if (step.state === "timeout") return "工具执行超时，没有拿到完整结果。"
  if (step.state === "cancelled") return "工具执行被中断，结果不完整。"
  return null
}

function StepDetail({ step }: { step: AgentStep }) {
  // hooks 不能放在下面的分支之后；推理正文只渲染一次，避免每次展开都重跑解析。
  const reasoningHtml = useMemo(
    () => (step.kind === "reasoning" && step.text ? renderMarkdown(step.text) : ""),
    [step.kind, step.text],
  )

  if (step.kind === "reasoning") {
    if (!reasoningHtml) return null
    return (
      <div
        className="thought__reasoning markdown-body"
        dangerouslySetInnerHTML={{ __html: reasoningHtml }}
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

  const failure = failureNote(step)
  const hasArgs = Boolean(step.args && step.args.length > 0)
  // 兼容手工构造的步骤（测试/旧调用）：有 output 字段就视为收到过返回；
  // 显式 received=false 仍然优先——空字符串结果不能靠 `!output` 判断。
  const received = step.received ?? step.output !== undefined
  const hasOutput = received && Boolean(step.output && step.output.length > 0)

  return (
    <div className="thought__detail">
      {!received ? <UnresolvedNote state={step.state} /> : null}
      {failure ? (
        <p className={`thought__failure${step.state === "timeout" ? " is-muted" : ""}`}>
          {failure}
        </p>
      ) : null}
      {received && step.state === "returned" ? (
        <p className="thought__empty">
          工具返回了结果，但没有拿到成败判定；工具输出本身不是诊断结论。
        </p>
      ) : null}

      {hasOutput ? (
        <pre className="thought__output">
          {step.output && step.output.length > PREVIEW_LIMIT
            ? `${step.output.slice(0, PREVIEW_LIMIT)}…`
            : step.output}
        </pre>
      ) : null}
      {received && !hasOutput && !failure ? (
        // 失败/超时/中断的正文本来就是空的（错误信息走 failureNote），
        // 再说一句「工具返回了空结果」会把「没跑成」说成「跑成了但没内容」。
        <p className="thought__empty">工具返回了空结果。</p>
      ) : null}

      {hasArgs ? (
        <details className="thought__args-wrap">
          <summary className="thought__args-summary">调用参数</summary>
          <dl className="thought__args">
            {step.args?.map((arg) => (
              <div className="thought__arg" key={arg.key}>
                <dt className="thought__argkey">{arg.key}</dt>
                <dd className="thought__argval">{arg.value}</dd>
              </div>
            ))}
          </dl>
        </details>
      ) : null}
    </div>
  )
}

/**
 * 执行过程（Thought Line）。
 *
 * <p>只展示已经真实发生过的步骤——数据来自 `buildThread`，那里不生成事件。
 * 步骤默认折叠；展开后先看结果摘要，原始参数收在第二层折叠里，不抢正文。
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
          const received = step.received ?? step.output !== undefined
          const hasDetail =
            step.kind === "reasoning"
              ? Boolean(step.text)
              : step.kind === "confirm"
                ? true
                : received ||
                  Boolean(step.args && step.args.length > 0) ||
                  // 未确认的步骤即使没有参数也要能展开：那里写着为什么没有结果。
                  step.state === "pending" ||
                  step.state === "error" ||
                  step.state === "timeout" ||
                  step.state === "cancelled"

          return (
            <li
              key={step.id}
              className={`thought__step is-${step.state}${open ? " is-open" : ""}`}
              // 资源栏「定位到执行步骤」按 toolCallId 找到这一步。
              data-tool-call-id={step.toolCallId}
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
                {step.state === "running" ? <RunningElapsed /> : null}
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
