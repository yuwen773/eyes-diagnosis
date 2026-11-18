// Iris System States R2 · 真实浏览器证据采集
// 用法: node web/scripts/evidence/system-states-r2.mjs <output-dir> [phase]
// phase=before|after；合成故障用 page.route 注入，绝不冒充真实后端。
import { mkdirSync } from 'node:fs'
import { chromium } from 'playwright'

const OUT = process.argv[2] ?? 'docs/system-states-r2/evidence/after'
const PHASE = process.argv[3] ?? 'after'
const BASE = process.env.CAP_BASE ?? 'http://127.0.0.1:5201'
const CHROME = 'C:/Users/yuwen/AppData/Local/ms-playwright/chromium-1234/chrome-win64/chrome.exe'
mkdirSync(OUT, { recursive: true })

const browser = await chromium.launch({ headless: true, executablePath: process.env.E2E_CHROMIUM_PATH ?? CHROME })
const viewports = [
  { name: '375', width: 375, height: 812 },
  { name: '768', width: 768, height: 1024 },
  { name: '1024', width: 1024, height: 900 },
  { name: '1440', width: 1440, height: 900 },
  { name: '1920', width: 1920, height: 1080 },
]

async function ctx(theme, vp) {
  const c = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: 1 })
  await c.addInitScript((t) => localStorage.setItem('theme', t), theme)
  return c
}

async function routeAnon(page) {
  await page.route('**/api/user/get/login', (r) => r.fulfill({ json: { code: 0, msg: 'ok', data: null } }))
}

async function login5xx(page) {
  await routeAnon(page)
  await page.route('**/api/user/login', (r) => r.fulfill({ status: 502, contentType: 'application/json', body: JSON.stringify({ code: 502, msg: 'bad gateway' }) }))
}

async function news502(page) {
  await routeAnon(page)
  await page.route('**/api/news/list/page/vo', (r) => r.fulfill({ status: 502, contentType: 'application/json', body: JSON.stringify({ code: 502, msg: 'bad gateway' }) }))
}

async function newsEmpty(page) {
  await routeAnon(page)
  await page.route('**/api/news/list/page/vo', (r) => r.fulfill({ json: { code: 0, msg: 'ok', data: { records: [], total: 0, current: 1, size: 9, pages: 1 } } }))
}

async function shoot(name, theme, vp, setup, url, waitText) {
  const c = await ctx(theme, vp)
  const page = await c.newPage()
  await setup(page)
  await page.goto(BASE + url, { waitUntil: 'domcontentloaded' })
  if (name === 'news-cached-refresh-502') {
    await page.waitForFunction(() => document.body.innerText.includes('合成缓存条目'))
    await page.route('**/api/news/list/page/vo', (r) => r.fulfill({ status: 502, contentType: 'application/json', body: JSON.stringify({ code: 502, msg: 'bad gateway' }) }))
    // staleTime=30s：缓存过期后短暂断网再上线，TanStack Query 会在保留缓存的同时后台 refetch。
    await page.waitForTimeout(31000)
    await page.context().setOffline(true)
    await page.waitForTimeout(200)
    await page.context().setOffline(false)
  }
  if (name.startsWith('login-')) {
    await page.locator('#account, input[autocomplete="username"]').first().fill('synthetic-user')
    await page.locator('#password, input[autocomplete="current-password"]').first().fill('synthetic-pass')
    await page.locator('form.form button[type="submit"]').click()
  }
  if (waitText) await page.getByText(waitText).first().waitFor({ timeout: 15000 })
  await page.waitForTimeout(600)
  const dark = await page.evaluate(() => document.documentElement.classList.contains('dark'))
  if ((theme === 'dark') !== dark) throw new Error(`${name}: theme mismatch ${theme}/${dark}`)
  await page.screenshot({ path: `${OUT}/${name}-${theme}-${vp.name}.png` })
  console.log(`${name}-${theme}-${vp.name}`)
  await c.close()
}

// 前/后都存在的三类：登录 5xx、新闻首次 502、新闻空态。
for (const theme of ['light', 'dark']) {
  for (const vp of viewports) {
    await shoot('login-5xx', theme, vp, login5xx, '/login', '服务这会儿没有响应')
    await shoot('news-first-502', theme, vp, news502, '/news', '资讯没能读出来')
    await shoot('news-empty', theme, vp, newsEmpty, '/news', '资讯库里还没有条目')
  }
}

// 以下只在整改后存在，失败注入是合成故障，标签如实写在文件名。
if (PHASE === 'after') {
  for (const theme of ['light', 'dark']) {
    const vp = viewports.find((v) => v.name === '1440')
    await shoot('login-network', theme, vp, async (page) => {
      await routeAnon(page)
      await page.route('**/api/user/login', (r) => r.abort('internetdisconnected'))
    }, '/login', '网络')
    await shoot('news-cached-refresh-502', theme, vp, async (page) => {
      await routeAnon(page)
      let first = true
      let loaded = false
      await page.route('**/api/news/list/page/vo', (r) => {
        if (first) {
          first = false
          return r.fulfill({ json: { code: 0, msg: 'ok', data: { records: [{ id: 'synthetic-1', title: '合成缓存条目', author: '编辑部', publishTime: '2026-11-18 09:00:00', content: '<p>缓存正文</p>' }], total: 1, current: 1, size: 9, pages: 1 } } })
        }
        loaded = true
        return r.fulfill({ status: 502, contentType: 'application/json', body: JSON.stringify({ code: 502, msg: 'bad gateway' }) })
      })
    }, '/news', '内容没有刷新成功')
    await shoot('page-error', theme, vp, async (page) => {
      await page.route('**/src/pages/NewsPage.tsx*', (r) => r.fulfill({ status: 200, contentType: 'application/javascript', body: `export function NewsPage(){ throw new Error('synthetic render failure') }` }))
    }, '/news', '这个页面没能显示出来')
  }
}

await browser.close()
