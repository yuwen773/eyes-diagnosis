import { expect, test, type Page } from "@playwright/test"
import { readFileSync, mkdirSync, writeFileSync } from "node:fs"
import { resolve } from "node:path"
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
    live?: boolean
    review?: string
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
    reviewStatus: options.review ?? fixture.snapshot.reviewStatus,
    projectionVersion: options.clinician ? "v1:doctor:review-a" : "v1:patient",
  }
  let admissions = 0
  let cancellations = 0
  let saves = 0
  if (options.live) {
    await page.addInitScript(
      ({ samples }) => {
        let controller: ReadableStreamDefaultController<Uint8Array> | null =
          null
        let sequence = 1
        const cursors: string[] = []
        const original = window.fetch.bind(window)
        const send = (type: string) => {
          const sample = samples.find((event) => event.type === type)!
          sequence++
          controller?.enqueue(
            new TextEncoder().encode(
              `id: live-${sequence}\nevent: ${type}\ndata: ${JSON.stringify({ ...sample, schemaVersion: 1, runId: "run-a", threadId: "thread-a", occurredAt: "2026-11-14T12:00:00Z", sequence, eventId: `run-a:${sequence}` })}\n\n`
            )
          )
        }
        Object.assign(window, {
          __irisStream: {
            cursors,
            disconnect: () =>
              controller?.error(new TypeError("synthetic disconnect")),
            finish: () => {
              send("run.cancelled")
              controller?.close()
            },
          },
        })
        window.fetch = async (input, init) => {
          if (String(input).endsWith("/collaboration-runs/run-a/events")) {
            cursors.push(new Headers(init?.headers).get("Last-Event-ID") ?? "")
            return new Response(
              new ReadableStream<Uint8Array>({
                start(next) {
                  controller = next
                  init?.signal?.addEventListener(
                    "abort",
                    () => {
                      try {
                        next.close()
                      } catch {
                        /* already closed fixture */
                      }
                    },
                    { once: true }
                  )
                  if (cursors.length === 1) {
                    send("run.started")
                    send("agent.started")
                    next.enqueue(
                      new TextEncoder().encode(
                        'id: opaque-scanned\nevent: run.heartbeat\ndata: {"schemaVersion":1}\n\n'
                      )
                    )
                  }
                },
              }),
              { headers: { "Content-Type": "text/event-stream" } }
            )
          }
          return original(input, init)
        }
      },
      { samples: fixture.events }
    )
  }
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
      return json({
        id: "42",
        userName: "合成验收账号",
        userRole: options.clinician ? "doctor" : "user",
      })
    if (path === "/api/agent/sessions")
      if (route.request().method() === "POST")
        return json({ sessionId: route.request().postDataJSON().sessionId })
    if (path === "/api/agent/sessions")
      return json([
        { sessionId: "thread-a", title: "眼底影像协作", messageCount: 2 },
        { sessionId: "thread-b", title: "另一会话", messageCount: 1 },
      ])
    if (path.startsWith("/api/agent/history/"))
      return json({ messages: [], hasMore: false, nextCursor: null })
    if (path === "/api/agent/collaboration-runs") {
      admissions++
      const body = route.request().postDataJSON()
      current = {
        ...current,
        runId: "run-created",
        threadId: body.threadId,
        taskId: body.taskId,
        executionStatus: "RUNNING",
      }
      return json(current)
    }
    if (path.endsWith("/cancel")) {
      cancellations++
      current = { ...current, executionStatus: "CANCEL_REQUESTED" }
      return json({ status: "CANCEL_REQUESTED", outcome: "REQUESTED" })
    }
    if (path === "/api/diagnosis-tasks")
      return json(
        route.request().method() === "POST"
          ? { taskId: "task-a", status: "WAITING_REVIEW" }
          : [{ taskId: "task-a", status: "WAITING_REVIEW" }]
      )
    if (path === "/api/diagnosis-tasks/task-a")
      return json({ taskId: "task-a", status: "WAITING_REVIEW" })
    const explanation = {
      claims: [
        {
          id: "synthetic-claim",
          section: "MAIN_FINDING",
          text: "合成已批准说明",
          references: [{ citationIndex: 0, quote: "合成引用" }],
        },
      ],
      sources: [
        {
          citationIndex: 0,
          title: "合成受控来源",
          source: "合成来源",
          documentVersion: "synthetic-v1",
          governanceVersion: 1,
          excerpt: "合成引用",
        },
      ],
      disclaimer: "合成验收，不用于临床。",
      modelVersion: "synthetic",
      calibrationNotice: "未用于临床校准",
    }
    if (path.endsWith("/explanation"))
      return json({
        taskId: "task-a",
        status: "AVAILABLE",
        message: "",
        result: explanation,
      })
    if (path.includes("/citations/")) return json(explanation.sources[0])
    if (path.includes("/save-authorization")) {
      if (route.request().method() === "POST") saves++
      return json({
        taskId: "task-a",
        authorizationId: "synthetic-consent",
        status: saves ? "APPROVED" : "OFFERED",
        taskVersion: "2",
        draftVersion: 1,
        evidenceVersion: 1,
        contentDigest: "a".repeat(64),
        expiresAt: "2099-01-01T00:00:00Z",
        content: saves
          ? null
          : { explanation, modelPrediction: "glaucoma", modelProbability: 70 },
        receipt: saves
          ? {
              receiptId: "synthetic-receipt",
              taskId: "task-a",
              diagnosisId: "999",
              authorizedAt: "2026-11-14T12:00:00Z",
              contentDigest: "a".repeat(64),
            }
          : null,
      })
    }
    if (path === "/api/doctor-reviews")
      return json([
        {
          reviewId: "review-a",
          taskId: "task-a",
          status: "PENDING",
          assignedAt: "2026-11-14T12:00:00Z",
        },
      ])
    if (path === "/api/doctor-reviews/review-a")
      return json({
        reviewId: "review-a",
        taskId: "task-a",
        status: "PENDING",
        assignedAt: "2026-11-14T12:00:00Z",
        taskVersion: "2",
        draftVersion: 1,
        evidenceVersion: 1,
        materialDigest: "b".repeat(64),
        note: null,
        materials: {
          draft: { claims: explanation.claims },
          evidence: explanation.sources,
          agentMessages: [],
        },
      })
    if (path.endsWith("/events")) {
      const selected = facts.filter(
        (e) => options.clinician || e.visibility === "PATIENT"
      )
      const body = selected
        .map((event, i) => {
          const sequence = i + 2
          return `id: opaque-${sequence}\nevent: ${event.type}\ndata: ${JSON.stringify({ ...event, eventId: `${current.runId}:${sequence}`, schemaVersion: 1, runId: current.runId, threadId: current.threadId, sequence: String(sequence), occurredAt: "2026-11-11T12:00:00Z" })}\n\n`
        })
        .join("")
      current = { ...current, executionStatus: "SUCCEEDED" }
      return route.fulfill({ contentType: "text/event-stream", body })
    }
    if (path.endsWith("/image"))
      return route.fulfill({
        contentType: "image/png",
        body: readFileSync(
          new URL("./fixtures/collaboration-synthetic.png", import.meta.url)
        ),
      })
    if (path.startsWith("/api/agent/collaboration-runs/"))
      return json(current, options.forbidden ? 403 : 200)
    return json([])
  })
  await page.goto("/agent/collaboration?runId=run-a&threadId=thread-a")
  await page.waitForLoadState("networkidle")
  return {
    admissions: () => admissions,
    cancellations: () => cancellations,
    saves: () => saves,
  }
}

function textContrastFailures(root: HTMLElement) {
  const rgb = (value: string) => value.match(/[\d.]+/g)!.map(Number)
  const luminance = (v: number[]) =>
    v
      .slice(0, 3)
      .map((n) => n / 255)
      .map((n) => (n <= 0.04045 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4))
      .reduce((sum, n, i) => sum + n * [0.2126, 0.7152, 0.0722][i], 0)
  return Array.from(
    root.querySelectorAll<HTMLElement>(
      "p, h1, h2, h3, h4, summary, time, button, a, label, select, .collab-eyebrow, .collab-role__status"
    )
  )
    .filter(
      (el) =>
        el.checkVisibility() &&
        !el.matches(":disabled") &&
        el.textContent?.trim()
    )
    .flatMap((el) => {
      const ancestors: HTMLElement[] = []
      for (
        let ancestor: HTMLElement | null = el;
        ancestor;
        ancestor = ancestor.parentElement
      )
        ancestors.unshift(ancestor)
      let background = [255, 255, 255]
      let outside = background
      for (const ancestor of ancestors) {
        if (ancestor === el) outside = background
        const color = rgb(getComputedStyle(ancestor).backgroundColor)
        const alpha = color[3] ?? 1
        background = background.map(
          (value, i) => color[i] * alpha + value * (1 - alpha)
        )
      }
      const fg = luminance(rgb(getComputedStyle(el).color)),
        bg = luminance(background)
      const contrast = (Math.max(fg, bg) + 0.05) / (Math.min(fg, bg) + 0.05)
      if (contrast < 4.5) return [{ text: el.textContent?.trim(), contrast }]
      if (el.matches(".collab-button, select, textarea")) {
        const border = rgb(getComputedStyle(el).borderTopColor)
        const alpha = border[3] ?? 1
        const edge = luminance(
          outside.map((value, i) => border[i] * alpha + value * (1 - alpha))
        )
        const adjacent = luminance(outside)
        const controlContrast =
          (Math.max(edge, adjacent) + 0.05) / (Math.min(edge, adjacent) + 0.05)
        if (controlContrast < 3)
          return [
            {
              text: `control:${el.textContent?.trim()}`,
              contrast: controlContrast,
            },
          ]
      }
      return []
    })
}

for (const theme of ["light", "dark"]) {
  for (const width of [390, 768, 820, 900, 1440, 1920]) {
    test(`completed workbench screenshot / ${theme} / ${width}`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: width < 900 ? 844 : 1080 })
      const errors: string[] = []
      page.on("pageerror", (e) => errors.push(e.message))
      await setup(page)
      await expect(page.getByText("协作完成", { exact: true })).toBeVisible()
      if (theme === "dark")
        await page.getByRole("button", { name: "切换到暗色主题" }).click()
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
      await page.evaluate(() => document.fonts.ready)
      await expect(page.getByAltText("本次提交的眼底影像")).toBeVisible()
      await expect(page.getByAltText("本次提交的眼底影像")).toHaveJSProperty(
        "naturalWidth",
        640
      )
      const contrast = await page
        .locator(".collab-page-main")
        .evaluate(textContrastFailures)
      expect(contrast).toEqual([])
      const dir = resolve(
        "../docs/testing/iris2-collaboration-20261114/screenshots"
      )
      mkdirSync(dir, { recursive: true })
      writeFileSync(
        resolve(dir, `ui-${theme}-${width}.json`),
        JSON.stringify(
          {
            evidenceType: "ACTUAL_BROWSER_SYNTHETIC_API",
            viewport: { width, height: width < 900 ? 844 : 1080 },
            theme,
            capturedAt: new Date().toISOString(),
            contrastFailures: contrast,
            horizontalOverflow: await page.evaluate(
              () => document.documentElement.scrollWidth > innerWidth
            ),
            roles: await page.locator(".collab-role").count(),
            imageObjectFit: await page
              .getByAltText("本次提交的眼底影像")
              .evaluate((el) => getComputedStyle(el).objectFit),
          },
          null,
          2
        )
      )
      await page.screenshot({
        path: resolve(dir, `collaboration-${theme}-${width}.png`),
        fullPage: true,
        animations: "disabled",
      })
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
  await page.getByRole("button", { name: "返回问答", exact: true }).click()
  await expect(page).toHaveURL(/\/agent$/)
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
  await expect(page.getByRole("textbox", { name: "问答内容" })).toHaveCount(0)
  for (const dark of [false, true]) {
    await page.evaluate(
      (dark) => document.documentElement.classList.toggle("dark", dark),
      dark
    )
    const failures = await page
      .locator(".collab-page-main")
      .evaluate(textContrastFailures)
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

test("a live disconnect resumes the applied cursor without readmission; cancel acknowledgement stays pending", async ({
  page,
}) => {
  const state = await setup(page, { live: true })
  await expect(page.locator('.collab-role[data-state="RUNNING"]')).toHaveCount(
    1
  )
  await page.evaluate(() =>
    (
      window as unknown as { __irisStream: { disconnect(): void } }
    ).__irisStream.disconnect()
  )
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as unknown as { __irisStream: { cursors: string[] } })
            .__irisStream.cursors.length
      )
    )
    .toBe(2)
  expect(
    await page.evaluate(
      () =>
        (window as unknown as { __irisStream: { cursors: string[] } })
          .__irisStream.cursors[1]
    )
  ).toBe("opaque-scanned")
  await expect(
    page.getByRole("region", { name: "协作记录滚动区" }).getByRole("listitem")
  ).toHaveCount(2)
  expect(state.admissions()).toBe(0)
  expect(state.cancellations()).toBe(0)
  await page.getByRole("button", { name: "取消协作任务" }).click()
  await expect(page.getByRole("button", { name: "正在取消…" })).toBeDisabled()
  await expect(page.locator(".collab-summary")).not.toContainText("任务已取消")
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as unknown as { __irisStream: { cursors: string[] } })
            .__irisStream.cursors.length
      )
    )
    .toBe(3)
  await page.evaluate(() =>
    (
      window as unknown as { __irisStream: { finish(): void } }
    ).__irisStream.finish()
  )
  await expect(page.locator(".collab-summary")).toContainText("任务已取消")
  expect(state.cancellations()).toBe(1)
})

test("existing task admission creates one session and one run, preserving ordinary chat", async ({
  page,
}) => {
  const state = await setup(page)
  await page.getByRole("button", { name: "新建协作", exact: true }).click()
  await page.getByRole("button", { name: "选择本人已有影像任务" }).click()
  await page.getByLabel("本人影像任务").selectOption("task-a")
  await page.getByRole("button", { name: "继续受理协作" }).click()
  await expect(page).toHaveURL(/runId=run-created/)
  await expect(page.locator(".collab-summary")).toContainText("协作完成")
  expect(state.admissions()).toBe(1)
  await page.route("**/api/agent/chat/stream", (route) =>
    route.fulfill({
      contentType: "text/event-stream",
      body: 'data: {"messageType":"assistant","content":"合成普通问答回复"}\n\nevent: done\ndata: {}\n\n',
    })
  )
  await page.getByRole("button", { name: "返回问答", exact: true }).click()
  await page.locator(".agent-input__textarea").fill("合成普通问题")
  await page.getByRole("button", { name: "发送", exact: true }).click()
  await expect(
    page.getByText("合成普通问答回复", { exact: true })
  ).toBeVisible()
  expect(state.admissions()).toBe(1)
})

test("upload admission uses the existing task chain and an authorized blob preview", async ({
  page,
}) => {
  const state = await setup(page)
  await page.getByRole("button", { name: "新建协作", exact: true }).click()
  await page
    .getByLabel(/选择一张 JPEG/)
    .setInputFiles(resolve("e2e/fixtures/collaboration-synthetic.png"))
  await page.getByRole("button", { name: "提交影像并开始协作" }).click()
  await expect(page).toHaveURL(/runId=run-created/)
  const image = page.getByAltText("本次提交的眼底影像")
  await expect(image).toBeVisible()
  expect(
    await image.evaluate((el) => {
      const img = el as HTMLImageElement
      return img.naturalWidth / img.naturalHeight
    })
  ).toBe(1)
  const preview = page.getByRole("link", { name: "在新窗口放大本次提交影像" })
  await expect(preview).toHaveAttribute("href", /^blob:/)
  const popup = page.waitForEvent("popup")
  await preview.click()
  const opened = await popup
  await opened.waitForLoadState("load")
  await expect(opened.locator("img")).toBeVisible()
  await opened.close()
  expect(state.admissions()).toBe(1)
})

test("approved patient results and controlled citations do not imply save consent", async ({
  page,
}) => {
  const state = await setup(page, { status: "SUCCEEDED", review: "APPROVED" })
  await expect(page.getByText("合成已批准说明", { exact: true })).toBeVisible()
  await page.getByRole("button", { name: "查看依据 1", exact: true }).click()
  await expect(
    page.getByRole("heading", { name: /合成受控来源/ })
  ).toBeVisible()
  expect(state.saves()).toBe(0)
  await page.getByRole("button", { name: "查看拟保存内容或查询回执" }).click()
  await expect(
    page.getByRole("button", { name: "同意并保存", exact: true })
  ).toBeDisabled()
  const consent = await page.getByRole("checkbox").evaluate((el) => {
    const box = el.closest("label")!.getBoundingClientRect()
    return { width: box.width, height: box.height }
  })
  expect(consent.width).toBeGreaterThanOrEqual(44)
  expect(consent.height).toBeGreaterThanOrEqual(44)
  await page.getByRole("checkbox").check()
  await page.getByRole("button", { name: "同意并保存", exact: true }).click()
  await expect.poll(() => state.saves()).toBe(1)
})

test("doctor projection enters the existing authorized review route", async ({
  page,
}) => {
  await setup(page, { clinician: true })
  await page.getByRole("link", { name: "进入医生复核" }).click()
  await expect(page).toHaveURL(/\/doctor-reviews$/)
  await expect(
    page.getByRole("button", { name: "刷新我的复核任务" })
  ).toBeVisible()
  await page.getByRole("button", { name: "刷新我的复核任务" }).click()
  await page.getByRole("button", { name: /复核任务 1/ }).click()
  const image = page.getByAltText("供医生复核的本任务影像")
  await expect(image).toBeVisible()
  let canvas = ""
  for (const theme of ["light", "dark"]) {
    if (theme === "dark")
      await page.getByRole("button", { name: "切换到暗色主题" }).click()
    const color = await image.evaluate(
      (el) => getComputedStyle(el.parentElement!).backgroundColor
    )
    const rgb = color.match(/[\d.]+/g)!.map(Number)
    expect(rgb[3] ?? 1).toBe(1)
    expect(
      Math.max(...rgb.slice(0, 3)) - Math.min(...rgb.slice(0, 3))
    ).toBeLessThan(10)
    if (canvas) expect(color).toBe(canvas)
    canvas = color
    expect(
      await page.locator(".review-page").evaluate(textContrastFailures)
    ).toEqual([])
    const dir = resolve(
      "../docs/testing/iris2-collaboration-20261114/screenshots"
    )
    mkdirSync(dir, { recursive: true })
    await page.screenshot({
      path: resolve(dir, `doctor-review-${theme}-1440.png`),
      fullPage: true,
    })
  }
})

for (const theme of ["light", "dark"]) {
  for (const width of [390, 1440]) {
    test(`new task form, touch targets and focus / ${theme} / ${width}`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 960 })
      await setup(page)
      await page.getByRole("button", { name: "新建协作", exact: true }).click()
      if (theme === "dark")
        await page.getByRole("button", { name: "切换到暗色主题" }).click()
      await expect(page.getByLabel(/选择一张 JPEG/)).toBeVisible()
      await expect(page.getByText("尚未启动", { exact: true })).toHaveCount(4)
      const small = await page.locator(".collab-page-main").evaluate((root) =>
        Array.from(
          root.querySelectorAll<HTMLElement>(
            "a, button, input, select, summary"
          )
        )
          .filter((el) => el.checkVisibility() && !el.matches(":disabled"))
          .flatMap((el) => {
            const box = el.getBoundingClientRect()
            return box.width < 44 || box.height < 44
              ? [{ text: el.textContent, width: box.width, height: box.height }]
              : []
          })
      )
      expect(small).toEqual([])
      expect(
        await page.locator(".collab-page-main").evaluate(textContrastFailures)
      ).toEqual([])
      await page.keyboard.press("Tab")
      await page.getByRole("button", { name: "选择本人已有影像任务" }).focus()
      expect(
        await page.evaluate(
          () => getComputedStyle(document.activeElement!).outlineStyle
        )
      ).not.toBe("none")
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth
        )
      ).toBe(true)
      const dir = resolve(
        "../docs/testing/iris2-collaboration-20261114/screenshots"
      )
      mkdirSync(dir, { recursive: true })
      await page.screenshot({
        path: resolve(dir, `collaboration-new-${theme}-${width}.png`),
        fullPage: true,
      })
    })
  }
}
