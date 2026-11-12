/**
 * R2.5-04 判读工作区 · 视觉证据采集（可复跑）
 *
 * 用法（先在 web/ 下起 vite，再另开一个终端）：
 *
 *   EVIDENCE_USER=<测试账号> EVIDENCE_PASS=<密码> \
 *   node scripts/evidence/r25-04-diagnosis.mjs
 *
 * 可选：EVIDENCE_BASE（默认 http://localhost:5175）、EVIDENCE_OUT（默认 .shots/r25-04-diag）、
 *       EVIDENCE_CHROME（默认本机 Playwright Chromium 路径）。
 *
 * 说明：
 * - 空 / 就绪 / 进行中 / 失败四态走真实后端；本机未起 gRPC 算法服务时判读会 500，
 *   「进行中」通过延迟真实请求截取，「失败」就是这次真实 500。
 * - 成功 / 拒识两态用真实接口响应形状的**布局夹具**（下图 RESULT / REJECTED），
 *   只为验证记录纸、拒识条、操作带的排版；不写入产品代码。
 * - 账号请用临时账号，采完删除；本脚本不保存任何凭据。
 */
import { chromium } from "playwright"
import { mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"

const BASE = process.env.EVIDENCE_BASE ?? "http://localhost:5175"
const OUT = process.env.EVIDENCE_OUT ?? join(process.cwd(), ".shots", "r25-04-diag")
const CHROME =
  process.env.EVIDENCE_CHROME ??
  "C:/Users/yuwen/AppData/Local/ms-playwright/chromium-1234/chrome-win64/chrome.exe"
const USER = process.env.EVIDENCE_USER
const PASS = process.env.EVIDENCE_PASS
const IMAGE = join(process.cwd(), "public", "fundus-demo.jpg")

if (!USER || !PASS) {
  console.error("缺少 EVIDENCE_USER / EVIDENCE_PASS（用临时账号，采完删除）")
  process.exit(1)
}

mkdirSync(OUT, { recursive: true })
const settle = (ms) => new Promise((r) => setTimeout(r, ms))

/**
 * 真实判读响应的形状（不是随手编的数）。
 *
 * 字段与真实后端一致：
 * - `result` 是后端枚举的中文短名（「糖尿病」），不是记录纸上的规范名；
 * - `otherDisease` 是算法给的英文标签，且 top-1 会与 `result` 指同一类；
 * - `severity` 在活路径上永远是 `NOT_ASSESSED`（严重度由人工复核给出）；
 * - `weightSha256` / `qualityScore` / `preprocessVersion` 来自医疗安全证据链。
 *
 * 概率表因此会有多行、且混着英文标签——这正是要验证的排版：
 * 前端要自己归一到规范类名、同一类只列一遍。
 */
const RESULT = {
  id: "2120940809030631426",
  result: "糖尿病",
  probability: 91.2,
  confidence: 91.2,
  severity: "NOT_ASSESSED",
  details:
    "糖尿病视网膜病变是糖尿病的常见微血管并发症。早期表现为微血管瘤、出血点，后期可出现新生血管、玻璃体出血，严重者可导致失明。",
  recommendations:
    "严格控制血糖、血压和血脂\n定期进行眼底检查，早期发现视网膜病变\n激光光凝治疗，控制视网膜新生血管\n抗VEGF药物玻璃体内注射\n严重增殖期可能需要玻璃体视网膜手术",
  otherDisease: [
    { name: "diabetes", probability: 91.2 },
    { name: "glaucoma", probability: 5.1 },
    { name: "normal", probability: 2.3 },
  ],
  createTime: "2026-11-13 10:24:00",
  modelVersion: "efficientnet-b4-8class-v1.2",
  weightSha256:
    "a3f1c9d2e5b7a04d6c8e1f2a3b4c5d6e7f8091a2b3c4d5e6f708192a3b4c5d6",
  preprocessVersion: "preprocess-v3",
  qualityScore: 88,
  humanReviewStatus: "AI_ONLY",
  aiRejected: false,
}

const REJECTED = {
  id: "2120940809030631427",
  result: null,
  confidence: null,
  severity: null,
  aiRejected: true,
  abstainReason: "影像模糊、反光过强，无法确认视盘与黄斑区",
  createTime: "2026-11-13 10:26:00",
  modelVersion: "efficientnet-b4-8class-v1.2",
  humanReviewStatus: "PENDING_AI",
}

const errors = []
const report = []

const browser = await chromium.launch({
  headless: true,
  executablePath: CHROME,
  args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
})

async function newPage(theme, width) {
  const context = await browser.newContext({
    viewport: { width, height: width <= 390 ? 844 : 900 },
    deviceScaleFactor: 1,
  })
  await context.addInitScript((t) => localStorage.setItem("theme", t), theme)
  const response = await context.request.post(`${BASE}/api/user/login`, {
    data: { userAccount: USER, userPassword: PASS },
  })
  if (!response.ok()) throw new Error(`login failed: ${response.status()}`)
  const page = await context.newPage()
  page.on("console", (m) => m.type() === "error" && errors.push(`${theme}/${width}: ${m.text()}`))
  page.on("pageerror", (e) => errors.push(`${theme}/${width}: ${e.message}`))
  return { context, page }
}

async function gotoEmpty(page) {
  await page.goto(`${BASE}/diagnosis`, { waitUntil: "networkidle" })
  await settle(1000)
}

async function upload(page) {
  await page.setInputFiles('input[type="file"]', IMAGE)
  await page.waitForSelector('.slot[data-filled="true"]')
  await settle(400)
}

for (const theme of ["light", "dark"]) {
  {
    const { context, page } = await newPage(theme, 1440)
    await gotoEmpty(page)
    await page.screenshot({ path: join(OUT, `${theme}-empty-1440-fold.jpg`), type: "jpeg", quality: 80 })
    await page.screenshot({ path: join(OUT, `${theme}-empty-1440-full.jpg`), fullPage: true, type: "jpeg", quality: 70 })

    await upload(page)
    await page.screenshot({ path: join(OUT, `${theme}-ready-1440-fold.jpg`), type: "jpeg", quality: 80 })

    await page.route("**/api/diagnosis/diagnosis", async (route) => {
      await settle(3200)
      await route.continue()
    })
    await page.getByRole("button", { name: /开始判读/ }).click()
    await settle(900)
    await page.screenshot({ path: join(OUT, `${theme}-running-1440-fold.jpg`), type: "jpeg", quality: 80 })
    report.push({
      theme,
      state: "running",
      timer: await page.locator(".slot__timer").innerText(),
      stateText: await page.locator(".readout-head__state").innerText(),
      railStateText: await page.locator(".proc__state").innerText(),
    })

    await page.waitForSelector(".fault-note", { timeout: 20000 })
    await settle(500)
    await page.screenshot({ path: join(OUT, `${theme}-error-1440-fold.jpg`), type: "jpeg", quality: 80 })
    await context.close()
  }

  for (const [name, payload] of [
    ["done", RESULT],
    ["rejected", REJECTED],
  ]) {
    const { context, page } = await newPage(theme, 1440)
    await page.route("**/api/diagnosis/diagnosis", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ code: 0, msg: "ok", data: payload }),
      }),
    )
    await gotoEmpty(page)
    await upload(page)
    await page.getByRole("button", { name: /开始判读/ }).click()
    await page.waitForSelector(".sheet", { timeout: 20000 })
    await settle(700)
    await page.screenshot({ path: join(OUT, `${theme}-${name}-1440-fold.jpg`), type: "jpeg", quality: 80 })
    await page.screenshot({ path: join(OUT, `${theme}-${name}-1440-full.jpg`), fullPage: true, type: "jpeg", quality: 70 })
    report.push({
      theme,
      state: name,
      // 拒识态没有结论标题与概率表，读拒识提示与行数（应为 0）。
      verdict:
        name === "rejected"
          ? await page.locator(".notice__title").first().innerText()
          : await page.locator(".sheet__verdict").innerText(),
      classRows: await page.locator(".scale__row").count(),
      classNames: await page.locator(".scale__name").allInnerTexts(),
      classCodes: await page.locator(".scale__code").allInnerTexts(),
    })
    await context.close()
  }

  // 四档宽度都测横向滚动——空态与「有结果」两种版式都要测，
  // 只测空态会漏掉记录纸在窄屏撑破的情况。
  for (const width of [390, 768, 1440, 1920]) {
    for (const [name, payload] of [
      ["empty", null],
      ["done", RESULT],
    ]) {
      const { context, page } = await newPage(theme, width)
      if (payload) {
        await page.route("**/api/diagnosis/diagnosis", (route) =>
          route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({ code: 0, msg: "ok", data: payload }),
          }),
        )
      }
      await gotoEmpty(page)
      if (payload) {
        await upload(page)
        await page.getByRole("button", { name: /开始判读/ }).click()
        await page.waitForSelector(".sheet", { timeout: 20000 })
        await settle(600)
      }
      await page.screenshot({ path: join(OUT, `${theme}-${name}-${width}-fold.jpg`), type: "jpeg", quality: 80 })
      report.push({
        theme,
        width,
        state: name,
        hScroll: await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1),
      })
      await context.close()
    }
  }

  // 键盘走查：上传槽是页面第一个可聚焦控件，Tab 过去要有可见焦点；
  // 记录纸上的操作按钮同样要能被键盘走到。
  {
    const { context, page } = await newPage(theme, 1440)
    await gotoEmpty(page)
    await page.evaluate(() => document.body.focus())
    const stops = []
    for (let i = 0; i < 6; i += 1) {
      await page.keyboard.press("Tab")
      const info = await page.evaluate(() => {
        const el = document.activeElement
        if (!el || el === document.body) return null
        const style = getComputedStyle(el)
        const box = el.getBoundingClientRect()
        return {
          tag: el.tagName,
          name: (el.getAttribute("aria-label") || el.textContent || "").trim().slice(0, 24),
          outline: style.outlineStyle !== "none" && style.outlineWidth !== "0px",
          shadow: style.boxShadow !== "none",
          visible: box.width > 0 && box.height > 0,
        }
      })
      if (info) stops.push(info)
    }
    await page.screenshot({ path: join(OUT, `${theme}-keyboard-1440.jpg`), type: "jpeg", quality: 80 })
    report.push({ theme, view: "keyboard", width: 1440, stops })
    await context.close()
  }
}

await browser.close()
writeFileSync(join(OUT, "report.json"), JSON.stringify({ errors, report }, null, 2))
console.log(JSON.stringify({ errors, report }, null, 2))
if (errors.length) process.exitCode = 1
