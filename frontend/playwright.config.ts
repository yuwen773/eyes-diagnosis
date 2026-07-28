import { defineConfig, devices } from '@playwright/test'

/**
 * PR-11 E2E 门禁配置。
 *
 * 通过 VITE_API_BASE_URL=/api 让前端请求走同源相对路径，
 * 由测试内的 page.route('**\/api/**') 提供确定性的后端 mock，
 * 不依赖真实 Java 后端。
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  fullyParallel: true,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:4173',
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: 'npm run dev -- --port 4173 --strictPort',
    url: 'http://localhost:4173',
    reuseExistingServer: !process.env.CI,
    stdout: 'ignore',
    stderr: 'pipe',
    timeout: 120_000,
    env: {
      VITE_API_BASE_URL: '/api',
    },
  },
})
