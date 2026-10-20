// 重点词汇汇总服务单元测试
//
// 覆盖场景：
// 1. 正常分组：按 readAt 日期分组、倒序、附加来源信息
// 2. vocabulary 缺失的文章跳过（不触发 AI）
// 3. 无已读文章 → 空数组
// 4. 同日多篇文章 → 合并到同一分组且按文章顺序保留
//
// Mock 策略：重写 articleService.getReadHistory，返回内存构造的文章列表
import type { Article } from '@/shared/types'
import { articleService } from '@/features/reading/services/articleService'
import { getVocabulariesGroupedByDate } from '../vocabularySummaryService'
import type { ArticleVocabulary } from '@/shared/types'

// ---------- articleService.getReadHistory Mock ----------

// 保存原始方法引用，便于恢复
const originalGetReadHistory = articleService.getReadHistory

function installGetReadHistoryMock(articles: Article[]): void {
  articleService.getReadHistory = async () => articles
}

function restoreGetReadHistoryMock(): void {
  articleService.getReadHistory = originalGetReadHistory
}

// 构造合法的重点词汇条目
function makeVocabulary(word: string, overrides: Partial<ArticleVocabulary> = {}): ArticleVocabulary {
  return {
    word,
    phonetic: `/test/`,
    pos: 'n.',
    definition: `${word} 的释义`,
    example: `an example of ${word}`,
    importance: 'high',
    exampleTranslation: `${word} 的例句翻译`,
    exampleSentence: `The ${word} appears here.`,
    emojiHint: ['💡'],
    ...overrides,
  }
}

// 构造合法 Article（仅包含 getVocabulariesGroupedByDate 用到的字段）
function makeArticle(overrides: Partial<Article> = {}): Article {
  return {
    id: 'default-id',
    title: '默认文章标题',
    content: '默认文章内容',
    translation: '默认文章翻译',
    genre: 'narrative',
    wordCount: 250,
    createdAt: 1000,
    updated_at: 1000,
    ...overrides,
  }
}

describe('vocabularySummaryService 分组与来源附加', () => {
  // 1. 正常分组：按 readAt 日期分组、倒序、附加来源信息
  it('按 readAt 日期分组并倒序，附加来源信息', async () => {
    const article1 = makeArticle({
      id: 'a-2024-01-01',
      title: '第一篇文章',
      readAt: new Date('2024-01-01T10:00:00').getTime(),
      vocabulary: [makeVocabulary('apple'), makeVocabulary('banana', { importance: 'medium' })],
    })
    const article2 = makeArticle({
      id: 'a-2024-01-02',
      title: '第二篇文章',
      readAt: new Date('2024-01-02T10:00:00').getTime(),
      vocabulary: [makeVocabulary('cherry')],
    })
    installGetReadHistoryMock([article1, article2])

    try {
      const groups = await getVocabulariesGroupedByDate()

      // 验证按日期倒序（最近在前）
      expect(groups.length).toBe(2)
      expect(groups[0].date).toBe('2024-01-02')
      expect(groups[1].date).toBe('2024-01-01')
      // 验证来源信息附加
      expect(groups[0].vocabularies[0].articleId).toBe('a-2024-01-02')
      expect(groups[0].vocabularies[0].articleTitle).toBe('第二篇文章')
      expect(groups[1].vocabularies[0].word).toBe('apple')
      // 验证全部显示内容透传（持久化字段完整保留）
      expect(groups[1].vocabularies[0].exampleSentence).toBe('The apple appears here.')
      expect(groups[1].vocabularies[0].emojiHint).toEqual(['💡'])
      expect(groups[1].vocabularies[1].importance).toBe('medium')
    } finally {
      restoreGetReadHistoryMock()
    }
  })

  // 2. vocabulary 缺失的文章跳过（历史文章，不触发 AI）
  it('vocabulary 缺失的文章跳过', async () => {
    const withVocab = makeArticle({
      id: 'a-with-vocab',
      readAt: 2000,
      vocabulary: [makeVocabulary('apple')],
    })
    const withoutVocab = makeArticle({ id: 'a-without-vocab', readAt: 1000 })
    const emptyVocab = makeArticle({ id: 'a-empty-vocab', readAt: 3000, vocabulary: [] })
    installGetReadHistoryMock([withVocab, withoutVocab, emptyVocab])

    try {
      const groups = await getVocabulariesGroupedByDate()

      // 仅包含有词汇的文章
      expect(groups.length).toBe(1)
      expect(groups[0].vocabularies.length).toBe(1)
      expect(groups[0].vocabularies[0].word).toBe('apple')
    } finally {
      restoreGetReadHistoryMock()
    }
  })

  // 3. 无已读文章 → 空数组
  it('无已读文章 → 返回空数组', async () => {
    installGetReadHistoryMock([])

    try {
      const groups = await getVocabulariesGroupedByDate()
      expect(groups).toEqual([])
    } finally {
      restoreGetReadHistoryMock()
    }
  })

  // 4. 同日多篇文章 → 合并到同一分组且按文章顺序保留
  it('同日多篇文章合并到同一分组', async () => {
    const ts = new Date('2024-03-15T09:00:00').getTime()
    const article1 = makeArticle({
      id: 'a-1',
      title: '文章一',
      readAt: ts,
      vocabulary: [makeVocabulary('apple'), makeVocabulary('banana')],
    })
    const article2 = makeArticle({
      id: 'a-2',
      title: '文章二',
      readAt: ts + 3600_000, // 同一天
      vocabulary: [makeVocabulary('cherry')],
    })
    installGetReadHistoryMock([article1, article2])

    try {
      const groups = await getVocabulariesGroupedByDate()

      // 验证合并为单日分组，共 3 个词汇
      expect(groups.length).toBe(1)
      expect(groups[0].vocabularies.length).toBe(3)
      // 验证按文章顺序保留
      expect(groups[0].vocabularies.map((v) => v.word)).toEqual(['apple', 'banana', 'cherry'])
    } finally {
      restoreGetReadHistoryMock()
    }
  })
})
