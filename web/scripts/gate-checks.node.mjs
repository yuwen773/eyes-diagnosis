import { after, test } from "node:test"
import assert from "node:assert/strict"
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { spawnSync } from "node:child_process"

const source = dirname(fileURLToPath(import.meta.url))
const roots = []
after(() =>
  roots.forEach((root) => rmSync(root, { recursive: true, force: true }))
)

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "iris-gates-"))
  roots.push(root)
  for (const folder of [
    "web/e2e",
    "web/scripts/e2e",
    "web/scripts/evidence",
    "report/after",
    "report/acceptance",
  ]) {
    mkdirSync(join(root, folder), { recursive: true })
  }
  for (const script of ["e2e/check-fixme.mjs", "evidence/check-report.mjs"]) {
    copyFileSync(join(source, script), join(root, "web/scripts", script))
  }
  assert.equal(spawnSync("git", ["init", "--quiet"], { cwd: root }).status, 0)
  const write = (path, data) =>
    writeFileSync(
      join(root, path),
      typeof data === "string" ? data : JSON.stringify(data)
    )
  const run = (script, ...args) =>
    spawnSync(process.execPath, [join(root, "web/scripts", script), ...args], {
      cwd: root,
      encoding: "utf8",
    })
  return { write, run }
}

test("fixme registration requires a nonempty reason and remains strict at zero budget", () => {
  const { write, run } = fixture()
  write("web/e2e/smoke.spec.ts", 'test.fixme("known", async () => {})')
  const entry = {
    file: "e2e/smoke.spec.ts",
    title: "known",
    issue: 81,
    reason: "controlled fixture pending",
  }
  write("web/e2e/fixme-budget.json", { max: 1, entries: [entry] })
  assert.equal(run("e2e/check-fixme.mjs").status, 0)
  for (const reason of [undefined, "", "  "]) {
    write("web/e2e/fixme-budget.json", {
      max: 1,
      entries: [{ ...entry, reason }],
    })
    assert.equal(run("e2e/check-fixme.mjs").status, 1)
  }
  write("web/e2e/fixme-budget.json", { max: 0, entries: [] })
  assert.equal(run("e2e/check-fixme.mjs").status, 1)
  write("web/e2e/smoke.spec.ts", 'test("repaired", async () => {})')
  assert.equal(run("e2e/check-fixme.mjs").status, 0)
})

test("malformed image counts fail; non-image evidence remains exempt", () => {
  const { write, run } = fixture()
  write("report/README.md", "| `after/` | 共 **错误 张** |")
  assert.equal(run("evidence/check-report.mjs", "--dir", "report").status, 1)
  write(
    "report/README.md",
    "| `after/` | 共 **0 张** |\n| `acceptance/` | JSON |"
  )
  assert.equal(run("evidence/check-report.mjs", "--dir", "report").status, 0)
})

test("SHA exceptions require valid hexadecimal references and a nonempty reason", () => {
  const { write, run } = fixture()
  write("report/README.md", "External reference `deadbee`.")
  assert.equal(run("evidence/check-report.mjs", "--dir", "report").status, 1)
  for (const entry of [
    { sha: "deadbee" },
    { sha: "deadbee", reason: "  " },
    { sha: "not-a-sha", reason: "external" },
    null,
  ]) {
    write("report/sha-allowlist.json", { entries: [entry] })
    assert.equal(run("evidence/check-report.mjs", "--dir", "report").status, 1)
  }
  write("report/sha-allowlist.json", {
    entries: [{ sha: "deadbee", reason: "documented external history" }],
  })
  assert.equal(run("evidence/check-report.mjs", "--dir", "report").status, 0)
})
