import { existsSync, readdirSync } from "node:fs"
import { join } from "node:path"
import { chromium, defineConfig, devices } from "@playwright/test"

/**
 * 验收冒烟。后端不在这里起：登录、判读、Agent 都需要 :8081 + MySQL + Redis
 * + 算法服务，起法与账密见 e2e/README.md。
 */

/**
 * 浏览器可执行文件，三级回落：
 *   1. `E2E_CHROMIUM_PATH` —— 显式指定，永远优先；
 *   2. Playwright 自己期望的那一版 —— 装好了就不传 `executablePath`，走默认；
 *   3. 本机 `ms-playwright` 目录里**修订号最新**的一份主浏览器二进制。
 *
 * 第 3 级是为了本机这种「包要 1254、只装了 1234、headless shell 还没装」的情况：
 * 以前要人记住路径再传环境变量，现在直接可用。
 *
 * **第 3 级只在本地生效**（`CI` 环境变量存在时跳过）。CI 的标准环境是
 * `npx playwright install --with-deps chromium` 装与 `@playwright/test` 版本匹配的那一版；
 * 抓一个别的修订号来跑等于换浏览器测，结果不可比，也不该被当成门禁。
 */
function resolveChromium(): string | undefined {
  if (process.env.E2E_CHROMIUM_PATH) return process.env.E2E_CHROMIUM_PATH

  try {
    const expected = chromium.executablePath()
    if (expected && existsSync(expected)) return undefined
  } catch {
    // 没装任何浏览器时 executablePath() 会抛，继续往下找。
  }

  // 第 3 级是本地兼容兜底，不是 CI 标准环境。
  if (process.env.CI) return undefined

  const root =
    process.env.PLAYWRIGHT_BROWSERS_PATH ??
    (process.platform === "win32"
      ? join(process.env.LOCALAPPDATA ?? "", "ms-playwright")
      : process.platform === "darwin"
        ? join(process.env.HOME ?? "", "Library/Caches/ms-playwright")
        : join(process.env.HOME ?? "", ".cache/ms-playwright"))
  if (!root || !existsSync(root)) return undefined

  // 主浏览器目录名形如 chromium-1234；headless shell 是另一个前缀，这里不取。
  const revisions = readdirSync(root)
    .map((name) => name.match(/^chromium-(\d+)$/))
    .filter((m): m is RegExpMatchArray => m != null)
    .map((m) => ({ name: m[0], rev: Number(m[1]) }))
    .sort((a, b) => b.rev - a.rev)

  const layouts = [
    join("chrome-win64", "chrome.exe"),
    join("chrome-mac", "Chromium.app", "Contents", "MacOS", "Chromium"),
    join("chrome-linux", "chrome"),
  ]
  for (const { name } of revisions) {
    for (const layout of layouts) {
      const candidate = join(root, name, layout)
      if (existsSync(candidate)) return candidate
    }
  }
  return undefined
}

const executablePath = resolveChromium()

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  retries: 0,
  reporter: "list",
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:5173",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        ...(executablePath ? { launchOptions: { executablePath } } : {}),
      },
    },
  ],
})
