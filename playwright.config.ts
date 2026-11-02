import { defineConfig } from '@playwright/test'
import { rmSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

// 单一 E2E 配置，通过 npm 脚本名切换运行模式：
// - npm run test:e2e          → vite dev（5173），/api 由 page.route 拦截
// - npm run test:e2e:sw       → vite build + vite preview（4173），仅运行 *-sw.spec.ts
// - npm run test:e2e:real     → 真实 Express + SQLite（3001）+ vite dev（5173），仅运行 real-backend.spec.ts
// 使用 npm_lifecycle_event（而非 process.argv）：Playwright 的 worker 进程不携带 CLI 参数，
// 但会继承 npm 注入的环境变量，确保主进程与 worker 解析到同一模式。
const rootDir = dirname(fileURLToPath(import.meta.url))
const isSwMode =
  process.env.npm_lifecycle_event === 'test:e2e:sw' || process.env.PW_SW === '1'
const isRealMode =
  process.env.npm_lifecycle_event === 'test:e2e:real' || process.env.PW_REAL === '1'

// 真实后端模式：每次运行使用独立的临时 SQLite 文件，启动前清理旧库与 WAL 残留
// 仅在主进程清理（worker 会重复加载配置，此时服务已持有文件锁，删除会 EBUSY）
const realDbPath = resolve(rootDir, '.e2e-tmp', 'real-backend.db')
if (isRealMode && !process.env.TEST_WORKER_INDEX) {
  for (const suffix of ['', '-wal', '-shm']) {
    try {
      rmSync(`${realDbPath}${suffix}`, { force: true })
    } catch {
      // 上次异常退出残留的锁文件：交由服务启动时复用/覆盖，不阻断本次运行
    }
  }
}

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
  isRealMode
    ? {
        ...shared,
        testMatch: /real-backend\.spec\.ts/,
        timeout: 90_000,
        expect: { timeout: 10_000 },
        use: {
          baseURL: 'http://localhost:5173',
          headless: true,
          trace: 'retain-on-failure',
          actionTimeout: 10_000,
          navigationTimeout: 20_000,
        },
        projects: [
          {
            name: 'real-backend',
            use: {
              browserName: 'chromium',
              channel: process.env.CI ? undefined : 'chrome',
            },
          },
        ],
        // 双服务：真实 Express（临时 SQLite + 固定管理员）+ vite dev（/api 代理到 3001）
        webServer: [
          {
            command: 'npm --prefix server run dev',
            url: 'http://localhost:3001/api/health',
            reuseExistingServer: false,
            timeout: 120_000,
            env: {
              PORT: '3001',
              DB_PATH: realDbPath,
              ADMIN_USERNAME: 'e2e-admin',
              ADMIN_INITIAL_PASSWORD: 'e2e-pass-12345',
              NODE_ENV: 'development',
              // E2E 单浏览器高频访问同一出口 IP：调高全局限流与登录限流，避免测试自身触发 429
              RATE_LIMIT_MAX: '1000',
              LOGIN_RATE_LIMIT_MAX: '100',
              // E2E 不依赖真实 AI：清空密钥使代理返回 503，前端走本地/兜底路径
              DEEPSEEK_API_KEY: '',
              OPENAI_API_KEY: '',
              QWEN_API_KEY: '',
              CUSTOM_API_KEY: '',
            },
          },
          {
            command: 'npm run dev',
            url: 'http://localhost:5173',
            reuseExistingServer: false,
            timeout: 120_000,
          },
        ],
      }
    : isSwMode
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
          testIgnore: [/.*-sw\.spec\.ts/, /real-backend\.spec\.ts/],
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
