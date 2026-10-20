// E2E：阅读路径
// 覆盖两条分支：
// 1. 失败分支：不预置题目 → AI 代理 404 → 挂载时语法填空提示条 + 「阅读完成」后练习题生成失败错误态；
// 2. 成功分支：预置本地题目 → 「阅读完成」直接进入答题视图 → 逐题作答 → 成绩单。
// 前置说明：fixture 文章带「增强版」vocabulary（三字段齐全），
// vocabularyService 短路 AI → 词汇清单直接渲染，不出现「重点词汇生成失败」。
import { test, expect } from '@playwright/test'
import {
  setupApiFixtures,
  login,
  seedIndexedDB,
  E2E_ARTICLE,
  E2E_QUESTIONS,
} from './helpers'

test.describe('阅读路径', () => {
  test.beforeEach(async ({ page }) => {
    test.setTimeout(60_000)
    await setupApiFixtures(page)
  })

  test('失败分支：AI 不可用时提示生成失败并提供重试入口', async ({ page }) => {
    await login(page)
    await page.goto(`/reading?articleId=${E2E_ARTICLE.id}`)

    // 文章渲染（历史文章模式）
    await expect(
      page.getByRole('heading', { level: 1, name: E2E_ARTICLE.title }),
    ).toBeVisible()

    // 增强版词汇短路 AI：重点短语区块直接渲染，无「重点词汇生成失败」提示
    await expect(page.getByRole('heading', { name: '重点短语' })).toBeVisible()
    await expect(page.getByText('重点词汇生成失败')).toHaveCount(0)

    // 语法填空与题目并行生成，AI 404 → 提示条可见
    await expect(page.getByText(/语法填空题生成失败：/)).toBeVisible()

    // 无本地题目 + AI 失败 → 「阅读完成」后进入错误态（toast + 红色错误框 + 重试按钮）
    await page.getByRole('button', { name: '阅读完成' }).click()
    await expect(page.getByText(/练习题生成失败/)).toBeVisible()
    await expect(page.getByText('生成失败', { exact: true })).toBeVisible()
  })

  test('成功分支：预置本地题目，完成阅读理解并查看成绩单', async ({ page }) => {
    await login(page)
    await seedIndexedDB(page, 'questions', E2E_QUESTIONS)
    await page.goto(`/reading?articleId=${E2E_ARTICLE.id}`)

    await expect(
      page.getByRole('heading', { level: 1, name: E2E_ARTICLE.title }),
    ).toBeVisible()

    // 本地题目命中 → 「阅读完成」直接进入答题视图（不调 AI）
    await page.getByRole('button', { name: '阅读完成' }).click()
    await expect(page.getByText('第 1 / 2 题')).toBeVisible()

    // 第 1 题：按预置正确项作答（选项按内容定位）
    const q1 = E2E_QUESTIONS[0]
    await page
      .getByRole('button')
      .filter({ hasText: q1.options[q1.correctIndex] })
      .click()
    await expect(page.getByText('✓ 回答正确')).toBeVisible()
    await page.getByRole('button', { name: '下一题' }).click()

    // 第 2 题：答完后按钮变为「查看成绩」
    const q2 = E2E_QUESTIONS[1]
    await expect(page.getByText('第 2 / 2 题')).toBeVisible()
    await page
      .getByRole('button')
      .filter({ hasText: q2.options[q2.correctIndex] })
      .click()
    await expect(page.getByText('✓ 回答正确')).toBeVisible()
    await page.getByRole('button', { name: '查看成绩' }).click()

    // 语法填空未就绪（AI 404）→ 交互式选择页 → 跳过
    await expect(
      page.getByText('完成阅读理解后，是否继续做语法填空？'),
    ).toBeVisible()
    await page.getByRole('button', { name: '跳过，直接查看成绩' }).click()

    // 成绩单：2/2 全对 → 正确率 100%（多处展示，取成绩单卡片首个）
    await expect(page.getByRole('heading', { name: '本次成绩单' })).toBeVisible()
    await expect(page.getByText('100%').first()).toBeVisible()
  })
})
