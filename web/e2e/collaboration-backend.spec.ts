import { expect, test } from "@playwright/test"

/** Requires the explicit loopback CollaborationBrowserServer; no route.fulfill or mocked SSE. */
test("real Java HTTP/MySQL: upload → incremental facts → review → refresh → cancel → revocation", async ({
  page,
}) => {
  test.setTimeout(90_000)
  await page.setViewportSize({ width: 1440, height: 960 })
  const revokedImages: string[] = []
  await page.exposeFunction("recordRevokedImage", (url: string) => revokedImages.push(url))
  await page.addInitScript(() => {
    const revoke = URL.revokeObjectURL.bind(URL)
    URL.revokeObjectURL = (url: string) => {
      void (window as typeof window & { recordRevokedImage: (url: string) => Promise<void> }).recordRevokedImage(url)
      revoke(url)
    }
  })
  const initial = (await (await page.request.get("/api/test/counts")).json()).data.statuses
  await page.request.post("/api/test/hold")
  await page.request.post("/api/test/session")
  await page.addInitScript(() => {
    localStorage.setItem("agent_current_thread_id:42", "thread-42")
    localStorage.setItem("theme", "light")
  })
  await page.goto("/agent")
  await page.waitForLoadState("networkidle")
  await page.getByRole("button", { name: "影像协作", exact: true }).click()
  // A valid 1px synthetic PNG, never a clinical input.
  const image = Buffer.from(
    await page.evaluate(() => {
      const canvas = document.createElement("canvas")
      canvas.width = canvas.height = 1
      return canvas.toDataURL("image/png").split(",")[1]
    }),
    "base64"
  )
  await page
    .getByLabel(/选择一张 JPEG/)
    .setInputFiles({
      name: "synthetic-fundus.png",
      mimeType: "image/png",
      buffer: image,
    })
  await page.getByRole("button", { name: "提交影像并开始协作" }).click()
  await expect(page.getByText("正在协作", { exact: true })).toBeVisible()
  await expect(page.locator('.collab-role[data-state="RUNNING"]')).toHaveCount(
    2
  )
  await page.request.post("/api/test/release-evidence")
  await expect(page.locator('.collab-role[data-state="RUNNING"]')).toHaveCount(
    1
  )
  await expect(
    page.locator('.collab-role[data-state="COMPLETED"]')
  ).toHaveCount(1)
  await expect(
    page.getByText("证据检索本轮处理完成", { exact: true })
  ).toBeVisible()
  await expect(page.getByAltText("本次提交的眼底影像")).toBeVisible()
  await page.screenshot({
    path: "../docs/testing/realtime-collaboration-ui-20261111/real-http-running.png",
  })
  await page.request.post("/api/test/release")
  await expect(page.getByText("协作完成", { exact: true })).toBeVisible()
  await expect(page.locator(".collab-summary")).toContainText("待医生复核")
  await expect(page.getByText(/已交接/)).toHaveCount(0)
  await expect(page.locator("body")).not.toContainText(
    "Synthetic private clinical draft"
  )
  const before = await (await page.request.get("/api/test/counts")).json()
  await page.reload()
  await expect(page.getByText("协作完成", { exact: true })).toBeVisible()
  expect(await (await page.request.get("/api/test/counts")).json()).toEqual(
    before
  )
  await expect(page.getByAltText("本次提交的眼底影像")).toHaveCount(0)
  await page.screenshot({
    path: "../docs/testing/realtime-collaboration-ui-20261111/real-http-restored.png",
  })
  await page.getByRole("button", { name: "返回问答", exact: true }).click()
  await page.request.post("/api/test/hold")
  await page.getByRole("button", { name: "影像协作", exact: true }).click()
  await page
    .getByLabel(/选择一张 JPEG/)
    .setInputFiles({
      name: "synthetic-cancel.png",
      mimeType: "image/png",
      buffer: image,
    })
  await page.getByRole("button", { name: "提交影像并开始协作" }).click()
  await expect(page.getByText("正在协作", { exact: true })).toBeVisible()
  await page.getByRole("button", { name: "取消协作任务" }).click()
  await expect(
    page.getByText("任务已取消", { exact: true }).first()
  ).toBeVisible()
  await page.request.post("/api/test/release")
  await page.getByRole("button", { name: "刷新复核状态" }).click()
  await expect(
    page.getByText("任务已取消", { exact: true }).first()
  ).toBeVisible()
  await expect(page.getByText("待医生复核", { exact: true })).toHaveCount(0)
  await page.getByRole("button", { name: "返回问答", exact: true }).click()
  await page.request.post("/api/test/hold")
  await page.getByRole("button", { name: "影像协作", exact: true }).click()
  await page
    .getByLabel(/选择一张 JPEG/)
    .setInputFiles({
      name: "synthetic-revoke.png",
      mimeType: "image/png",
      buffer: image,
    })
  await page.getByRole("button", { name: "提交影像并开始协作" }).click()
  await expect(page.getByText("正在协作", { exact: true })).toBeVisible()
  const revocationsBefore = revokedImages.length
  await page.request.post("/api/test/revoke")
  await expect(page.getByText("当前无权查看此任务")).toBeVisible({
    timeout: 10000,
  })
  await expect(page.getByLabel("协作角色状态")).toHaveCount(0)
  await expect(page.getByLabel("影像与证据")).toHaveCount(0)
  await expect.poll(() => revokedImages.length).toBeGreaterThan(revocationsBefore)
  await page.request.post("/api/test/release")
  await expect
    .poll(
      async () =>
        (await (await page.request.get("/api/test/counts")).json()).data
          .statuses
    )
    .toEqual([...initial, "SUCCEEDED", "CANCELLED", "SUCCEEDED"])
})
