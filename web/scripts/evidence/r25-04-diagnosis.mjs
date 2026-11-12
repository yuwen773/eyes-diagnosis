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
import { mkdirSync } from "node:fs"
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

const RESULT = {
  id: "2120940809030631426",
  result: "糖尿病视网膜病变",
  probability: 91.2,
  confidence: 91.2,
  severity: "severe",
  details: "影像显示后极部散在微血管瘤与点片状出血，符合糖尿病视网膜病变表现，建议结合临床分期评估。",
  recommendations:
    "建议尽快至眼科门诊进行散瞳眼底检查；控制血糖、血压与血脂；如出现视力骤降、眼前黑影增多，请立即就医。",
  createTime: "2026-11-13 10:24:00",
  modelVersion: "efficientnet-b4-8class-v1.2",
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
    await context.close()
  }

  for (const width of [390, 768, 1920]) {
    const { context, page } = await newPage(theme, width)
    await gotoEmpty(page)
    await page.screenshot({ path: join(OUT, `${theme}-empty-${width}-fold.jpg`), type: "jpeg", quality: 80 })
    report.push({
      theme,
      width,
      hScroll: await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1),
    })
    await context.close()
  }

  for (const width of [390, 768, 1920]) {
    const { context, page } = await newPage(theme, width)
    await page.route("**/api/diagnosis/diagnosis", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ code: 0, msg: "ok", data: RESULT }),
      }),
    )
    await gotoEmpty(page)
    await upload(page)
    await page.getByRole("button", { name: /开始判读/ }).click()
    await page.waitForSelector(".sheet", { timeout: 20000 })
    await settle(600)
    await page.screenshot({ path: join(OUT, `${theme}-done-${width}-fold.jpg`), type: "jpeg", quality: 80 })
    await context.close()
  }
}

await browser.close()
console.log(JSON.stringify({ errors, report }, null, 2))
if (errors.length) process.exitCode = 1
