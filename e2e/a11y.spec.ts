// E2E：无障碍基线
// 覆盖：
// 1. 键盘可达：首个 Tab 聚焦「跳到主要内容」，回车后 URL 指向主内容区；
//    导航有可读名称，当前页通过 aria-current="page" 标记；
// 2. 焦点管理：弹窗打开时焦点进入弹窗，Tab / Shift+Tab 不逃逸到背景页面，
//    Escape 关闭后焦点回到触发按钮。
import { test, expect } from '@playwright/test'
import { setupApiFixtures, login } from './helpers'

test.describe('无障碍基线', () => {
  test.beforeEach(async ({ page }) => {
    test.setTimeout(60_000)
    await setupApiFixtures(page)
  })

  test('键盘可达：跳转链接直达主内容区，导航带可读名称与当前页标记', async ({ page }) => {
    await login(page)

    // 首个 Tab 停留在跳转链接（页面上第一个可聚焦元素）
    await page.keyboard.press('Tab')
    const skipLink = page.getByRole('link', { name: '跳到主要内容' })
    await expect(skipLink).toBeFocused()

    // 回车后跳转到 #main-content（主内容区 tabIndex=-1，可作为焦点目标）
    await page.keyboard.press('Enter')
    await expect(page).toHaveURL(/#main-content$/)
    await expect(page.locator('#main-content')).toHaveAttribute('tabindex', '-1')

    // 桌面导航有明确名称，当前页标记 aria-current="page"
    const primaryNav = page.getByRole('navigation', { name: '主导航' })
    await expect(primaryNav).toBeVisible()
    await expect(primaryNav.getByRole('link', { name: '首页' })).toHaveAttribute(
      'aria-current',
      'page',
    )
  })

  test('弹窗焦点管理：焦点进入弹窗、Tab 不逃逸、Escape 关闭后回到触发按钮', async ({ page }) => {
    await login(page)
    await page.goto('/wordbook')

    const addButton = page.getByRole('button', { name: '添加', exact: true })
    await addButton.click()

    const dialog = page.getByRole('dialog', { name: '添加单词' })
    await expect(dialog).toBeVisible()
    await expect(dialog).toHaveAttribute('aria-modal', 'true')
    // 打开后初始焦点落在弹窗内首个输入框
    await expect(dialog.getByPlaceholder('请输入英文单词')).toBeFocused()

    // 连续 Tab：焦点始终在弹窗内（末尾回绕到首个元素，不逃逸到背景导航）
    for (let i = 0; i < 12; i++) {
      await page.keyboard.press('Tab')
      expect(
        await page.evaluate(() => !!document.activeElement?.closest('[role="dialog"]')),
      ).toBe(true)
    }

    // Shift+Tab 同样不逃逸
    await page.keyboard.press('Shift+Tab')
    expect(
      await page.evaluate(() => !!document.activeElement?.closest('[role="dialog"]')),
    ).toBe(true)

    // Escape 关闭后焦点还给触发按钮
    await page.keyboard.press('Escape')
    await expect(dialog).toBeHidden()
    await expect(addButton).toBeFocused()
  })
})
