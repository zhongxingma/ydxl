// E2E：真实后端主链路
//
// 与 helpers.ts 的 fixture 模式不同：本 spec 不注册任何 page.route 拦截，
// 由 Playwright 配置启动真实 Express（临时 SQLite + 固定管理员）与 vite dev（/api 代理到 3001）。
// 覆盖跨层契约：登录认证 → 文章写入/读取 → 标记已读 → 历史状态合并 → 生词写入 → 复习队列。
//
// 前置（见 playwright.config.ts 的 real 模式 webServer.env）：
// - 管理员：e2e-admin / e2e-pass-12345（ADMIN_USERNAME / ADMIN_INITIAL_PASSWORD 引导创建）
// - AI 密钥清空：AI 相关步骤不参与本主链路，避免外网依赖
import { test, expect } from '@playwright/test'
import { E2E_ARTICLE } from './helpers'

const ADMIN = { username: 'e2e-admin', password: 'e2e-pass-12345' }
const REAL_ARTICLE_ID = 'real-article-1'
const REAL_WORD = 'luminous'

/** 真实后端登录（UI 表单 → /api/auth/login → 整页跳转首页） */
async function realLogin(page: import('@playwright/test').Page): Promise<string> {
  await page.goto('/login')
  await page.fill('#login-username', ADMIN.username)
  await page.fill('#login-password', ADMIN.password)
  await page.getByRole('button', { name: '登录' }).click()
  await page.waitForURL((u) => u.pathname === '/')
  const token = await page.evaluate(() => sessionStorage.getItem('ydxl-auth-token'))
  expect(token).toBeTruthy()
  return token as string
}

test.describe('真实后端主链路', () => {
  test('登录 → 阅读 → 标记已读 → 历史 → 生词本 → 复习队列', async ({ page }) => {
    test.setTimeout(90_000)
    const token = await realLogin(page)

    // 1. 真实写入共享文章（POST /api/articles → SQLite）
    const created = await page.request.post('/api/articles', {
      headers: { 'x-user-token': token },
      data: { ...E2E_ARTICLE, id: REAL_ARTICLE_ID },
    })
    expect(created.status()).toBe(201)

    // 2. 历史文章模式阅读页：GET /api/articles/:id 渲染标题与正文
    await page.goto(`/reading?articleId=${REAL_ARTICLE_ID}`)
    await expect(page.getByRole('heading', { name: E2E_ARTICLE.title })).toBeVisible()
    await expect(page.getByText(/Last summer, I camped on a mountain with my family/)).toBeVisible()

    // 3. 阅读完成：写入 readAt（共享文章 + 当前用户 user_article_states 同一事务）
    await page.getByRole('button', { name: '阅读完成' }).click()

    // 4. 阅读历史：真实列表 + 按用户合并阅读状态
    await page.goto('/history')
    await expect(page.getByRole('heading', { name: '阅读历史' })).toBeVisible()
    await expect(page.getByRole('heading', { name: E2E_ARTICLE.title })).toBeVisible()

    // 5. 生词本 UI 添加：真实 POST /api/words（私有表，服务端强制归属当前用户）
    await page.goto('/wordbook')
    await expect(page.getByRole('heading', { name: '生词本' })).toBeVisible()
    await page.getByRole('button', { name: '添加', exact: true }).click()
    await page.getByPlaceholder('请输入英文单词').fill(REAL_WORD)
    await page.getByPlaceholder('如 /əˈpleɪ/').fill('/ˈluːmɪnəs/')
    await page.getByPlaceholder('中文释义').fill('发光的，明亮的')
    await page.getByPlaceholder('包含该词的例句').fill('The luminous moon lit up the night sky.')
    await page.getByRole('button', { name: '保存', exact: true }).click()
    await expect(page.getByRole('button', { name: '保存', exact: true })).toHaveCount(0)
    await expect(page.getByText(REAL_WORD, { exact: true }).first()).toBeVisible()

    // 6. 复习队列：本地缓存 + 真实 words 记录（nextReview 到期即可进入队列）
    await page.goto('/review')
    await expect(page.getByRole('heading', { name: '单词复习' })).toBeVisible()
    await expect(page.getByText(REAL_WORD, { exact: true }).first()).toBeVisible()
  })

  test('真实后端拒绝错误密码，登录页展示统一文案', async ({ page }) => {
    test.setTimeout(60_000)
    await page.goto('/login')
    await page.fill('#login-username', ADMIN.username)
    await page.fill('#login-password', 'wrong-password')
    await page.getByRole('button', { name: '登录' }).click()

    await expect(page.getByText('用户名或密码错误')).toBeVisible()
    await expect(page).toHaveURL(/\/login$/)
  })
})
