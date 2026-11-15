import { expect, test, type Page } from "@playwright/test"
import fixture from "../src/lib/__fixtures__/collaboration.v1.json" with { type: "json" }

/** Browser contract fixtures, deliberately separate from collaboration-backend.spec.ts. */
async function setup(
  page: Page,
  options: {
    status?: string
    reason?: string
    clinician?: boolean
    forbidden?: boolean
    long?: boolean
  } = {}
) {
  const started = fixture.events[2],
    completed = fixture.events[3]
  const facts = options.long
    ? Array.from({ length: 85 }, () => started)
    : [
        fixture.events[1],
        started,
        { ...started, actor: "EVIDENCE" },
        { ...completed, actor: "EVIDENCE" },
        completed,
        fixture.events[4],
        fixture.events[5],
        { ...started, actor: "EXPLANATION" },
        { ...completed, actor: "EXPLANATION" },
        { ...started, actor: "CRITIC" },
        fixture.events[7],
        { ...completed, actor: "CRITIC" },
        { ...started, actor: "EXPLANATION" },
        fixture.events[6],
        { ...completed, actor: "EXPLANATION" },
        { ...started, actor: "CRITIC" },
        { ...completed, actor: "CRITIC" },
        fixture.events[8],
        fixture.events[9],
      ]
  if (options.long) facts.push(fixture.events[9])
  let current = {
    ...fixture.snapshot,
    executionStatus: options.status ?? "RUNNING",
    reason: options.reason ?? null,
    projectionVersion: options.clinician ? "v1:admin" : "v1:patient",
  }
  let admissions = 0
  await page.addInitScript(() => {
    localStorage.setItem("agent_current_thread_id:42", "thread-a")
    localStorage.setItem("theme", "light")
  })
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname
    const json = (data: unknown, status = 200) =>
      route.fulfill({
        status,
        json: {
          code: status === 200 ? 0 : status * 100,
          data,
          msg: status === 403 ? "ACCESS_DENIED" : "ok",
        },
      })
    if (path === "/api/user/get/login")
      return json({ id: 42, userName: "合成验收账号", userRole: "user" })
    if (path === "/api/agent/sessions")
      return json([
        { sessionId: "thread-a", title: "眼底影像协作", messageCount: 2 },
        { sessionId: "thread-b", title: "另一会话", messageCount: 1 },
      ])
    if (path.startsWith("/api/agent/history/"))
      return json({ messages: [], hasMore: false, nextCursor: null })
    if (path === "/api/agent/collaboration-runs") {
      admissions++
      return json(current)
    }
    if (path.endsWith("/events")) {
      const selected = facts.filter(
        (e) => options.clinician || e.visibility === "PATIENT"
      )
      const body = selected
        .map((event, i) => {
          const sequence = i + 2
          return `id: opaque-${sequence}\nevent: ${event.type}\ndata: ${JSON.stringify({ ...event, eventId: `run-a:${sequence}`, schemaVersion: 1, runId: "run-a", threadId: "thread-a", sequence: String(sequence), occurredAt: "2026-11-11T12:00:00Z" })}\n\n`
        })
        .join("")
      current = { ...current, executionStatus: "SUCCEEDED" }
      return route.fulfill({ contentType: "text/event-stream", body })
    }
    if (path.startsWith("/api/agent/collaboration-runs/"))
      return json(current, options.forbidden ? 403 : 200)
    return json([])
  })
  await page.goto("/agent?runId=run-a&threadId=thread-a")
  await page.waitForLoadState("networkidle")
  return { admissions: () => admissions }
}

for (const theme of ["light", "dark"]) {
  for (const mobile of [false, true]) {
    test(`completed workbench screenshot / ${theme} / ${mobile ? "mobile" : "desktop"}`, async ({
      page,
    }) => {
      await page.setViewportSize(
        mobile ? { width: 390, height: 844 } : { width: 1440, height: 960 }
      )
      const errors: string[] = []
      page.on("pageerror", (e) => errors.push(e.message))
      await setup(page)
      await expect(page.getByText("协作完成", { exact: true })).toBeVisible()
      if (theme === "dark")
        await page.evaluate(() =>
          document.documentElement.classList.add("dark")
        )
      if (mobile)
        await page
          .getByRole("button", { name: "收起会话", exact: true })
          .click()
      await expect(
        page.getByRole("region", { name: "实时协作工作台" })
      ).toBeVisible()
      await expect(page.getByText("正在复核与修订")).toBeVisible()
      await expect(page.locator(".collab-summary")).toContainText("待医生复核")
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth
        )
      ).toBe(true)
      expect(errors).toEqual([])
      await expect(page).toHaveScreenshot(
        `collaboration-${theme}-${mobile ? "mobile" : "desktop"}.png`,
        { animations: "disabled" }
      )
    })
  }
}

test("patient progress hides handoff details; clinician projection can expand real metadata", async ({
  page,
}) => {
  await setup(page)
  await expect(page.getByText(/已交接/)).toHaveCount(0)
  await expect(page.getByText("查看交接元数据")).toHaveCount(0)
  await page.unrouteAll({ behavior: "wait" })
  await setup(page, { clinician: true })
  await expect(page.getByText(/影像解读 → 证据检索：已交接/)).toBeVisible()
  await page.getByText("查看交接元数据").first().click()
  await expect(page.getByText("调用轮次 1")).toBeVisible()
  await expect(page.locator("body")).not.toContainText(
    "Synthetic private clinical draft"
  )
})

for (const status of ["RESTRICTED", "FAILED", "CANCELLED"]) {
  test(`terminal boundary ${status} never fabricates completion`, async ({
    page,
  }) => {
    await setup(page, {
      status,
      reason: status === "FAILED" ? "PROVIDER_UNAVAILABLE" : "INPUT_RESTRICTED",
    })
    await expect(page.getByText("未执行", { exact: true })).toHaveCount(4)
    await expect(page.getByText("待医生复核", { exact: true })).toHaveCount(0)
    await expect(
      page.getByRole("button", { name: "取消协作任务" })
    ).toHaveCount(0)
  })
}
test("authorization denial clears all protected panels and offers explicit recovery", async ({
  page,
}) => {
  await setup(page, { forbidden: true })
  await expect(page.getByText("当前无权查看此任务")).toBeVisible()
  await expect(page.getByLabel("协作角色状态")).toHaveCount(0)
  await expect(page.getByLabel("影像与证据")).toHaveCount(0)
  await expect(page.getByRole("button", { name: "重新核对状态" })).toBeVisible()
})
test("refresh and session switch never create a collaboration run", async ({
  page,
}) => {
  const state = await setup(page)
  await expect(page.getByText("协作完成", { exact: true })).toBeVisible()
  await page.reload()
  await expect(page.getByText("协作完成", { exact: true })).toBeVisible()
  await page.getByText("另一会话", { exact: true }).click()
  await expect(
    page.getByRole("region", { name: "实时协作工作台" })
  ).toHaveCount(0)
  expect(state.admissions()).toBe(0)
})
test("long records fold and a reader can stop following incoming events", async ({
  page,
}) => {
  await setup(page, { long: true })
  const scroll = page.getByRole("region", { name: "协作记录滚动区" })
  await expect(scroll.getByRole("listitem")).toHaveCount(30)
  await page.getByRole("button", { name: "展开较早记录" }).click()
  await expect(scroll.getByRole("listitem")).toHaveCount(86)
  await scroll.evaluate((el) => {
    el.scrollTop = 0
    el.dispatchEvent(new Event("scroll", { bubbles: true }))
  })
  await expect(page.getByRole("button", { name: "回到最新进展" })).toBeVisible()
  await page.getByRole("button", { name: "回到最新进展" }).click()
  expect(
    await scroll.evaluate(
      (el) => el.scrollHeight - el.scrollTop - el.clientHeight
    )
  ).toBeLessThan(48)
})
test("keyboard, names, contrast and reduced motion are usable on both themes", async ({
  page,
}) => {
  await setup(page)
  await page.getByRole("button", { name: "返回问答", exact: true }).focus()
  await page.keyboard.press("Tab")
  expect(await page.evaluate(() => document.activeElement?.tagName)).not.toBe(
    "BODY"
  )
  expect(
    await page.evaluate(
      () => getComputedStyle(document.activeElement!).outlineStyle
    )
  ).not.toBe("none")
  await expect(page.getByRole("textbox", { name: "问答内容" })).toBeVisible()
  for (const dark of [false, true]) {
    await page.evaluate(
      (dark) => document.documentElement.classList.toggle("dark", dark),
      dark
    )
    const failures = await page
      .locator(".collab-workspace")
      .evaluate((root) => {
        const rgb = (value: string) => value.match(/[\d.]+/g)!.map(Number)
        const luminance = (v: number[]) =>
          v
            .slice(0, 3)
            .map((n) => n / 255)
            .map((n) =>
              n <= 0.04045 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4
            )
            .reduce((sum, n, i) => sum + n * [0.2126, 0.7152, 0.0722][i], 0)
        return Array.from(
          root.querySelectorAll<HTMLElement>(
            "p, h2, h3, summary, time, .collab-eyebrow, .collab-role__status"
          )
        )
          .filter((el) => el.checkVisibility())
          .flatMap((el) => {
            const style = getComputedStyle(el)
            let ancestor: HTMLElement | null = el
            let background = ""
            while (ancestor) {
              background = getComputedStyle(ancestor).backgroundColor
              if (rgb(background)[3] !== 0) break
              ancestor = ancestor.parentElement
            }
            const fg = luminance(rgb(style.color)),
              bg = luminance(rgb(background))
            const contrast =
              (Math.max(fg, bg) + 0.05) / (Math.min(fg, bg) + 0.05)
            return contrast < 4.5 ? [{ text: el.textContent, contrast }] : []
          })
      })
    expect(failures).toEqual([])
  }
  await page.emulateMedia({ reducedMotion: "reduce" })
  expect(
    await page
      .locator(".collab-role")
      .first()
      .evaluate((el) => parseFloat(getComputedStyle(el).transitionDuration))
  ).toBeLessThanOrEqual(0.00001)
})
