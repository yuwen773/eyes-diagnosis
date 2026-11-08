import { ApiError } from "./api"

/**
 * 故障的统一模型。
 *
 * 全站只有这一套说法：一个故障有「多严重」「是什么性质」「叫什么名字」
 * 「说了什么」「接下来怎么办」「机器上的状态码是多少」。页面拿到错误后
 * 不再各写各的一句话，直接要一个 Fault 往提示里放。
 *
 * 严重度只用风险语义色（红/琥珀/中性），不碰信号橙——橙色是品牌色，
 * 拿它表示故障会把「注意」和「这里是主按钮」混成一件事。
 */
export type FaultSeverity = "critical" | "attention" | "info"

/** 故障的性质，决定标签与配色。 */
export type FaultKind =
  | "network" // 连不上服务
  | "auth" // 登录 / 权限
  | "validation" // 条件不对
  | "missing" // 内容不在了
  | "server" // 服务端 5xx
  | "client" // 其它
  | "info" // 只是提示

export type FaultAction = {
  label: string
  run: () => void
}

export type Fault = {
  severity: FaultSeverity
  kind: FaultKind
  /** 等宽标签：NET / AUTH / CHECK / MISS / FAULT / ERROR / NOTE */
  tag: string
  /** 一句话结论：发生了什么 */
  title: string
  /** 补充：接下来怎么办 */
  detail?: string
  /** 机器可读的状态码，作为读数摆出来 */
  code?: number | null
  /** 可选动作：重试、去登录 */
  action?: FaultAction
}

/** 出错的是哪一步——同一类错误在不同场景该说不同的话。 */
export type FaultIntent = "generic" | "login" | "register" | "upload" | "send" | "load"

const TAG_BY_KIND: Record<FaultKind, string> = {
  network: "NET",
  auth: "AUTH",
  validation: "CHECK",
  missing: "MISS",
  server: "FAULT",
  client: "ERROR",
  info: "NOTE",
}

/** 手工造一个故障（校验失败、纯提示这类不走接口的场合）。 */
export function fault(spec: {
  severity: FaultSeverity
  kind: FaultKind
  title: string
  detail?: string
  code?: number | null
  action?: FaultAction
}): Fault {
  return {
    severity: spec.severity,
    kind: spec.kind,
    tag: TAG_BY_KIND[spec.kind],
    title: spec.title,
    detail: spec.detail,
    code: spec.code ?? null,
    action: spec.action,
  }
}

/** 校验没过：不是故障，是还没填对——用琥珀，不用红。 */
export function validationFault(title: string): Fault {
  return fault({ severity: "attention", kind: "validation", title })
}

/** 只是想说一句话，不算故障。 */
export function infoFault(title: string): Fault {
  return fault({ severity: "info", kind: "info", title })
}

function networkFault(code: number | null, intent: FaultIntent, action?: FaultAction): Fault {
  if (intent === "upload") {
    return fault({
      severity: "critical",
      kind: "network",
      title: "图片没传上去",
      detail: "检查网络后再试一次，这次消息还没发出去。",
      code,
      action,
    })
  }
  if (intent === "send") {
    return fault({
      severity: "critical",
      kind: "network",
      title: "消息没送出去",
      detail: "连接中断了，消息可能没有送达，稍后可以重发一次。",
      code,
      action,
    })
  }
  return fault({
    severity: "critical",
    kind: "network",
    title: "连不上服务",
    detail: "检查网络后再试一次。",
    code,
    action,
  })
}

/**
 * 把抛出来的东西翻成一条能直接给人看的故障。
 *
 * 后端回的是错误码加一句技术描述（「服务返回 502」「请求数据不存在」），
 * 人要看的却是另一回事：没连上，还是没登录，还是这条已经不在了。
 */
export function faultFromError(
  cause: unknown,
  opts: { intent?: FaultIntent; action?: FaultAction } = {},
): Fault {
  const intent = opts.intent ?? "generic"
  const action = opts.action

  if (cause instanceof ApiError) {
    const { code } = cause

    if (code === -1) return networkFault(code, intent, action)

    if (code === 40100 || code === 40101 || code === 40300) {
      if (intent === "login" || intent === "register") {
        return fault({
          severity: "critical",
          kind: "auth",
          title: "账号或密码不对",
          detail: "再试一次，或确认你注册的是这个账号。",
          code,
          action,
        })
      }
      if (code === 40300) {
        return fault({
          severity: "attention",
          kind: "auth",
          title: "你没有查看这条的权限",
          detail: "换一条内容，或联系管理员开通。",
          code,
          action,
        })
      }
      return fault({
        severity: "attention",
        kind: "auth",
        title: "这条需要登录后才能看",
        detail: "登录之后就能继续。",
        code,
        action,
      })
    }

    if (code === 404 || code === 40400) {
      return fault({
        severity: "attention",
        kind: "missing",
        title: "这条内容已经不在了",
        detail: "它可能已经下架，或者被撤下了。",
        code,
        action,
      })
    }

    if (code === 40000) {
      return fault({
        severity: "attention",
        kind: "validation",
        title: "这次请求的条件不对",
        detail: "换个条件再试一次。",
        code,
        action,
      })
    }

    if (code >= 500) {
      return fault({
        severity: "critical",
        kind: "server",
        title: "服务这会儿没有响应",
        detail: "通常是临时的，过一会儿再试。",
        code,
        action,
      })
    }

    return fault({
      severity: "attention",
      kind: "client",
      title: "这次操作没能完成",
      detail: cause.message,
      code,
      action,
    })
  }

  // fetch 断网抛的是 TypeError。
  if (cause instanceof TypeError) return networkFault(null, intent, action)

  return fault({
    severity: "attention",
    kind: "client",
    title: "出了点意料之外的情况",
    detail: "这条内容没能读出来，稍后再试一次。",
    code: null,
    action,
  })
}
