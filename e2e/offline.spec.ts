// E2E：离线回退路径
// dev 模式不生成 Service Worker（VitePWA 仅 build 时启用），
// 因此离线能力完全依赖 Dexie（IndexedDB）本地缓存 + navigator.onLine/offline 事件：
// 1. 在线预热复习页（React.lazy 的 ReviewPage chunk 必须先加载进内存，离线后无法再拉取）；
// 2. 在线加载文章 → getByIdLocalFirst 写入本地缓存；
// 3. context.setOffline(true) 模拟断网 → OfflineBanner 立即出现；
// 4. SPA 内部导航（点击侧边导航，不触发整页加载）→ 复习队列纯本地查询仍可用；
// 5. 断网状态下文章内容保持可见（本地渲染未中断）。
import { test, expect } from '@playwright/test'
import {
  setupApiFixtures,
  login,
  seedIndexedDB,
  E2E_ARTICLE,
  E2E_WORD,
} from './helpers'

test.describe('离线回退路径', () => {
  test.beforeEach(async ({ page }) => {
    test.setTimeout(60_000)
    await setupApiFixtures(page)
  })

  test('断网后本地缓存仍可支撑阅读页与复习队列', async ({ page, context }) => {
    await login(page)

    // 预置复习词（seedIndexedDB 会先访问生词本页确保 Dexie 建库，结束后停留在生词本）
    await seedIndexedDB(page, 'words', [E2E_WORD])

    // 在线：加载文章（getByIdLocalFirst 命中远端后写入本地缓存）
    await page.goto(`/reading?articleId=${E2E_ARTICLE.id}`)
    await expect(
      page.getByRole('heading', { level: 1, name: E2E_ARTICLE.title }),
    ).toBeVisible()

    // 在线预热复习页：page.goto 是整页加载（会清空 JS 模块缓存），
    // React.lazy 的 ReviewPage chunk 必须在当前文档生命周期内完成加载，
    // 因此用客户端导航进入复习页、再 history 返回（同一文档，chunk 保留在内存）
    await page.getByRole('link', { name: '生词背诵' }).click()
    await expect(page.getByRole('heading', { name: '单词复习' })).toBeVisible()
    await expect(page.getByText('今日待复习')).toBeVisible()
    await page.goBack()
    await expect(
      page.getByRole('heading', { level: 1, name: E2E_ARTICLE.title }),
    ).toBeVisible()

    // 断网：offline 事件触发 → OfflineBanner 立即出现
    await context.setOffline(true)
    await expect(
      page.getByText('当前处于离线模式，显示的数据可能不是最新'),
    ).toBeVisible()

    // 断网状态下文章仍完整展示（页面未重载，本地渲染未中断）
    await expect(
      page.getByRole('heading', { level: 1, name: E2E_ARTICLE.title }),
    ).toBeVisible()

    // SPA 内部导航到复习页：队列纯本地查询，离线仍可用
    await page.getByRole('link', { name: '生词背诵' }).click()
    await expect(page.getByRole('heading', { name: '单词复习' })).toBeVisible()
    await expect(page.getByText('今日待复习')).toBeVisible()
    await expect(page.locator('li button', { hasText: E2E_WORD.word })).toBeVisible()
  })
})
