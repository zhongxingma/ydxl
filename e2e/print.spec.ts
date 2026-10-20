// E2E：打印路径
// PrintableWorksheet 通过 Portal 挂载到 body 下的 .print-portal（屏幕上
// display:none，仅打印媒体可见），挂载后 100ms 自动调用 window.print()，
// 依赖 afterprint 事件或 60s 兜底超时卸载。headless 环境无法唤起打印对话框，
// 测试中以「window.print 桩计数 + 元素已挂载」断言工作表渲染。
// 覆盖两条分支：
// 1. 降级分支：无预置题目 → AI 404 → 提示「仅打印文章内容」→ 打开工作表；
// 2. 完整分支：预置阅读理解题（语法填空 AI 404 静默跳过）→ 工作表包含题目内容。
import { test, expect, type Page } from '@playwright/test'
import {
  setupApiFixtures,
  login,
  seedIndexedDB,
  E2E_ARTICLE,
  E2E_QUESTIONS,
} from './helpers'

// 在页面主世界安装 window.print 桩（headless 无打印对话框；桩掉后
// afterprint 不会触发，Portal 会保留到用例结束，便于断言）
async function stubWindowPrint(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as unknown as { __printCalls: number }
    w.__printCalls = 0
    window.print = () => {
      w.__printCalls++
    }
  })
}

// 打印按钮的可访问名来自 aria-label「打印完整练习」
const PRINT_BUTTON = /打印完整练习/

async function expectPrintedOnce(page: Page): Promise<void> {
  await expect
    .poll(
      () =>
        page.evaluate(
          () => (window as unknown as { __printCalls: number }).__printCalls,
        ),
    )
    .toBe(1)
}

test.describe('打印路径', () => {
  test.beforeEach(async ({ page }) => {
    test.setTimeout(60_000)
    await setupApiFixtures(page)
  })

  test('降级分支：题目生成失败时仅打印文章内容', async ({ page }) => {
    await login(page)
    await page.goto(`/reading?articleId=${E2E_ARTICLE.id}`)
    await expect(
      page.getByRole('heading', { level: 1, name: E2E_ARTICLE.title }),
    ).toBeVisible()
    await stubWindowPrint(page)

    // 无本地题目 + AI 404 → 打印前补题失败 → 提示后降级打开工作表
    await page.getByRole('button', { name: PRINT_BUTTON }).click()
    await expect(page.getByText('练习题生成失败，仅打印文章内容')).toBeVisible()
    await expect(page.locator('.print-portal')).toHaveCount(1)
    await expectPrintedOnce(page)
  })

  test('完整分支：预置题目时工作表包含阅读理解题', async ({ page }) => {
    await login(page)
    await seedIndexedDB(page, 'questions', E2E_QUESTIONS)
    await page.goto(`/reading?articleId=${E2E_ARTICLE.id}`)
    await expect(
      page.getByRole('heading', { level: 1, name: E2E_ARTICLE.title }),
    ).toBeVisible()
    await stubWindowPrint(page)

    // 阅读理解题本地命中，语法填空 AI 404 静默跳过 → 直接打开工作表（含题目）
    await page.getByRole('button', { name: PRINT_BUTTON }).click()
    const portal = page.locator('.print-portal')
    await expect(portal).toHaveCount(1)
    await expect(portal).toContainText(E2E_QUESTIONS[0].stem)
    await expectPrintedOnce(page)
  })
})
