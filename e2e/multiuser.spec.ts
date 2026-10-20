// E2E：多用户切换路径
// fixture 按登录用户名派生用户 id（u-<username>），驱动 authService 的「缓存归属检查」：
// 登录时 localStorage 的 cache-owner 与新用户 id 不一致即清空本地 Dexie 业务表。
//
// 三个场景：
// 1. 登出：退出按钮 → 服务端会话吊销（best-effort）+ 本地清理 → 跳转登录页；
//    再访问受保护路由被 RequireAuth 拦回登录页；
// 2. 换账号登录清空上一账号的本地缓存；
// 3. 同账号重复登录保留本地缓存。
//
// 说明：登出本身也会清空本地业务缓存，因此场景 2/3 特意绕过登出按钮，用
// sessionStorage.clear() 模拟「会话丢失但未登出」（localStorage cache-owner 保留），
// 精确隔离「账号切换检测」本身的行为——这也是cache-owner 机制要防的真实场景。
// 历史断言面：直接 seed 带 readAt 的文章进 Dexie（getReadHistory 按 readAt/startedAt 过滤）。
import { test, expect } from '@playwright/test'
import {
  setupApiFixtures,
  login,
  seedIndexedDB,
  E2E_ARTICLE,
} from './helpers'

// 历史页空态文案
const HISTORY_EMPTY_TEXT = '暂无阅读记录，开始你的第一篇阅读吧'

// 预置「已读完」文章：readAt 非空才会进入 getReadHistory 的过滤结果
const READ_ARTICLE = { ...E2E_ARTICLE, readAt: Date.now() - 60_000 }

test.describe('多用户切换路径', () => {
  test.beforeEach(async ({ page }) => {
    test.setTimeout(60_000)
    await setupApiFixtures(page)
  })

  test('登出后回到登录页，受保护路由被拦截', async ({ page }) => {
    await login(page)
    // 退出按钮（aria-label「退出登录」）：吊销会话 + 清理本地后整页跳转登录页
    await page.getByRole('button', { name: '退出登录' }).click()
    await page.waitForURL((u) => u.pathname === '/login')
    // 会话已清除：直接访问首页被 RequireAuth 拦回登录页
    await page.goto('/')
    await page.waitForURL((u) => u.pathname === '/login')
  })

  test('换账号登录清空上一账号的本地缓存', async ({ page }) => {
    await login(page, 'alice')
    await seedIndexedDB(page, 'articles', [READ_ARTICLE])

    // alice 的历史中可见该文章
    await page.goto('/history')
    await expect(page.getByRole('heading', { name: '阅读历史' })).toBeVisible()
    await expect(page.getByRole('heading', { name: E2E_ARTICLE.title })).toBeVisible()

    // 模拟「会话丢失但未登出」：仅清 sessionStorage，cache-owner 保留
    await page.evaluate(() => sessionStorage.clear())
    await page.goto('/')
    await page.waitForURL((u) => u.pathname === '/login')

    // bob 登录：cache-owner 由 u-alice 变为 u-bob → 清空本地业务缓存
    await login(page, 'bob')
    await page.goto('/history')
    await expect(page.getByText(HISTORY_EMPTY_TEXT)).toBeVisible()
    await expect(page.getByRole('heading', { name: E2E_ARTICLE.title })).toHaveCount(0)
  })

  test('同账号重复登录保留本地缓存', async ({ page }) => {
    await login(page, 'alice')
    await seedIndexedDB(page, 'articles', [READ_ARTICLE])
    await page.goto('/history')
    await expect(page.getByRole('heading', { name: E2E_ARTICLE.title })).toBeVisible()

    await page.evaluate(() => sessionStorage.clear())
    await page.goto('/')
    await page.waitForURL((u) => u.pathname === '/login')

    // 同一账号再次登录：cache-owner 不变 → 本地缓存保留，历史仍可见
    await login(page, 'alice')
    await page.goto('/history')
    await expect(page.getByRole('heading', { name: E2E_ARTICLE.title })).toBeVisible()
  })
})
