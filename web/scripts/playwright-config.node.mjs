import { after, test } from "node:test"
import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { spawnSync } from "node:child_process"

const root = mkdtempSync(join(tmpdir(), "iris-browser-config-"))
const cached = join(root, "chromium-1", "chrome-win64", "chrome.exe")
mkdirSync(join(root, "chromium-1", "chrome-win64"), { recursive: true })
writeFileSync(cached, "fixture; never executed")
after(() => rmSync(root, { recursive: true, force: true }))

function browserPath(env = {}) {
  const result = spawnSync(
    process.execPath,
    [
      "--experimental-strip-types",
      "--input-type=module",
      "-e",
      "const {default: config} = await import(process.env.IRIS_CONFIG_URL); console.log(JSON.stringify(config.projects[0].use.launchOptions ?? config.use.launchOptions ?? null))",
    ],
    {
      encoding: "utf8",
      env: {
        ...process.env,
        CI: "",
        E2E_CHROMIUM_PATH: "",
        E2E_CHROMIUM_EXECUTABLE_PATH: "",
        PLAYWRIGHT_BROWSERS_PATH: root,
        IRIS_CONFIG_URL: new URL("../playwright.config.ts", import.meta.url)
          .href,
        ...env,
      },
    }
  )
  assert.equal(result.status, 0, result.stderr)
  return JSON.parse(result.stdout)?.executablePath
}

test("legacy explicit browser wins over a newer automatic fallback", () => {
  assert.equal(browserPath(), cached)
  const legacy = join(root, "explicit-legacy")
  assert.equal(browserPath({ E2E_CHROMIUM_EXECUTABLE_PATH: legacy }), legacy)
})

test("the primary explicit browser has priority over the legacy alias", () => {
  assert.equal(
    browserPath({
      E2E_CHROMIUM_PATH: "primary",
      E2E_CHROMIUM_EXECUTABLE_PATH: "legacy",
    }),
    "primary"
  )
})

test("CI never selects a cached revision automatically but honors explicit paths", () => {
  assert.equal(browserPath({ CI: "true" }), undefined)
  assert.equal(
    browserPath({ CI: "true", E2E_CHROMIUM_EXECUTABLE_PATH: "legacy" }),
    "legacy"
  )
})
