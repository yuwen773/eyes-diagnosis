/** Production-build visual evidence. Synthetic APIs; no clinical/provider acceptance. */
import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import { existsSync, readdirSync } from "node:fs"
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises"
import { dirname, join, relative, resolve } from "node:path"
import { parseArgs } from "node:util"
import { chromium, expect } from "@playwright/test"
import { build, preview } from "vite"

const { values } = parseArgs({ options: {
  sha: { type: "string" }, mode: { type: "string", default: "production" },
  out: { type: "string", default: "../target/rc-final/g5" },
  port: { type: "string", default: "45319" }, help: { type: "boolean" },
} })
if (values.help) {
  console.log("From web/: node scripts/evidence/rc-final-visual.mjs --sha <full HEAD> [--mode production|collaboration-fixture] [--port 45319] [--out ../target/rc-final/g5]")
  console.log("Builds a fresh isolated production bundle, serves it using preview, then captures stable synthetic states. No dev server or production data.")
  process.exit(0)
}
assert.match(values.sha ?? "", /^[0-9a-f]{40}$/)
assert.ok(["production", "collaboration-fixture"].includes(values.mode))
const webRoot = resolve(import.meta.dirname, "../..")
const repoRoot = dirname(webRoot)
const git = (...args) => execFileSync("git", args, { cwd: repoRoot, encoding: "utf8" }).trim()
assert.equal(git("rev-parse", "HEAD"), values.sha, "Requested source must be current HEAD")
git("diff", "--quiet", "HEAD", "--", "web/src", "web/public", "web/vite.config.ts", "web/package.json", "web/package-lock.json")
const treeSha = git("rev-parse", "HEAD^{tree}")
const fixtureMode = values.mode === "collaboration-fixture"
const outRoot = resolve(webRoot, values.out)
const out = join(outRoot, `${values.mode}-${values.sha.slice(0, 8)}-${new Date().toISOString().replace(/[:.]/g, "-")}`)
const dist = join(out, "dist")
await mkdir(out, { recursive: true })
process.env.VITE_COLLABORATION_ENABLED = fixtureMode ? "true" : "false"
delete process.env.VITE_E2E_REFRESH_HOOK
await build({ root: webRoot, mode: "production", build: { outDir: dist, emptyOutDir: false } })
const hash = bytes => createHash("sha256").update(bytes).digest("hex")
async function inventory(path) {
  const result = []
  for (const entry of await readdir(path, { withFileTypes: true })) {
    const file = join(path, entry.name)
    if (entry.isDirectory()) result.push(...await inventory(file))
    else result.push({ path: relative(dist, file).replaceAll("\\", "/"), sha256: hash(await readFile(file)) })
  }
  return result.sort((a, b) => a.path.localeCompare(b.path))
}
const files = await inventory(dist)
const distSha256 = hash(JSON.stringify(files))
const fileHashes = new Map(files.map(file => [file.path, file.sha256]))
const manifest = {
  schemaVersion: 1, sourceSha: values.sha, treeSha, mode: "production", artifactKind: values.mode,
  collaborationEnabled: fixtureMode, distSha256, dist, files, syntheticApis: true,
  productionEquivalent: false, clinicalAcceptance: "NOT_EVALUATED", capturedAt: new Date().toISOString(),
  historicalEvidence: { sourceSha: "7dc3422b70828d400ad1d3a09e8c29aa12f48309", screenshots: 72, promotedToCurrentSha: false },
  shots: [], failures: [],
}
await writeFile(join(out, "build-manifest.json"), JSON.stringify(manifest, null, 2))
const server = await preview({ root: webRoot, build: { outDir: dist }, preview: { host: "127.0.0.1", port: Number(values.port), strictPort: true } })
const base = `http://127.0.0.1:${values.port}`
// 横向溢出是真实响应式缺陷：记录后继续抓取全部场景，最后统一断言（仍会使本次运行失败）。
const overflowDefects = []
function executablePath() {
  const explicit = process.env.E2E_CHROMIUM_PATH || process.env.E2E_CHROMIUM_EXECUTABLE_PATH
  if (explicit) return explicit
  if (existsSync(chromium.executablePath())) return chromium.executablePath()
  const root = join(process.env.LOCALAPPDATA ?? "", "ms-playwright")
  if (!existsSync(root)) return undefined
  for (const dir of readdirSync(root).filter(name => /^chromium-\d+$/.test(name)).sort((a, b) => Number(b.split("-")[1]) - Number(a.split("-")[1]))) {
    const candidate = join(root, dir, "chrome-win64/chrome.exe")
    if (existsSync(candidate)) return candidate
  }
}
let browser
const user = { id: "42", userAccount: "synthetic-visual", userName: "合成验收账号", userRole: "admin" }
const row = { id: "410001", username: "合成病例", result: "cataract", severity: "mild", confidence: 0.82, createTime: "2026-11-19T00:00:00+08:00" }
const detail = { ...row, prediction: "cataract", humanReviewStatus: "PENDING_AI", modelVersion: "synthetic-v1", preprocessVersion: "synthetic-v1", inferencePolicyVersion: "synthetic-v1",
  source: { recordSource: "COLLABORATION_DRAFT", authorizationState: "APPROVED", authorizationDetailsRestricted: true, draftReviewState: "APPROVED", imageArchivalState: "MISSING", reviewerRole: "doctor" } }
const citation = { id: "doc:42", kind: "document", title: "合成干眼症资料", source: "knowledge-base", documentId: "42", score: 0.81, snippet: "合成检索片段：睑缘清洁与复查记录。", toolCallId: "visual-tool" }
const message = (id, role, subType, content) => ({ id, role, subType, content: typeof content === "string" ? content : JSON.stringify(content), createdTime: "2026-11-19T00:00:00Z", isSummary: false })
const history = [
  message("visual-u", "USER", "", "合成提问：请核对检索资料。"),
  message("visual-call", "ASSISTANT", "tool-call", { toolCallId: "visual-tool", name: "searchDocuments", arguments: "{}" }),
  message("visual-result", "ASSISTANT", "tool-result", { toolCallId: "visual-tool", name: "searchDocuments", status: "succeeded", output: citation.snippet, resources: [citation] }),
  message("visual-answer", "ASSISTANT", "", "已找到一份合成资料，仅用于界面验收。"),
]
const collaboration = JSON.parse(await readFile(join(webRoot, "src/lib/__fixtures__/collaboration.v1.json"), "utf8"))
const started = collaboration.events[2], completed = collaboration.events[3]
const facts = [collaboration.events[1], started, { ...started, actor: "EVIDENCE" }, { ...completed, actor: "EVIDENCE" }, completed,
  { ...started, actor: "EXPLANATION" }, { ...completed, actor: "EXPLANATION" }, { ...started, actor: "CRITIC" }, collaboration.events[7],
  { ...completed, actor: "CRITIC" }, collaboration.events[8], collaboration.events[9]]

async function scenario(theme, width, scene, run) {
  const context = await browser.newContext({ viewport: { width, height: 900 }, deviceScaleFactor: 1, colorScheme: theme, timezoneId: "Asia/Shanghai" })
  await context.addInitScript(({ theme, scene }) => {
    localStorage.setItem("theme", theme)
    if (scene.startsWith("agent")) localStorage.setItem("agent_current_thread_id:42", "thread-visual")
    if (scene === "collaboration") localStorage.setItem("agent_current_thread_id:42", "thread-a")
  }, { theme, scene })
  let releaseLoading
  const loadingGate = new Promise(resolve => { releaseLoading = resolve })
  await context.route("**/*", async route => {
    const url = new URL(route.request().url())
    if (url.origin !== base) return route.abort()
    if (!url.pathname.startsWith("/api/")) return route.continue()
    const path = url.pathname
    const json = data => route.fulfill({ json: { code: 0, data, msg: "" } })
    if (path === "/api/user/get/login") return json(scene === "login-error" ? null : user)
    if (path === "/api/user/login") return route.fulfill({ status: 502, json: { code: 502, msg: "synthetic gateway" } })
    if (path === "/api/news/list/page/vo") {
      if (scene === "news-loading") await loadingGate
      if (scene === "news-error") return route.fulfill({ status: 502, json: { code: 502, msg: "synthetic gateway" } })
      return json({ records: [], total: 0, current: 1, size: 9, pages: 0 })
    }
    if (path === "/api/diagnosis/list/page/vo") return json({ records: [row], total: 1, size: 10, current: 1, pages: 1 })
    if (path === "/api/diagnosis/get/410001") return json(detail)
    if (path === "/api/agent/sessions") return json([{ sessionId: scene === "collaboration" ? "thread-a" : "thread-visual", title: "合成验收会话", messageCount: scene === "agent-empty" ? 0 : 4 }])
    if (path.startsWith("/api/agent/history/")) return json({ messages: scene === "agent-resources" ? history : [], hasMore: false, nextCursor: null })
    if (path.endsWith("/events")) return route.fulfill({ contentType: "text/event-stream", body: facts.filter(event => event.visibility === "PATIENT").map((event, i) => {
      const sequence = i + 2
      return `id: visual-${sequence}\nevent: ${event.type}\ndata: ${JSON.stringify({ ...event, eventId: `run-a:${sequence}`, schemaVersion: 1, runId: "run-a", threadId: "thread-a", sequence: String(sequence), occurredAt: "2026-11-19T00:00:00Z" })}\n\n`
    }).join("") })
    if (path.endsWith("/image")) return route.fulfill({ contentType: "image/png", body: await readFile(join(webRoot, "e2e/fixtures/collaboration-synthetic.png")) })
    if (path.startsWith("/api/agent/collaboration-runs/")) return json({ ...collaboration.snapshot, executionStatus: "RUNNING", projectionVersion: "v1:patient" })
    return json(null)
  })
  const page = await context.newPage()
  const pageErrors = [], assetFailures = [], verifiedAssets = new Set(), pending = []
  page.on("pageerror", error => pageErrors.push(error.message))
  page.on("response", response => {
    const url = new URL(response.url())
    if (url.origin !== base || url.pathname.startsWith("/api/")) return
    const name = decodeURIComponent(url.pathname).replace(/^\//, "")
    if (!fileHashes.has(name)) return
    pending.push((async () => {
      if (!response.ok()) { assetFailures.push(`${name}: HTTP ${response.status()}`); return }
      assert.equal(hash(await response.body()), fileHashes.get(name), `served bytes differ: ${name}`)
      verifiedAssets.add(name)
    })().catch(error => assetFailures.push(error.message)))
  })
  const capture = async (name, selector, extra = {}) => {
    await page.locator(selector).first().waitFor({ state: "visible" })
    await page.evaluate(() => document.fonts.ready)
    await Promise.all(pending)
    const state = await page.evaluate(() => ({ width: innerWidth, height: innerHeight, dark: document.documentElement.classList.contains("dark"), overflow: document.documentElement.scrollWidth - innerWidth, devClient: !!document.querySelector("script[src='/@vite/client']") }))
    assert.equal(state.dark, theme === "dark")
    if (state.overflow > 1) overflowDefects.push({ scene, theme, width, overflow: state.overflow })
    assert.equal(state.devClient, false)
    assert.deepEqual(pageErrors, [])
    assert.deepEqual(assetFailures, [])
    assert.ok([...verifiedAssets].some(file => /^assets\/.*\.js$/.test(file)), "production JS not observed")
    const file = `${name}-${theme}-${width}.png`
    await page.screenshot({ path: join(out, file), animations: "disabled" })
    manifest.shots.push({ file, screenshotSha256: hash(await readFile(join(out, file))), sourceSha: values.sha, treeSha, distSha256,
      buildMode: "production", artifactKind: values.mode, route: new URL(page.url()).pathname, viewport: { width, height: 900 }, theme,
      stableSelector: selector, state, verifiedAssets: [...verifiedAssets].sort(), syntheticApis: true, ...extra })
    console.log(`captured ${file}`)
  }
  try { await run(page, capture, releaseLoading) }
  finally { releaseLoading(); await context.close() }
}

try {
  browser = await chromium.launch({ executablePath: executablePath(), args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] })
  manifest.chromium = browser.version()
  for (const theme of ["light", "dark"]) {
    if (fixtureMode) {
      for (const width of [390, 768, 1440]) await scenario(theme, width, "collaboration", async (page, capture) => {
        await page.goto(`${base}/agent/collaboration?runId=run-a&threadId=thread-a`)
        await expect(page.getByText("协作完成", { exact: true })).toBeVisible()
        await expect(page.locator(".collab-summary")).toContainText("待医生复核")
        await capture("collaboration-completed", ".collab-summary", { productionDefaultEnabled: false })
        const open = page.getByRole("button", { name: /^影像与证据/ })
        if (await open.count()) await open.click()
        await expect(page.getByAltText("本次提交的眼底影像")).toHaveJSProperty("naturalWidth", 640)
        await capture("collaboration-inspector", ".collab-inspector, [role='dialog']", { productionDefaultEnabled: false })
      })
      continue
    }
    for (const width of [390, 768, 1440, 1920]) await scenario(theme, width, "home", async (page, capture) => {
      await page.goto(base)
      await page.locator(".hero-fusion__prism").waitFor({ state: "visible", timeout: 60000 })
      if (width <= 900) {
        // ≤900px 顶栏导航收进 MobileNav 抽屉（shell.css max-width:900 隐藏 .product-head__nav）；
        // 入口经汉堡可达，不是消失。这里验证真实移动可发现性，而非要求桌面链接可见。
        const burger = page.locator(".product-head .burger")
        await expect(burger).toBeVisible()
        await burger.click()
        await expect(page.locator("#mobile-nav a[href='/agent']")).toBeVisible()
        await page.keyboard.press("Escape")
        await expect(burger).toBeVisible()
      } else {
        await expect(page.locator("a[href='/agent']").first()).toBeVisible()
      }
      await capture("home-e09", ".hero-fusion__prism", { hero: await page.locator(".hero-fusion__stage").getAttribute("data-breakpoint") })
      assert.equal(await page.locator("a[href='/agent/collaboration']").count(), 0, "production collaboration navigation must remain off")
    })
    for (const width of [390, 768, 1440]) {
      await scenario(theme, width, "provenance", async (page, capture) => {
        await page.goto(`${base}/admin/diagnosis`)
        await page.getByRole("button", { name: "详情", exact: true }).click()
        const dialog = page.getByRole("dialog", { name: "判读详情" })
        await dialog.getByRole("heading", { name: /PROVENANCE/ }).scrollIntoViewIfNeeded()
        await expect(dialog.getByText("患者已授权保存 · 详情按最小权限不展示", { exact: true })).toBeVisible()
        await capture("admin-provenance", "[role='dialog']", { fixture: "restricted authorization details" })
      })
      await scenario(theme, width, "agent-resources", async (page, capture) => {
        await page.goto(`${base}/agent`)
        await expect(page.getByText("已找到一份合成资料，仅用于界面验收。")).toBeVisible()
        await page.locator(".agent-iconbtn[title='资源面板']").click()
        await page.locator(".agent-panel__tab").filter({ hasText: "知识来源" }).click()
        await expect(page.locator(".agent-panel__doc")).toContainText("合成干眼症资料")
        await expect(page.locator(".agent-panel__doc")).toContainText("0.81")
        await capture("agent-resources", ".agent-panel__doc")
      })
    }
    for (const width of [390, 1440]) {
      for (const state of ["loading", "error", "empty"]) await scenario(theme, width, `news-${state}`, async (page, capture, release) => {
        await page.goto(`${base}/news`, { waitUntil: "domcontentloaded" })
        const selector = state === "loading" ? ".news-skeleton" : state === "error" ? ".iris-section-state" : ".news-empty"
        await capture(`system-news-${state}`, selector)
        release()
      })
      await scenario(theme, width, "login-error", async (page, capture) => {
        await page.goto(`${base}/login`)
        await page.locator("#account").fill("synthetic-user")
        await page.locator("#password").fill("synthetic-pass")
        await page.locator("form.form button[type='submit']").click()
        await expect(page.locator(".iris-form-alert")).toContainText("服务这会儿没有响应")
        await capture("system-login-error", ".iris-form-alert")
      })
      await scenario(theme, width, "agent-empty", async (page, capture) => {
        await page.goto(`${base}/agent`)
        await capture("agent-empty", ".prompt__input")
        await expect(page.locator(".agent-panel__doc")).toHaveCount(0)
      })
    }
  }
  manifest.overflowDefects = overflowDefects
  assert.equal(overflowDefects.length, 0, `horizontal overflow defects: ${JSON.stringify(overflowDefects)}`)
  assert.equal(git("rev-parse", "HEAD"), values.sha, "HEAD moved during evidence capture")
  git("diff", "--quiet", "HEAD", "--", "web/src", "web/public", "web/vite.config.ts", "web/package.json", "web/package-lock.json")
} catch (error) {
  manifest.failures.push(error.stack ?? String(error))
  process.exitCode = 1
} finally {
  await browser?.close()
  await new Promise((resolve, reject) => server.httpServer.close(error => error ? reject(error) : resolve()))
  manifest.finishedAt = new Date().toISOString()
  await writeFile(join(out, "manifest.json"), JSON.stringify(manifest, null, 2))
  await writeFile(join(outRoot, `${values.mode}-latest.json`), JSON.stringify({ manifest: join(out, "manifest.json"), sourceSha: values.sha, distSha256, shots: manifest.shots.length, failures: manifest.failures }, null, 2))
  console.log(JSON.stringify({ manifest: join(out, "manifest.json"), shots: manifest.shots.length, failures: manifest.failures.length }))
}
