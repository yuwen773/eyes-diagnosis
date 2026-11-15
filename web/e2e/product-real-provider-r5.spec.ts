import { randomUUID } from "node:crypto"
import { readFile, writeFile } from "node:fs/promises"
import { expect, test, type Browser, type APIRequestContext } from "@playwright/test"

// Explicit one-shot R5 experiment (authorized 2026-11-13). The separate live server owns the
// preregistered 16-request cap; this spec never retries and never reopens a started experiment.
const evidence = "../docs/testing/product-acceptance-r5"
const budget = 16
const password = "SyntheticAcceptance2026!"
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=", "base64")
const runs = "/api/agent/collaboration-runs"
type LiveLedger = { hardLimit: number; realRequests: number; requests: { id: number; state: string }[] }
async function ledger(): Promise<LiveLedger> {
  for (let i = 0; i < 30; i++) {
    try { return JSON.parse(await readFile(`${evidence}/real-provider-requests.json`, "utf8")) as LiveLedger }
    catch { await new Promise((resolve) => setTimeout(resolve, 100)) }
  }
  throw new Error("Live ledger unavailable; do not repeat the experiment")
}
async function data(request: APIRequestContext, path: string) {
  const response = await request.get(path); const value = await response.json()
  expect(response.ok() && value.code === 0).toBe(true); return value.data
}
async function actor(browser: Browser, baseURL: string | undefined, role: string) {
  const context = await browser.newContext({ baseURL, viewport: { width: 1440, height: 960 } })
  const account = `live-${role}-${randomUUID().slice(0, 8)}`
  const registered = await context.request.post("/api/user/register", { data: { userAccount: account, userPassword: password, checkPassword: password } })
  expect((await registered.json()).code).toBe(0)
  await context.request.post(`/api/test/role?account=${account}&role=${role}`)
  const login = await context.request.post("/api/user/login", { data: { userAccount: account, userPassword: password } })
  const user = (await login.json()).data; expect(typeof user.id).toBe("string")
  return { context, page: await context.newPage(), request: context.request, user }
}
test("one-shot R5 real provider: safe negatives then Graph and Coordinator, with all failures retained", async ({ browser, baseURL }) => {
  expect(process.env.PRODUCT_ACCEPTANCE_LIVE).toBe("R5_16")
  test.setTimeout(300_000)
  const patient = await actor(browser, baseURL, "user"), doctor = await actor(browser, baseURL, "doctor"), admin = await actor(browser, baseURL, "admin")
  const observations: Record<string, unknown>[] = []
  try {
    const initial = await ledger()
    expect(initial.hardLimit).toBe(budget)
    expect(initial.realRequests).toBe(0)
    for (const mode of ["OOD", "QUALITY"]) {
      await patient.request.post(`/api/test/scenario?mode=${mode}`)
      const threadId = randomUUID()
      await patient.request.post("/api/agent/sessions", { data: { sessionId: threadId } })
      const uploaded = await patient.request.post("/api/diagnosis-tasks", { multipart: { idempotencyKey: randomUUID(), file: { name: "synthetic.png", mimeType: "image/png", buffer: png } } })
      const taskId = (await uploaded.json()).data.taskId
      const created = await patient.request.post(runs, { data: { taskId, threadId, idempotencyKey: taskId } })
      const snapshot = (await created.json()).data
      expect(snapshot.executionStatus).toBe("RESTRICTED")
      expect((await ledger()).realRequests).toBe(0)
      observations.push({ cell: mode, status: snapshot.executionStatus, realRequests: 0 })
    }
    for (const runtime of ["GRAPH", "COORDINATOR"]) {
      const before = await ledger(); const started = Date.now()
      await patient.request.post("/api/test/scenario?mode=NORMAL")
      await patient.request.post("/api/test/flags", { data: { graph: runtime === "GRAPH" } })
      await patient.page.bringToFront(); await patient.page.goto("/agent"); await patient.page.waitForLoadState("networkidle")
      await patient.page.getByRole("button", { name: "影像协作", exact: true }).click()
      await patient.page.getByLabel(/选择一张 JPEG/).setInputFiles({ name: "synthetic-live.png", mimeType: "image/png", buffer: png })
      await patient.page.getByRole("button", { name: "提交影像并开始协作" }).click()
      await expect(patient.page).toHaveURL(/runId=/, { timeout: 15_000 })
      const runId = new URL(patient.page.url()).searchParams.get("runId")!
      await expect.poll(async () => (await data(patient.request, `${runs}/${runId}`)).executionStatus, { timeout: 105_000 }).toMatch(/^(SUCCEEDED|RESTRICTED|FAILED|CANCELLED)$/)
      const snapshot = await data(patient.request, `${runs}/${runId}`)
      expect(snapshot.runtimeKind).toBe(runtime)
      const row: Record<string, unknown> = { cell: runtime, runId, taskId: snapshot.taskId, status: snapshot.executionStatus,
        reviewStatus: snapshot.reviewStatus, reason: snapshot.reason, elapsedMillis: Date.now() - started,
        doctorUi: "NOT_RUN_NOT_READY", patientSaveUi: "NOT_RUN_NOT_READY" }
      observations.push(row)
      if (snapshot.executionStatus === "SUCCEEDED") {
        const assignment = await admin.request.post("/api/doctor-reviews/assign", { data: { taskId: snapshot.taskId, doctorId: doctor.user.id } })
        expect((await assignment.json()).code).toBe(0)
        await doctor.page.bringToFront(); await doctor.page.goto("/doctor-reviews"); await doctor.page.waitForLoadState("networkidle")
        await doctor.page.getByRole("button", { name: "刷新我的复核任务" }).click()
        await doctor.page.getByRole("button").filter({ hasText: snapshot.taskId }).click()
        await expect(doctor.page.getByLabel("冻结复核材料")).toBeVisible()
        await doctor.page.getByLabel("复核意见").fill("Synthetic product acceptance only; no clinical validity or real physician approval is claimed")
        await doctor.page.getByRole("button", { name: "批准当前冻结版本" }).click()
        await expect(doctor.page.getByText("该冻结版本已批准", { exact: true })).toBeVisible()
        row.doctorUi = "PASS_SYNTHETIC_ENGINEERING_DECISION"
        await patient.page.bringToFront(); await patient.page.getByRole("button", { name: "刷新复核状态" }).click()
        const panel = patient.page.getByLabel("本人获准说明与保存")
        await expect(panel).toContainText("模型预测并非确诊")
        await panel.getByRole("button", { name: "查看拟保存内容或查询回执" }).click()
        await expect(panel.getByRole("button", { name: "同意并保存" })).toBeDisabled()
        await panel.getByRole("checkbox").check(); await panel.getByRole("button", { name: "同意并保存" }).click()
        await expect(panel.getByLabel("保存回执")).toBeVisible()
        row.patientSaveUi = "PASS_SYNTHETIC_UPSTREAM_REAL_PROVIDER"
      }
      await patient.page.screenshot({ path: `${evidence}/real-${runtime.toLowerCase()}.png`, fullPage: true })
      const after = await ledger()
      row.requestIds = after.requests.filter((request) => request.id > before.realRequests).map((request) => request.id)
      row.realRequests = after.realRequests - before.realRequests
      expect(after.realRequests).toBeLessThanOrEqual(budget)
      await writeFile(`${evidence}/real-provider-observations.json`, JSON.stringify({ evidenceKind: "SYNTHETIC_UPSTREAM_REAL_PROVIDER", clinical: "NOT_EVALUATED", observations }, null, 2) + "\n")
    }
  } finally {
    await writeFile(`${evidence}/real-provider-observations.json`, JSON.stringify({ evidenceKind: "SYNTHETIC_UPSTREAM_REAL_PROVIDER", clinical: "NOT_EVALUATED", observations }, null, 2) + "\n")
    for (const who of [patient, doctor, admin]) await who.context.close()
  }
})
