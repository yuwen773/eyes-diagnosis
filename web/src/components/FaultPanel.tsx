import { IrisErrorState } from "@/components/system/IrisStates"
import { ApiError } from "@/lib/api"
import { fault, faultFromError } from "@/lib/faults"

/**
 * 页内故障面板（新闻 / 记录详情等整页读取失败）。
 *
 * 对外 props 保持不变，调用方无需改动；内部统一走 Iris 错误状态外壳，
 * 消除与 FaultNote(panel) 重复的仪器式样式。
 *
 * 严重度与故障种类不在这里重复判断：交给全站唯一的 faultFromError，
 * 再覆盖调用方给的标题、说明与重试动作。状态码作为读数露出，方便用户报障。
 */
export function FaultPanel({
  code,
  title,
  body,
  endpoint,
  onRetry,
}: {
  code: number | null
  title: string
  body: string
  /** 出问题的那个调用，写成让人能对得上号的读数。 */
  endpoint: string
  onRetry: () => void
}) {
  // code 为 null 表示拿不到机器码（例如后端返回了非 JSON 错误页），
  // 不能当作断网（-1）。其余交给全站唯一的 faultFromError 分类：
  // 它先匹配 401/403/404/400 等业务码，再用 >=500 判服务端故障，
  // 避免把 40400 这类五位业务码误判成 critical。
  const base =
    code === null
      ? fault({ severity: "attention", kind: "client", title, detail: body, code: null })
      : faultFromError(new ApiError(code, body))
  return (
    <IrisErrorState
      fault={{
        ...base,
        title,
        detail: body,
        code,
        action: { label: "重试", run: onRetry },
      }}
      readouts={[
        { label: "状态", value: code === null ? "—" : String(code) },
        { label: "请求", value: endpoint },
      ]}
    />
  )
}
