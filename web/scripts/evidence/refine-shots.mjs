// 验收截图脚本：Account Menu + Agent Session 交互精修。
// 用法：node scripts/evidence/refine-shots.mjs
// 依赖：web/ 下已 npm install（playwright 从 web/ 解析）；dev server 在 5182。
import { chromium } from "playwright"
import { mkdirSync } from "node:fs"
import { resolve } from "node:path"

const BASE = "http://127.0.0.1:5182"
// import.meta.dirname = web/scripts/evidence；../../.shots-refine 才到 web/.shots-refine
const OUT = resolve(import.meta.dirname, "../../.shots-refine")
mkdirSync(OUT, { recursive: true })

const CHROME =
  "C:/Users/yuwen/AppData/Local/ms-playwright/chromium-1234/chrome-win64/chrome.exe"

const browser = await chromium.launch({
  executablePath: CHROME,
  headless: true,
  args: ["--use-angle=swiftshader"],
})

const settle = async (page, ms = 700) => {
  await page.waitForLoadState("load")
  await page.waitForTimeout(ms)
}

async function login(page, account) {
  await page.goto(`${BASE}/login`)
  await settle(page, 400)
  await page.fill('input[type="text"], input[name="userAccount"], #userAccount', account).catch(async () => {
    // 登录页字段选择器兜底：按占位符找
    const inputs = page.locator("input")
    await inputs.first().fill(account)
  })
  await page.fill('input[type="password"]', "Refine123456")
  await page.keyboard.press("Enter")
  await page.waitForTimeout(1200)
}

async function setTheme(page, theme) {
  await page.evaluate((t) => {
    document.documentElement.classList.toggle("dark", t === "dark")
    localStorage.setItem("theme", t)
  }, theme)
  await page.waitForTimeout(250)
}

async function shot(page, name) {
  await page.screenshot({ path: `${OUT}/${name}.png` })
  console.log("shot:", name)
}

const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
const page = await context.newPage()

/* ── 普通用户 refineu1 ─────────────────────────────── */
await login(page, "refineu1")
await page.goto(`${BASE}/agent`)
await settle(page, 1200)

// Account menu：light / dark（普通用户）
await setTheme(page, "light")
await page.click(".acct__trigger")
await page.waitForTimeout(400)
await shot(page, "acct-user-light")
await setTheme(page, "dark")
await page.waitForTimeout(400)
await shot(page, "acct-user-dark")
await page.keyboard.press("Escape")
await page.waitForTimeout(300)

// 会话列表 + 操作菜单 light/dark
await setTheme(page, "light")
await page.waitForTimeout(300)
await shot(page, "sessions-light")
const firstMenuBtn = page.locator(".agent-session__menu-btn").first()
await firstMenuBtn.click()
await page.waitForTimeout(400)
await shot(page, "session-menu-light")
await setTheme(page, "dark")
await page.waitForTimeout(400)
await shot(page, "session-menu-dark")
await page.keyboard.press("Escape")
await page.waitForTimeout(300)

// 重命名编辑态
await setTheme(page, "light")
await firstMenuBtn.click()
await page.waitForTimeout(300)
await page.getByRole("menuitem", { name: /重命名/ }).click()
await page.waitForTimeout(300)
await shot(page, "rename-editing")
await page.keyboard.press("Escape")
await page.waitForTimeout(200)

// 单条删除确认
await firstMenuBtn.click()
await page.waitForTimeout(300)
await page.getByRole("menuitem", { name: /^删除/ }).click()
await page.waitForTimeout(400)
await shot(page, "delete-confirm")
// 取消，别真删（保留证据场景）
await page.getByRole("button", { name: "取消" }).click()
await page.waitForTimeout(300)

// 批量选择 + 删除确认
await page.getByRole("button", { name: "选择", exact: true }).click()
await page.waitForTimeout(200)
const boxes = page.locator(".agent-session__checkline input[type=checkbox]")
await boxes.nth(0).check()
await boxes.nth(1).check()
await page.waitForTimeout(200)
await shot(page, "batch-selected")
await page.getByRole("button", { name: /^删除$/ }).click()
await page.waitForTimeout(400)
await shot(page, "batch-confirm")
await page.getByRole("button", { name: "取消" }).click()
await page.waitForTimeout(200)
await page.getByRole("button", { name: "取消", exact: true }).click()

/* ── 管理员 refinea1 ─────────────────────────────── */
// 换账号：先退出
await page.click(".acct__trigger")
await page.waitForTimeout(300)
await page.getByRole("menuitem", { name: /退出登录/ }).click()
await page.waitForTimeout(800)

await login(page, "refinea1")
await page.goto(`${BASE}/agent`)
await settle(page, 1000)
await setTheme(page, "light")
await page.click(".acct__trigger")
await page.waitForTimeout(400)
await shot(page, "acct-admin-light")
await setTheme(page, "dark")
await page.waitForTimeout(400)
await shot(page, "acct-admin-dark")
await page.keyboard.press("Escape")

/* ── 390px 移动端 ─────────────────────────────── */
const mob = await browser.newContext({ viewport: { width: 390, height: 844 } })
const mpage = await mob.newPage()
await login(mpage, "refineu1")
await mpage.goto(`${BASE}/agent`)
await settle(mpage, 1000)
await setTheme(mpage, "light")
await mpage.waitForTimeout(300)
await shot(mpage, "mobile-agent-390")
// 展开会话栏
const expand = mpage.getByRole("button", { name: "展开会话栏" })
if (await expand.count()) {
  await expand.click()
  await mpage.waitForTimeout(400)
  await shot(mpage, "mobile-sessions-390")
  const mbtn = mpage.locator(".agent-session__menu-btn").first()
  if (await mbtn.count()) {
    await mbtn.click()
    await mpage.waitForTimeout(400)
    await shot(mpage, "mobile-session-menu-390")
  }
}

await browser.close()
console.log("done →", OUT)
