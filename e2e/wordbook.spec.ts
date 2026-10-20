// E2E：生词本路径
// 覆盖「添加单词」全流程：工具栏「添加」→ AddWordModal 五字段填写 → 保存 →
// GET /api/words/{id} 404（fixture）→ POST /api/words 回显写入 → 弹窗关闭 →
// 列表自动刷新出现生词卡。
// 五字段完整（音标/词性/释义/例句）→ addToWordbook 不触发 AI 补全，行为确定。
import { test, expect } from '@playwright/test'
import { setupApiFixtures, login } from './helpers'

test.describe('生词本路径', () => {
  test.beforeEach(async ({ page }) => {
    test.setTimeout(60_000)
    await setupApiFixtures(page)
  })

  test('添加单词：填写五字段后保存，生词卡出现在列表', async ({ page }) => {
    await login(page)
    await page.goto('/wordbook')

    // 打开添加弹窗
    await page.getByRole('button', { name: '添加', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: '添加单词' })
    await expect(dialog).toBeVisible()

    // 填写五字段（词性保持默认项）
    await dialog.getByPlaceholder('请输入英文单词').fill('ephemeral')
    await dialog.getByPlaceholder('如 /əˈpleɪ/').fill('/ɪˈfemərəl/')
    await dialog.getByPlaceholder('中文释义').fill('短暂的，转瞬即逝的')
    await dialog.getByPlaceholder('包含该词的例句').fill('Fame is often ephemeral.')

    // 保存 → 弹窗关闭 → 列表自动刷新出现生词卡
    await dialog.getByRole('button', { name: '保存' }).click()
    await expect(dialog).toBeHidden()
    await expect(page.getByRole('heading', { name: 'ephemeral' })).toBeVisible()
  })
})
