import { defineConfig } from '@playwright/test';

// 前端级 E2E：驱动真实浏览器访问 vite dev server（5173），
// 所有 /api 请求由测试内的 page.route() 拦截返回预置 fixture，不依赖真实后端。
export default defineConfig({
  testDir: './e2e',
  // 生产构建 SW 验证用例（*.sw.spec.ts）由 playwright.sw.config.ts 单独运行
  // （vite build + vite preview），此处排除避免重复执行
  testIgnore: /.*-sw\.spec\.ts/,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? 'github' : 'list',
  timeout: 30_000,
  expect: {
    timeout: 5_000,
  },
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
        // 本地使用系统 Chrome 免下载浏览器；CI 使用 npx playwright install 的内置 chromium
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
});
