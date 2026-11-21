/**
 * R2.5-06 个人中心 / 判读记录 · 视觉证据采集（可复跑）
 *
 * 用法（先在 web/ 下起 vite，再另开一个终端）：
 *
 *   EVIDENCE_USER=<测试账号> EVIDENCE_PASS=<密码> \
 *   node scripts/evidence/r25-06-profile-records.mjs
 *
 * 可选：EVIDENCE_BASE（默认 http://localhost:5175）、EVIDENCE_OUT（默认 .shots/r25-06-profile）、
 *       EVIDENCE_CHROME（默认本机 Playwright Chromium 路径）。
 *
 * 说明：
 * - 全部走真实后端与真实交互：读数卡口径、台账行、展开后的记录纸、
 *   复诊申请按钮都是真数据；未登录态另起一个不带会话的上下文采集。
 * - 账号需要有判读记录才能截到台账与记录纸（空账本会截到空态，脚本会在
 *   report.json 里记下条数，展开态随之跳过）。
 * - 账号请用临时账号，采完删除；本脚本不保存任何凭据。
 */
import { chromium } from "playwright"
import { mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"

const BASE = process.env.EVIDENCE_BASE ?? "http://localhost:5175"
const OUT = process.env.EVIDENCE_OUT ?? join(process.cwd(), ".shots", "r25-06-profile")
const CHROME =
  process.env.EVIDENCE_CHROME ??
  "C:/Users/yuwen/AppData/Local/ms-playwright/chromium-1234/chrome-win64/chrome.exe"
const USER = process.env.EVIDENCE_USER
const PASS = process.env.EVIDENCE_PASS

if (!USER || !PASS) {
  console.error("缺少 EVIDENCE_USER / EVIDENCE_PASS（用临时账号，采完删除）")
  process.exit(1)
}

mkdirSync(OUT, { recursive: true })
const settle = (ms) => new Promise((r) => setTimeout(r, ms))

const errors = []
const report = []

const browser = await chromium.launch({
  headless: true,
  executablePath: CHROME,
  args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
})

async function newPage(theme, width, { login = true } = {}) {
  const context = await browser.newContext({
    viewport: {
      width,
      height: width <= 430 ? 844 : width <= 820 ? 1024 : width >= 1920 ? 1080 : 900,
    },
    deviceScaleFactor: 1,
  })
  await context.addInitScript((t) => localStorage.setItem("theme", t), theme)
  if (login) {
    const response = await context.request.post(`${BASE}/api/user/login`, {
      data: { userAccount: USER, userPassword: PASS },
    })
    if (!response.ok()) throw new Error(`login failed: ${response.status()}`)
  }
  const page = await context.newPage()
  const tag = `${theme}/${width}${login ? "" : "/anon"}`
  page.on("console", (m) => m.type() === "error" && errors.push(`${tag}: ${m.text()}`))
  page.on("pageerror", (e) => errors.push(`${tag}: ${e.message}`))
  return { context, page }
}

async function shot(page, name, options = {}) {
  await page.screenshot({ path: join(OUT, `${name}.jpg`), type: "jpeg", quality: 80, ...options })
}

for (const theme of ["light", "dark"]) {
  for (const width of [390, 768, 1440, 1920]) {
    const { context, page } = await newPage(theme, width)
    for (const route of ["profile", "records"]) {
      await page.goto(`${BASE}/${route}`, { waitUntil: "networkidle" })
      await settle(1200)
      await shot(page, `${theme}-${route}-${width}-fold`)
      if (width === 390) {
        await shot(page, `${theme}-${route}-${width}-full`, { fullPage: true, quality: 70 })
      }
      report.push({
        theme,
        width,
        route,
        hScroll: await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1),
      })
    }
    await context.close()
  }

  // 展开一条记录：真实详情接口 + 真实记录纸 + 复诊申请按钮
  {
    const { context, page } = await newPage(theme, 1440)
    await page.goto(`${BASE}/records`, { waitUntil: "networkidle" })
    await settle(1200)
    const rows = await page.locator(".records__row").count()
    if (rows > 0) {
      await page.locator(".records__row").first().click()
      await page.waitForSelector(".sheet", { timeout: 15000 })
      await settle(700)
      await shot(page, `${theme}-records-expanded-1440`, { fullPage: true, quality: 72 })
    }
    report.push({ theme, view: "records-expanded", rows, expanded: rows > 0 })
    await context.close()
  }

  // 个人中心：输入框键盘焦点
  {
    const { context, page } = await newPage(theme, 1440)
    await page.goto(`${BASE}/profile`, { waitUntil: "networkidle" })
    await settle(1200)
    await page.focus(".profile__input")
    await settle(300)
    const box = await page.locator(".profile__card").last().boundingBox()
    if (box) {
      await shot(page, `${theme}-profile-focus-1440`, {
        clip: { x: 0, y: Math.max(0, box.y - 20), width: 1440, height: Math.min(520, box.height + 40) },
      })
    }
    report.push({ theme, view: "profile-focus" })
    await context.close()
  }

  // 未登录态：两个页面都应是登录入口，不发个人请求
  {
    const { context, page } = await newPage(theme, 1440, { login: false })
    for (const route of ["profile", "records"]) {
      await page.goto(`${BASE}/${route}`, { waitUntil: "networkidle" })
      await settle(900)
      await shot(page, `${theme}-${route}-anon-1440`)
    }
    await context.close()
  }
}

await browser.close()
writeFileSync(join(OUT, "report.json"), JSON.stringify({ errors, report }, null, 2))
console.log(JSON.stringify({ errors, report }, null, 2))
if (errors.length) process.exitCode = 1
