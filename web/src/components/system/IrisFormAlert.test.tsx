// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { IrisFormAlert } from "./IrisFormAlert"
import { IrisRefreshNotice, IrisSectionError } from "./IrisSectionState"

afterEach(() => cleanup())

describe("IrisFormAlert", () => {
  it("表单级错误带 alert 语义，不暴露机器标签", () => {
    render(<IrisFormAlert severity="critical" title="服务这会儿没有响应" detail="过一会儿再试。" />)
    const alert = screen.getByRole("alert")
    expect(alert.textContent).toContain("服务这会儿没有响应")
    expect(alert.textContent).not.toMatch(/NET|AUTH|CHECK|FAULT|HTTP|502/)
  })

  it("字段级错误可被 aria-describedby 关联", () => {
    render(
      <>
        <input id="account" aria-describedby="account-error" aria-invalid />
        <IrisFormAlert id="account-error" severity="attention" title="请填写账号" field />
      </>,
    )
    const input = screen.getByRole("textbox") as HTMLInputElement
    expect(input.getAttribute("aria-describedby")).toBe("account-error")
    expect(document.getElementById("account-error")?.textContent).toContain("请填写账号")
    expect(screen.getByRole("status").className).toContain("is-field")
  })
})

describe("IrisSectionError / IrisRefreshNotice", () => {
  it("首次失败给严重度文字标签与重试", () => {
    const retry = vi.fn()
    render(
      <IrisSectionError
        severity="critical"
        title="资讯没能读出来"
        detail="服务这会儿没有响应"
        actionLabel="重试"
        onAction={retry}
      />,
    )
    const alert = screen.getByRole("alert")
    expect(alert.textContent).toContain("需要处理")
    screen.getByRole("button", { name: "重试" }).click()
    expect(retry).toHaveBeenCalledOnce()
  })

  it("缓存刷新失败只给非阻断提示", () => {
    const retry = vi.fn()
    render(<IrisRefreshNotice detail="服务这会儿没有响应" onRetry={retry} />)
    expect(screen.getByRole("status").textContent).toContain("内容没有刷新成功")
    screen.getByRole("button", { name: "再试一次" }).click()
    expect(retry).toHaveBeenCalledOnce()
  })
})
