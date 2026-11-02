// E2E：移动端回归
// 通过 viewport 模拟手机尺寸（375×667 与 320×568 窄屏），验证：
// 1. 桌面顶部导航隐藏、底部 Tab 导航显示且当前页标记 aria-current；
// 2. 底部 Tab 可驱动主流程页面跳转；
// 3. 页面无横向溢出（窄屏下不出现左右滚动条）。
import { test, expect } from '@playwright/test'
import { setupApiFixtures, login } from './helpers'

test.describe('移动端回归（375×667）', () => {
  test.use({ viewport: { width: 375, height: 667 } })

  test.beforeEach(async ({ page }) => {
    test.setTimeout(60_000)
    await setupApiFixtures(page)
  })

  test('底部 Tab 导航驱动主流程，页面无横向溢出', async ({ page }) => {
    await login(page)

    // 桌面导航隐藏、底部 Tab 显示
    await expect(page.locator('nav[aria-label="主导航"]')).toBeHidden()
    const bottomNav = page.getByRole('navigation', { name: '底部导航' })
    await expect(bottomNav).toBeVisible()
    await expect(bottomNav.getByRole('link', { name: '首页' })).toHaveAttribute(
      'aria-current',
      'page',
    )

    // 首页无横向溢出
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(1)

    // 底部 Tab 跳转生词本：无弹窗遮挡，直接可用
    await bottomNav.getByRole('link', { name: '单词本' }).click()
    await expect(page).toHaveURL(/\/wordbook/)
    await expect(page.getByRole('heading', { name: '生词本' })).toBeVisible()
    await expect(bottomNav.getByRole('link', { name: '单词本' })).toHaveAttribute(
      'aria-current',
      'page',
    )

    // 生词本页无横向溢出
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(1)
  })
})

test.describe('移动端回归（320×568 窄屏）', () => {
  test.use({ viewport: { width: 320, height: 568 } })

  test('底部导航五项完整可见，页面无横向溢出', async ({ page }) => {
    test.setTimeout(60_000)
    await setupApiFixtures(page)
    await login(page)

    const bottomNav = page.getByRole('navigation', { name: '底部导航' })
    await expect(bottomNav.getByRole('link')).toHaveCount(5)
    for (const label of ['首页', '阅读', '单词本', '背诵', '我的']) {
      await expect(bottomNav.getByRole('link', { name: label })).toBeVisible()
    }

    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(1)
  })
})

// 横向溢出像素数：scrollWidth 与 clientWidth 的差值
async function horizontalOverflow(page: import('@playwright/test').Page): Promise<number> {
  return page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  )
}
