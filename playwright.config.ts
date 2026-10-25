import { defineConfig } from '@playwright/test'

// 单一 E2E 配置，通过 npm 脚本名切换运行模式：
// - npm run test:e2e          → vite dev（5173），/api 由 page.route 拦截
// - npm run test:e2e:sw       → vite build + vite preview（4173），仅运行 *-sw.spec.ts
// 使用 npm_lifecycle_event（而非 process.argv）：Playwright 的 worker 进程不携带 CLI 参数，
// 但会继承 npm 注入的环境变量，确保主进程与 worker 解析到同一模式。
const isSwMode =
  process.env.npm_lifecycle_event === 'test:e2e:sw' || process.env.PW_SW === '1'

const reporter: 'github' | 'list' = process.env.CI ? 'github' : 'list'

const shared = {
  testDir: './e2e',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter,
}

export default defineConfig(
  isSwMode
    ? {
        ...shared,
        testMatch: /.*-sw\.spec\.ts/,
        timeout: 60_000,
        expect: { timeout: 10_000 },
        use: {
          baseURL: 'http://localhost:4173',
          headless: true,
          trace: 'retain-on-failure',
          actionTimeout: 10_000,
          navigationTimeout: 20_000,
        },
        projects: [
          {
            name: 'sw',
            use: {
              browserName: 'chromium',
              // 本地使用系统 Chrome 免下载浏览器；CI 使用内置 chromium
              channel: process.env.CI ? undefined : 'chrome',
            },
          },
        ],
        webServer: {
          // 构建产物验证：先 vite build（含 tsc -b）再 vite preview 提供静态服务
          command: 'npm run build && npm run preview -- --port 4173 --strictPort',
          url: 'http://localhost:4173',
          reuseExistingServer: !process.env.CI,
          timeout: 300_000,
        },
      }
    : {
        ...shared,
        testIgnore: /.*-sw\.spec\.ts/,
        timeout: 30_000,
        expect: { timeout: 5_000 },
        use: {
          baseURL: 'http://localhost:5173',
          headless: true,
          trace: 'retain-on-failure',
          actionTimeout: 10_000,
          navigationTimeout: 15_000,
        },
        projects: [
          {
            name: 'chromium',
            use: {
              browserName: 'chromium',
              channel: process.env.CI ? undefined : 'chrome',
            },
          },
        ],
        webServer: {
          command: 'npm run dev',
          url: 'http://localhost:5173',
          reuseExistingServer: !process.env.CI,
          timeout: 120_000,
        },
      }
)
