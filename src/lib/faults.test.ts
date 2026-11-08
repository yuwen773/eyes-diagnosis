import { describe, expect, it } from "vitest"
import { ApiError } from "./api"
import { faultFromError, infoFault, validationFault } from "./faults"

describe("faultFromError", () => {
  it("断网（-1）说的是「连不上服务」，不是技术描述", () => {
    const f = faultFromError(new ApiError(-1, "fetch failed"))
    expect(f.kind).toBe("network")
    expect(f.tag).toBe("NET")
    expect(f.severity).toBe("critical")
    expect(f.title).toBe("连不上服务")
    expect(f.detail).toContain("网络")
  })

  it("上传场景把断网说成「图片没传上去」", () => {
    const f = faultFromError(new ApiError(-1, "fetch failed"), { intent: "upload" })
    expect(f.title).toBe("图片没传上去")
  })

  it("发送场景把断网说成「消息没送出去」", () => {
    const f = faultFromError(new ApiError(-1, "fetch failed"), { intent: "send" })
    expect(f.title).toBe("消息没送出去")
  })

  it("登录表单里的 40100 是「账号或密码不对」，不是「需要登录」", () => {
    const f = faultFromError(new ApiError(40100, "unauthorized"), { intent: "login" })
    expect(f.kind).toBe("auth")
    expect(f.tag).toBe("AUTH")
    expect(f.severity).toBe("critical")
    expect(f.title).toBe("账号或密码不对")
  })

  it("读取场景里的 40100 是「需要登录」", () => {
    const f = faultFromError(new ApiError(40100, "unauthorized"))
    expect(f.title).toBe("这条需要登录后才能看")
    expect(f.severity).toBe("attention")
  })

  it("40300 是权限问题，措辞与未登录区分开", () => {
    const f = faultFromError(new ApiError(40300, "forbidden"))
    expect(f.title).toBe("你没有查看这条的权限")
  })

  it("404 说成「已经不在了」，并带上状态码读数", () => {
    const f = faultFromError(new ApiError(404, "not found"))
    expect(f.kind).toBe("missing")
    expect(f.tag).toBe("MISS")
    expect(f.code).toBe(404)
  })

  it("5xx 是服务故障，最严重", () => {
    const f = faultFromError(new ApiError(502, "bad gateway"))
    expect(f.kind).toBe("server")
    expect(f.tag).toBe("FAULT")
    expect(f.severity).toBe("critical")
  })

  it("非 ApiError 的意外给出兜底说法", () => {
    const f = faultFromError(new Error("boom"))
    expect(f.kind).toBe("client")
    expect(f.severity).toBe("attention")
    expect(f.title).toBe("出了点意料之外的情况")
  })

  it("动作原样带出来，供提示里放「重试」", () => {
    const run = () => {}
    const f = faultFromError(new ApiError(500, "boom"), { action: { label: "重试", run } })
    expect(f.action?.label).toBe("重试")
  })
})

describe("手工故障", () => {
  it("校验类是琥珀色，不是红色", () => {
    const f = validationFault("两次输入的密码不一致")
    expect(f.severity).toBe("attention")
    expect(f.kind).toBe("validation")
    expect(f.tag).toBe("CHECK")
  })

  it("提示是中性的", () => {
    const f = infoFault("已复制到剪贴板")
    expect(f.severity).toBe("info")
    expect(f.tag).toBe("NOTE")
  })
})
