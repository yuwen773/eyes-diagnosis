import { describe, expect, it } from "vitest"
import { ApiError } from "@/lib/api"
import { authFormMessage } from "./authForm"
import { fault, faultFromError, validationFault } from "./faults"

describe("authFormMessage", () => {
  it("校验失败是请留意，不提供重试", () => {
    const result = authFormMessage(validationFault("请填写账号"))
    expect(result).toEqual({ title: "请填写账号", detail: "", tone: "attention", retryable: false })
  })

  it("登录错误凭据不重试；5xx 与断网提供", () => {
    const denied = authFormMessage(faultFromError(new ApiError(40100, "unauthorized"), { intent: "login" }))
    expect(denied.retryable).toBe(false)
    const gateway = authFormMessage(faultFromError(new ApiError(502, "bad gateway"), { intent: "login" }))
    expect(gateway.retryable).toBe(true)
    const offline = authFormMessage(faultFromError(new ApiError(-1, "offline"), { intent: "login" }))
    expect(offline.retryable).toBe(true)
  })

  it("其它故障沿用统一分类，不重复翻译状态码", () => {
    const custom = fault({ severity: "info", kind: "info", title: "提示" })
    expect(authFormMessage(custom).tone).toBe("info")
  })
})

describe("register retry semantics", () => {
  it("注册 5xx 不提供盲重试，避免账号重复写入歧义", () => {
    const result = authFormMessage(faultFromError(new ApiError(502, "bad gateway"), { intent: "register" }), "register")
    expect(result.retryable).toBe(false)
    expect(result.detail).toContain("如果账号已经创建成功")
  })
})
