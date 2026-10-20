// E2E：复习路径
// 覆盖五步复习全流程：列表 → 识记 → 朗读 → 练习 → 拼写 → 默写 → 已掌握评价 → 完成状态。
// 前置说明：
// - 复习队列纯本地查询（whereBelowOrEqual('nextReview', now)），
//   seed 词 nextReview=0 确保命中今日队列；
// - 练习步骤 3-5 题随机、选项打乱：正确项按内容定位
//   （单词类题型选项为 word.word，释义类题型选项为 word.definition）；
// - seed 词五字段齐全 → 不触发 enrichWord 的 AI 补全。
import { test, expect } from '@playwright/test'
import { setupApiFixtures, login, seedIndexedDB, E2E_WORD } from './helpers'

test.describe('复习路径', () => {
  test.beforeEach(async ({ page }) => {
    test.setTimeout(90_000)
    await setupApiFixtures(page)
  })

  test('五步复习全流程：识记 → 朗读 → 练习 → 拼写 → 默写 → 已掌握', async ({ page }) => {
    await login(page)
    await seedIndexedDB(page, 'words', [E2E_WORD])
    await page.goto('/review')

    // 列表视图：本地队列命中，统计卡与队列项可见
    await expect(page.getByRole('heading', { name: '单词复习' })).toBeVisible()
    await expect(page.getByText('今日待复习')).toBeVisible()
    await page.locator('li button', { hasText: E2E_WORD.word }).click()

    // 步骤 1/5 识记：查看内容后点击「下一步」
    await expect(page.getByText('步骤 1/5 · 识记')).toBeVisible()
    await page.getByRole('button', { name: '下一步' }).click()

    // 步骤 2/5 朗读
    await expect(page.getByText('步骤 2/5 · 朗读')).toBeVisible()
    await page.getByRole('button', { name: '下一步' }).click()

    // 步骤 3/5 练习：3-5 题随机，循环作答直至进入拼写步骤
    await expect(page.getByText('步骤 3/5 · 练习')).toBeVisible()
    for (let i = 0; i < 8; i++) {
      // 练习完成（步骤推进到拼写）时退出循环
      if (await page.getByText('步骤 4/5 · 拼写').isVisible().catch(() => false)) break
      // 正确项按内容定位：单词类题型点单词本身，释义类题型点释义
      const wordOption = page.getByRole('button').filter({ hasText: E2E_WORD.word })
      const defOption = page.getByRole('button').filter({ hasText: E2E_WORD.definition })
      if ((await wordOption.count()) > 0) {
        await wordOption.first().click()
      } else {
        await defOption.first().click()
      }
      await expect(page.getByText('✓ 回答正确！')).toBeVisible()
      // 答对后手动推进：非末题「下一题」，末题「完成本步」
      await page.getByRole('button', { name: /下一题|完成本步/ }).click()
    }

    // 步骤 4/5 拼写：正确提交后自动推进（反馈文案一闪而过，直接断言步骤推进）
    await expect(page.getByText('步骤 4/5 · 拼写')).toBeVisible()
    await page.getByPlaceholder('请输入单词...').fill(E2E_WORD.word)
    await page.getByRole('button', { name: '提交' }).click()

    // 步骤 5/5 默写
    await expect(page.getByText('步骤 5/5 · 默写')).toBeVisible()
    await page.getByPlaceholder('请输入英文单词...').fill(E2E_WORD.word)
    await page.getByRole('button', { name: '提交' }).click()

    // 五步完成 → 复习评价弹窗 → 选择「已掌握」
    await expect(page.getByRole('heading', { name: '复习评价' })).toBeVisible()
    await page.getByRole('button', { name: '已掌握' }).click()

    // 返回列表：队列清空 + 会话已复习 → 今日复习已完成
    await expect(page.getByText('今日复习已完成 🎉').first()).toBeVisible()
  })
})
