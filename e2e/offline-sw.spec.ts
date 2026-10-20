// E2E（生产构建）：Service Worker 预缓存离线验证
// 普通离线测试（offline.spec.ts）跑在 vite dev 上，dev 模式不生成 SW，
// 验证的是 Dexie 本地缓存回退；本 spec 跑在 vite preview（vite build 产物）上，
// 验证 Workbox 预缓存真实生效：断网后整页重载仍可由 SW 提供文档与全部资源。
//
// 与 dev 的关键差异：
// - 生产构建 SW 由 vite-plugin-pwa 自动注入注册（injectRegister: auto），登录后的
//   整页跳转（location.assign）已处于 SW 控制下 → 页面发出的 /api 请求会经 SW 透传，
//   page.route() 不拦截 SW 发起的网络请求，因此本 spec 用 context.route 注册 fixture；
// - 全部 chunk 已预缓存 → 离线 SPA 导航无 dev 下的懒加载 chunk 失败问题，无需预热。
import { test, expect } from '@playwright/test'
import {
  setupApiFixturesOnContext,
  login,
  seedIndexedDB,
  E2E_ARTICLE,
  E2E_WORD,
} from './helpers'

test.describe('生产构建 SW 离线回退', () => {
  test.beforeEach(async ({ context }) => {
    test.setTimeout(90_000)
    await setupApiFixturesOnContext(context)
  })

  test('断网后整页重载由 SW 预缓存支撑，本地数据照常可用', async ({ page, context }) => {
    await login(page)

    // 预置复习词（seedIndexedDB 会先访问生词本页确保 Dexie 建库，结束后停留在生词本）
    await seedIndexedDB(page, 'words', [E2E_WORD])

    // 在线加载文章（getByIdLocalFirst 命中远端后写入本地缓存）
    await page.goto(`/reading?articleId=${E2E_ARTICLE.id}`)
    await expect(
      page.getByRole('heading', { level: 1, name: E2E_ARTICLE.title }),
    ).toBeVisible()

    // 等待 SW 激活：workbox install 完成（预缓存全部写入）后才会进入 active，
    // 因此 ready 即代表预缓存就绪
    await page.evaluate(() => navigator.serviceWorker.ready.then(() => null))

    // 以受 SW 控制的导航确认整页可加载（此时仍在线）
    await page.reload()
    await expect(
      page.getByRole('heading', { level: 1, name: E2E_ARTICLE.title }),
    ).toBeVisible()

    // 断网 → 整页重载：文档与静态资源由 SW 预缓存提供（dev 下此场景必然失败）
    await context.setOffline(true)
    await page.reload()
    await expect(
      page.getByText('当前处于离线模式，显示的数据可能不是最新'),
    ).toBeVisible()
    await expect(
      page.getByRole('heading', { level: 1, name: E2E_ARTICLE.title }),
    ).toBeVisible()

    // 离线 SPA 导航：生产构建 chunk 已全部预缓存，复习队列纯本地查询仍可用
    await page.getByRole('link', { name: '生词背诵' }).click()
    await expect(page.getByRole('heading', { name: '单词复习' })).toBeVisible()
    await expect(page.getByText('今日待复习')).toBeVisible()
    await expect(page.locator('li button', { hasText: E2E_WORD.word })).toBeVisible()
  })
})
