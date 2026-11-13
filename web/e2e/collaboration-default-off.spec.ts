import { expect, test } from "@playwright/test"

test("default build preserves ordinary chat and never calls collaboration APIs", async ({
  page,
}) => {
  let collaborationRequests = 0
  await page.route("**/api/**", (route) => {
    const path = new URL(route.request().url()).pathname
    const respond = (data: unknown) =>
      route.fulfill({ json: { code: 0, data, msg: "ok" } })
    if (path.includes("collaboration-runs")) collaborationRequests++
    if (path === "/api/user/get/login")
      return respond({ id: 42, userName: "合成聊天账号", userRole: "user" })
    if (path === "/api/agent/chat/stream")
      return route.fulfill({
        contentType: "text/event-stream",
        body: `data: ${JSON.stringify({ messageType: "assistant", content: "请咨询眼科医生。" })}\n\nevent: done\ndata: {}\n\n`,
      })
    if (path.includes("/history/"))
      return respond({ messages: [], hasMore: false, nextCursor: null })
    return respond([])
  })
  await page.goto("/agent?runId=should-not-connect")
  await page.waitForLoadState("networkidle")
  await expect(
    page.getByRole("button", { name: "影像协作", exact: true })
  ).toHaveCount(0)
  await expect(
    page.getByRole("region", { name: "实时协作工作台" })
  ).toHaveCount(0)
  await page
    .getByRole("textbox", { name: "问答内容" })
    .fill("眼睛疲劳应该怎么办？")
  await page.getByRole("button", { name: "发送", exact: true }).click()
  await expect(page.locator(".agent-msg--assistant")).toContainText(
    "请咨询眼科医生。"
  )
  expect(collaborationRequests).toBe(0)
})
