// questionService 异常、写入失败与并行协调单元测试
//
// 覆盖场景：
// 1. 阅读理解 AI 外部中断（AbortError）直接抛出
// 2. 题目写入本地失败时仍返回生成结果
// 3. 语法填空 AI 外部中断 / 普通失败的错误透传
// 4. 语法填空与阅读理解题干全部重复时抛出格式无效错误
// 5. 语法填空写入本地失败时仍返回结果
// 6. 语法填空等待同文章阅读理解生成完成后再去重（in-flight 协调）
//
// Mock 策略：复用 questionServiceTestMocks 的内存仓储与 AI mock，
// 逐用例覆写单个方法模拟失败与延迟。

import { describe, it, expect, afterEach } from 'vitest'
import type { QuestionGenerationResult } from '@/shared/services/ai'
import { questionRepository } from '@/shared/services'
import {
  getQuestionsForArticle,
  getGrammarFillQuestionsForArticle,
} from '../questionService'
import {
  installRepoMock,
  restoreRepoMock,
  installAIMock,
  installGrammarAIMock,
  restoreAIMock,
  makeArticle,
  makeAIQuestion,
  makeQuestion,
} from './questionServiceTestMocks'

function makeAbortError(): Error {
  const err = new Error('请求被外部中断')
  err.name = 'AbortError'
  return err
}

describe('questionService 异常与并行协调', () => {
  const article = makeArticle({ id: 'err-article' })

  afterEach(() => {
    restoreRepoMock()
    restoreAIMock()
  })

  it('阅读理解 AI AbortError 直接抛出', async () => {
    installRepoMock([])
    installAIMock(async () => {
      throw makeAbortError()
    })

    await expect(getQuestionsForArticle(article)).rejects.toMatchObject({
      name: 'AbortError',
    })
  })

  it('题目写入本地失败时仍返回生成结果', async () => {
    installRepoMock([])
    installAIMock(async () => [makeAIQuestion('err-article-1')])
    questionRepository.add = async () => {
      throw new Error('write failed')
    }

    const result = await getQuestionsForArticle(article)

    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('err-article-1')
  })

  it('语法填空 AI AbortError 直接抛出', async () => {
    installRepoMock([])
    installGrammarAIMock(async () => {
      throw makeAbortError()
    })

    await expect(getGrammarFillQuestionsForArticle(article)).rejects.toMatchObject({
      name: 'AbortError',
    })
  })

  it('语法填空 AI 失败时透传可读错误消息', async () => {
    installRepoMock([])
    installGrammarAIMock(async () => {
      throw new Error('上游超时')
    })

    await expect(getGrammarFillQuestionsForArticle(article)).rejects.toThrow(/上游超时/)
  })

  it('语法填空与阅读理解题干全部重复时抛出格式无效错误', async () => {
    const stem = 'What can we learn from paragraph 2?'
    installRepoMock([makeQuestion('err-article-1', { articleId: article.id, stem, type: 'detail' })])
    installGrammarAIMock(async () => [
      makeAIQuestion('err-article-g1', { stem, type: 'grammar_fill' }),
    ])

    await expect(getGrammarFillQuestionsForArticle(article)).rejects.toThrow(
      /格式无效或与阅读理解题全部重复/,
    )
  })

  it('语法填空写入本地失败时仍返回生成结果', async () => {
    installRepoMock([])
    installGrammarAIMock(async () => [
      makeAIQuestion('err-article-g1', {
        stem: 'She ______ a teacher.',
        type: 'grammar_fill',
      }),
    ])
    questionRepository.add = async () => {
      throw new Error('write failed')
    }

    const result = await getGrammarFillQuestionsForArticle(article)

    expect(result).toHaveLength(1)
    expect(result[0].type).toBe('grammar_fill')
  })

  it('语法填空等待同文章阅读理解完成后再生成', async () => {
    installRepoMock([])
    let resolveReading!: (items: QuestionGenerationResult[]) => void
    installAIMock(
      () =>
        new Promise<QuestionGenerationResult[]>((resolve) => {
          resolveReading = resolve
        }),
    )
    let grammarCalled = false
    installGrammarAIMock(async () => {
      grammarCalled = true
      return [
        makeAIQuestion('err-article-g1', {
          stem: 'He ______ to school every day.',
          type: 'grammar_fill',
        }),
      ]
    })

    const readingPromise = getQuestionsForArticle(article)
    const grammarPromise = getGrammarFillQuestionsForArticle(article)

    // 阅读理解尚未完成时，语法填空应处于等待状态
    await Promise.resolve()
    expect(grammarCalled).toBe(false)

    resolveReading([makeAIQuestion('err-article-1', { stem: 'Main idea?' })])
    const [reading, grammar] = await Promise.all([readingPromise, grammarPromise])

    expect(grammarCalled).toBe(true)
    expect(reading).toHaveLength(1)
    expect(grammar).toHaveLength(1)
  })
})
