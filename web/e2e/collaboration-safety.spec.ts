import { randomUUID } from "node:crypto"
import { expect, test, type APIRequestContext } from "@playwright/test"

// Real loopback Java HTTP/SSE and MySQL. Only inference, storage and model are synthetic.
test.describe.configure({ mode: "serial" })
const runs = "/api/agent/collaboration-runs"
const tasks = "/api/diagnosis-tasks"
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=", "base64")

async function body(request: APIRequestContext, path: string) {
  const response = await request.get(path)
  expect(response.ok()).toBe(true)
  return (await response.json()).data
}
async function create(request: APIRequestContext) {
  const uploaded = await request.post(tasks, {
    multipart: { idempotencyKey: randomUUID(), file: { name: "synthetic.png", mimeType: "image/png", buffer: png } },
  })
  expect((await uploaded.json()).code).toBe(0)
  const taskId = (await uploaded.json()).data.taskId as string
  const created = await request.post(runs, { data: { taskId, threadId: "thread-42", idempotencyKey: taskId } })
  expect(created.ok()).toBe(true)
  return (await created.json()).data
}
async function terminal(request: APIRequestContext, runId: string) {
  await expect.poll(async () => (await body(request, `${runs}/${runId}`)).executionStatus).toBe("SUCCEEDED")
}
async function assign(admin: APIRequestContext, doctor: APIRequestContext, taskId: string) {
  const assigned = await admin.post("/api/doctor-reviews/assign", { data: { taskId, doctorId: "44" } })
  expect((await assigned.json()).code).toBe(0)
  const id = (await assigned.json()).data.reviewId as string
  return body(doctor, `/api/doctor-reviews/${id}`)
}
function decision(detail: Record<string, unknown>, status = "APPROVED") {
  return {
    expectedTaskVersion: detail.taskVersion, expectedDraftVersion: detail.draftVersion,
    expectedEvidenceVersion: detail.evidenceVersion, expectedMaterialDigest: detail.materialDigest,
    decision: status, note: "Synthetic engineering review only",
  }
}

test("Graph: patient/doctor isolation, approved read, explicit save and immutable receipt after withdrawal", async ({ page, playwright, baseURL }) => {
  test.setTimeout(60_000)
  const admin = await playwright.request.newContext({ baseURL })
  const doctor = await playwright.request.newContext({ baseURL })
  const other = await playwright.request.newContext({ baseURL })
  try {
    await page.request.post("/api/test/session")
    await admin.post("/api/test/session?id=45")
    await doctor.post("/api/test/session?id=44")
    await other.post("/api/test/session?id=43")
    await admin.post("/api/test/restore-sources")
    await admin.post("/api/test/flags", { data: { graph: true, admission: true, patient: true, clinician: true } })
    await page.request.post("/api/test/release")
    const run = await create(page.request)
    await terminal(page.request, run.runId)
    expect((await body(page.request, `${runs}/${run.runId}`)).runtimeKind).toBe("GRAPH")
    await page.goto(`/agent?runId=${run.runId}&threadId=thread-42`)
    await page.waitForLoadState("networkidle")
    await expect(page.locator(".collab-summary")).toContainText("待医生复核")
    await expect(page.locator("body")).not.toContainText("Synthetic private clinical draft")
    await expect(page.getByText("查看交接元数据")).toHaveCount(0)
    const pending = await body(page.request, `${tasks}/${run.taskId}/explanation`)
    expect(pending.result).toBeNull()
    expect((await page.request.get(`${tasks}/${run.taskId}/save-authorization`)).status()).toBe(409)
    const patientSnapshot = await body(page.request, `${runs}/${run.runId}`)
    for (const path of [`${runs}/${run.runId}`, `${runs}/${run.runId}/events?cursor=${patientSnapshot.resumeCursor}`]) {
      const denied = await other.get(path)
      expect(denied.status()).toBe(403)
      expect((await denied.text())).not.toContain(run.taskId)
    }
    expect((await other.post(`${runs}/${run.runId}/cancel`)).status()).toBe(403)
    expect((await doctor.get(`${runs}/${run.runId}`)).status()).toBe(403)
    const detail = await assign(admin, doctor, run.taskId)
    expect(JSON.stringify(detail.materials)).toContain("Synthetic private clinical draft")
    expect((await body(doctor, `${runs}/${run.runId}`)).projectionVersion).toContain("v1:doctor:")
    expect((await doctor.post(`${runs}/${run.runId}/cancel`)).status()).toBe(403)
    for (const actor of [page.request, admin, other]) {
      const forbidden = await actor.get(`/api/doctor-reviews/${detail.reviewId}`)
      expect((await forbidden.json()).code).toBe(40101)
    }
    const approved = await doctor.post(`/api/doctor-reviews/${detail.reviewId}/decision`, { data: decision(detail) })
    expect((await approved.json()).data.status).toBe("APPROVED")
    const released = await body(page.request, `${tasks}/${run.taskId}/explanation`)
    expect(released.status).toBe("AVAILABLE")
    expect(JSON.stringify(released)).not.toContain("agentMessages")
    const beforeSave = await body(admin, `${runs}/operations`)
    expect(beforeSave.runs.every((entry: Record<string, unknown>) => !entry.taskId && !entry.ownerUserId)).toBe(true)
    const offer = await body(page.request, `${tasks}/${run.taskId}/save-authorization`)
    expect(offer.status).toBe("OFFERED")
    const approval = { authorizationId: offer.authorizationId, expectedTaskVersion: offer.taskVersion,
      expectedDraftVersion: offer.draftVersion, expectedEvidenceVersion: offer.evidenceVersion, expectedContentDigest: offer.contentDigest }
    const saved = await page.request.post(`${tasks}/${run.taskId}/save-authorization/approve`, { data: approval })
    const receipt = (await saved.json()).data.receipt
    expect(receipt.receiptId).toBeTruthy()
    const repeated = await page.request.post(`${tasks}/${run.taskId}/save-authorization/approve`, { data: approval })
    expect((await repeated.json()).data.receipt).toEqual(receipt)
    expect((await other.get(`${tasks}/${run.taskId}/save-authorization`)).status()).toBe(200)
    expect((await (await other.get(`${tasks}/${run.taskId}/save-authorization`)).json()).code).toBe(40400)
    await page.getByRole("button", { name: "刷新复核状态" }).click()
    await expect(page.locator(".collab-summary")).toContainText("该版本已获医生批准")
    await page.screenshot({ path: "../docs/testing/realtime-safety-release-20261111/approved-metadata.png" })
    const counts = await body(page.request, "/api/test/counts")
    await admin.post("/api/test/withdraw-sources")
    expect((await body(page.request, `${tasks}/${run.taskId}/explanation`)).result).toBeNull()
    expect((await body(page.request, `${tasks}/${run.taskId}/save-authorization`)).receipt).toEqual(receipt)
    expect((await body(page.request, "/api/test/counts")).calls).toBe(counts.calls)
  } finally { await admin.dispose(); await doctor.dispose(); await other.dispose() }
})

test("rollout: stop admissions and patient display while active Graph finishes under its original runtime", async ({ page, playwright, baseURL }) => {
  const admin = await playwright.request.newContext({ baseURL })
  try {
    await admin.post("/api/test/session?id=45")
    await page.request.post("/api/test/session")
    await admin.post("/api/test/restore-sources")
    await admin.post("/api/test/flags", { data: { graph: true, admission: true, patient: true, clinician: true } })
    await page.request.post("/api/test/hold")
    const run = await create(page.request)
    await page.goto(`/agent?runId=${run.runId}&threadId=thread-42`)
    await expect(page.getByText("正在协作", { exact: true })).toBeVisible()
    await admin.post("/api/test/flags", { data: { graph: false, admission: false, patient: false, clinician: false } })
    await expect(page.getByText("当前无权查看此任务")).toBeVisible({ timeout: 10000 })
    await expect(page.getByLabel("协作角色状态")).toHaveCount(0)
    const status = await body(admin, `${runs}/operations`)
    expect(status.admissionEnabled).toBe(false)
    expect(status.patientProgressEnabled).toBe(false)
    expect((await page.request.get(`${runs}/operations`)).status()).toBe(403)
    await page.request.post("/api/test/release")
    await admin.post("/api/test/flags", { data: { patient: true, clinician: true } })
    await terminal(page.request, run.runId)
    expect((await body(page.request, `${runs}/${run.runId}`)).runtimeKind).toBe("GRAPH")
    await page.getByRole("button", { name: "重新核对状态" }).click()
    await expect(page.locator(".collab-summary")).toContainText("待医生复核")
    // Admission alone remains off; the old idempotency key still replays without work.
    const old = await page.request.post(runs, { data: { taskId: run.taskId, threadId: "thread-42", idempotencyKey: run.taskId } })
    expect((await old.json()).data.runId).toBe(run.runId)
    await page.screenshot({ path: "../docs/testing/realtime-safety-release-20261111/drained-graph.png" })
  } finally { await admin.dispose() }
})

test("Coordinator: doctor rejection blocks patient publication and saving", async ({ page, playwright, baseURL }) => {
  const admin = await playwright.request.newContext({ baseURL })
  const doctor = await playwright.request.newContext({ baseURL })
  try {
    await page.request.post("/api/test/session")
    await admin.post("/api/test/session?id=45")
    await doctor.post("/api/test/session?id=44")
    await admin.post("/api/test/flags", { data: { graph: false, admission: true, patient: true, clinician: true } })
    await page.request.post("/api/test/release")
    const run = await create(page.request); await terminal(page.request, run.runId)
    expect((await body(page.request, `${runs}/${run.runId}`)).runtimeKind).toBe("COORDINATOR")
    const detail = await assign(admin, doctor, run.taskId)
    const rejected = await doctor.post(`/api/doctor-reviews/${detail.reviewId}/decision`, { data: decision(detail, "REJECTED") })
    expect((await rejected.json()).data.status).toBe("REJECTED")
    expect((await body(page.request, `${tasks}/${run.taskId}/explanation`)).result).toBeNull()
    expect((await page.request.get(`${tasks}/${run.taskId}/save-authorization`)).status()).toBe(409)
    await page.goto(`/agent?runId=${run.runId}&threadId=thread-42`)
    await expect(page.locator(".collab-summary")).toContainText("医生复核未通过")
    await expect(page.locator("body")).not.toContainText("Synthetic private clinical draft")
  } finally { await admin.dispose(); await doctor.dispose() }
})

test("source withdrawal before doctor decision invalidates frozen review without changing execution history", async ({ page, playwright, baseURL }) => {
  const admin = await playwright.request.newContext({ baseURL })
  const doctor = await playwright.request.newContext({ baseURL })
  try {
    await page.request.post("/api/test/session")
    await admin.post("/api/test/session?id=45")
    await doctor.post("/api/test/session?id=44")
    await admin.post("/api/test/restore-sources")
    await admin.post("/api/test/flags", { data: { graph: true, admission: true, patient: true, clinician: true } })
    await page.request.post("/api/test/release")
    const run = await create(page.request); await terminal(page.request, run.runId)
    const detail = await assign(admin, doctor, run.taskId)
    const counts = await body(page.request, "/api/test/counts")
    await admin.post("/api/test/withdraw-sources")
    const refused = await doctor.post(`/api/doctor-reviews/${detail.reviewId}/decision`, { data: decision(detail) })
    expect(refused.status()).toBe(409)
    const snapshot = await body(page.request, `${runs}/${run.runId}`)
    expect(snapshot.executionStatus).toBe("SUCCEEDED")
    expect(snapshot.reviewStatus).toBe("INVALIDATED")
    expect((await body(page.request, `${tasks}/${run.taskId}/explanation`)).result).toBeNull()
    expect((await page.request.get(`${tasks}/${run.taskId}/save-authorization`)).status()).toBe(409)
    expect((await body(page.request, "/api/test/counts")).calls).toBe(counts.calls)
  } finally { await admin.dispose(); await doctor.dispose() }
})
