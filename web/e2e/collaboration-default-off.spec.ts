import { expect, test } from "@playwright/test"

test("production default-off keeps collaboration closed and ordinary chat independent", async ({
  page,
}) => {
  const protectedRequests: string[] = []
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname
    if (path.includes("collaboration-runs") || path.includes("diagnosis-tasks"))
      protectedRequests.push(path)
    const data = path.endsWith("/user/get/login")
      ? { id: "42", userName: "合成账号", userRole: "user" }
      : []
    await route.fulfill({ json: { code: 0, data, msg: "ok" } })
  })
  await page.goto("/agent/collaboration?runId=run-a&threadId=thread-a")
  await expect(
    page.getByRole("heading", { name: "协作暂未开放" })
  ).toBeVisible()
  await expect(
    page.getByRole("link", { name: "影像协作", exact: true })
  ).toHaveCount(0)
  expect(protectedRequests).toEqual([])
  await page.getByRole("link", { name: "返回普通问答" }).click()
  await expect(page).toHaveURL(/\/agent$/)
  await expect(page.locator(".agent-input__textarea")).toBeVisible()
  await expect(
    page.getByRole("region", { name: "实时协作工作台" })
  ).toHaveCount(0)
  expect(protectedRequests).toEqual([])
})
