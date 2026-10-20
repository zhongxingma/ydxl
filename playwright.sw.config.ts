import { defineConfig } from '@playwright/test';

// 生产构建 SW 离线验证配置：vite build + vite preview（4173），
// 验证 Workbox 预缓存真实生效（dev 模式不生成 SW，普通 E2E 覆盖不到该路径）。
// 仅运行 *.sw.spec.ts；普通 dev 配置（playwright.config.ts）已通过 testIgnore 排除本类文件。
export default defineConfig({
  testDir: './e2e',
  testMatch: /.*-sw\.spec\.ts/,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? 'github' : 'list',
  timeout: 60_000,
  expect: {
    timeout: 10_000,
  },
  use: {
    baseURL: 'http://localhost:4173',
    headless: true,
    trace: 'retain-on-failure',
    actionTimeout: 10_000,
    navigationTimeout: 20_000,
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
    // 构建产物验证：先 vite build（含 tsc -b）再 vite preview 提供静态服务
    command: 'npm run build && npm run preview -- --port 4173 --strictPort',
    url: 'http://localhost:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 300_000,
  },
});
