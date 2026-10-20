// 阅读文章完整打印工作表测试
//
// 覆盖场景：
// 1. 完整渲染六大板块：标题/阅读理解/语法填空/参考答案（含字母与解析）/重点单词/重点短语/全文翻译
// 2. 题目未生成时跳过对应章节（不渲染空章节）
// 3. 挂载后自动唤起 window.print()，afterprint 事件触发 onFinished 卸载回调
import { render, screen, fireEvent } from '@testing-library/react'
import type { Article, Question } from '@/shared/types'
import PrintableWorksheet from '../PrintableWorksheet'

// 构造完整 Article 测试实体（覆盖打印所需的全部字段）
function makeArticle(overrides: Partial<Article> = {}): Article {
  return {
    id: '2026-01-01',
    title: 'My First AI Experience',
    content: 'Paragraph one about AI.\nParagraph two about learning.',
    translation: '第一段关于 AI。\n第二段关于学习。',
    genre: 'narrative',
    wordCount: 250,
    createdAt: new Date('2026-01-01').getTime(),
    updated_at: 0,
    topic: 'ai_life',
    difficulty: 'medium',
    lexileRange: { min: 700, max: 800 },
    highlightedWords: [
      {
        word: 'rely',
        phonetic: '/rɪˈlaɪ/',
        pos: 'v.',
        definition: '依赖',
        example: 'I rely on AI too much.',
      },
    ],
    phrases: [
      {
        phrase: 'rely on',
        meaning: '依赖',
        example: 'I rely on AI too much.',
        exampleTranslation: '我太依赖 AI 了。',
      },
    ],
    readAt: null,
    ...overrides,
  }
}

// 构造题目实体（选项按题号生成唯一文本，避免多题同文触发多元素匹配）
function makeQuestion(id: string, n: number, correctIndex = 1): Question {
  return {
    id,
    articleId: '2026-01-01',
    type: 'detail',
    stem: `Question ${n} stem?`,
    options: [`Option A ${n}`, `Option B ${n}`, `Option C ${n}`, `Option D ${n}`],
    correctIndex,
    explanation: `解析 ${n}`,
    locationClue: `第一段：...（第 ${n} 题线索）`,
    createdAt: 0,
    updated_at: 0,
  }
}

describe('PrintableWorksheet 打印工作表', () => {
  beforeEach(() => {
    // jsdom 未实现 window.print，替换为 spy 避免报错
    vi.spyOn(window, 'print').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('渲染标题、元信息与全部六大板块', () => {
    render(
      <PrintableWorksheet
        article={makeArticle({
          vocabulary: [
            {
              word: 'rely',
              phonetic: '/rɪˈlaɪ/',
              pos: 'v.',
              definition: '依赖',
              example: 'I rely on AI too much.',
              importance: 'high',
            },
          ],
        })}
        questions={[makeQuestion('2026-01-01-1', 1), makeQuestion('2026-01-01-2', 2)]}
        grammarQuestions={[
          {
            ...makeQuestion('2026-01-01-g1', 1, 3),
            stem: 'Grammar 1: He ___ to school every day.',
            options: ['go', 'goes', 'went', 'going'],
            explanation: '语法解析 1',
            locationClue: '第二段：...（语法题线索）',
          },
        ]}
        onFinished={() => {}}
      />,
    )

    // 标题与元信息
    expect(screen.getByText('My First AI Experience')).toBeInTheDocument()
    expect(screen.getByText(/人工智能与生活/)).toBeInTheDocument()
    expect(screen.getByText(/蓝思 700-800L/)).toBeInTheDocument()
    // 七大板块标题（原文 + 题目 + 答案 + 词汇 + 短语 + 翻译）
    expect(screen.getByText('一、阅读原文')).toBeInTheDocument()
    expect(screen.getByText('二、阅读理解（共 2 题）')).toBeInTheDocument()
    expect(screen.getByText('三、语法填空（共 1 题）')).toBeInTheDocument()
    expect(screen.getByText('四、参考答案与解析')).toBeInTheDocument()
    expect(screen.getByText(/重点单词（共 1 个）/)).toBeInTheDocument()
    expect(screen.getByText(/重点短语（共 1 个）/)).toBeInTheDocument()
    expect(screen.getByText('七、全文翻译')).toBeInTheDocument()
    // 文章原文段落完整渲染（原文章节 + 全文翻译对照各出现一次，共 2 次）
    expect(screen.getAllByText('Paragraph one about AI.').length).toBe(2)
    expect(screen.getAllByText('Paragraph two about learning.').length).toBe(2)
    // 题干与选项
    expect(screen.getByText(/Question 1 stem\?/)).toBeInTheDocument()
    expect(screen.getByText(/Grammar 1: He ___ to school/)).toBeInTheDocument()
    expect(screen.getByText('A. Option A 1')).toBeInTheDocument()
    expect(screen.getByText('D. Option D 2')).toBeInTheDocument()
    // 答案字母与解析（correctIndex=1 → B；g1 correctIndex=3 → D）
    expect(screen.getByText('1. B')).toBeInTheDocument()
    expect(screen.getByText('2. B')).toBeInTheDocument()
    expect(screen.getByText('1. D')).toBeInTheDocument()
    // 解析与定位线索（阅读题与语法题文案不同，避免多元素匹配）
    expect(screen.getByText('解析 1')).toBeInTheDocument()
    expect(screen.getByText('语法解析 1')).toBeInTheDocument()
    expect(screen.getByText('定位：第一段：...（第 1 题线索）')).toBeInTheDocument()
    // 单词表内容
    expect(screen.getByText('rely')).toBeInTheDocument()
    expect(screen.getByText('/rɪˈlaɪ/')).toBeInTheDocument()
    expect(screen.getByText('（核心）')).toBeInTheDocument()
    // 短语与翻译
    expect(screen.getByText('rely on')).toBeInTheDocument()
    expect(screen.getByText('我太依赖 AI 了。')).toBeInTheDocument()
    // 全文翻译中文段落对照（英文段落已在上方与原文章节一起断言）
    expect(screen.getByText('第一段关于 AI。')).toBeInTheDocument()
  })

  it('题目未生成时跳过题目与答案章节，仅渲染文章内容板块', () => {
    render(
      <PrintableWorksheet
        article={makeArticle()}
        questions={[]}
        grammarQuestions={[]}
        onFinished={() => {}}
      />,
    )

    expect(screen.queryByText(/阅读理解（共/)).not.toBeInTheDocument()
    expect(screen.queryByText(/语法填空（共/)).not.toBeInTheDocument()
    expect(screen.queryByText('四、参考答案与解析')).not.toBeInTheDocument()
    // 原文与文章内容板块仍在
    expect(screen.getByText('一、阅读原文')).toBeInTheDocument()
    expect(screen.getByText('七、全文翻译')).toBeInTheDocument()
    expect(screen.getByText('六、重点短语（共 1 个）')).toBeInTheDocument()
  })

  it('highlightedWords 兜底：无 vocabulary 时仍渲染单词表', () => {
    render(
      <PrintableWorksheet
        article={makeArticle({
          vocabulary: undefined,
          // 短语释义与单词释义同文会触发多元素匹配，改用不同文案隔离断言
          phrases: [
            {
              phrase: 'give up',
              meaning: '放弃',
              example: 'Never give up.',
              exampleTranslation: '永不放弃。',
            },
          ],
        })}
        questions={[]}
        grammarQuestions={[]}
        onFinished={() => {}}
      />,
    )

    expect(screen.getByText('rely')).toBeInTheDocument()
    expect(screen.getByText('依赖')).toBeInTheDocument()
  })

  it('翻译为空时跳过全文翻译章节，原文照常渲染', () => {
    render(
      <PrintableWorksheet
        article={makeArticle({ translation: '' })}
        questions={[]}
        grammarQuestions={[]}
        onFinished={() => {}}
      />,
    )

    expect(screen.queryByText('七、全文翻译')).not.toBeInTheDocument()
    // 原文章节不受影响（此时无翻译对照，英文段落仅出现 1 次）
    expect(screen.getByText('一、阅读原文')).toBeInTheDocument()
    expect(screen.getAllByText('Paragraph one about AI.').length).toBe(1)
  })

  it('翻译段落多于原文时兜底渲染剩余中文段落，避免漏译', () => {
    render(
      <PrintableWorksheet
        article={makeArticle({
          // 3 段中文 vs 2 段英文：第 3 段中文应追加渲染
          translation: '第一段翻译。\n第二段翻译。\n第三段额外翻译。',
        })}
        questions={[]}
        grammarQuestions={[]}
        onFinished={() => {}}
      />,
    )

    expect(screen.getByText('第三段额外翻译。')).toBeInTheDocument()
  })

  it('挂载后自动唤起 window.print()，afterprint 后调用 onFinished', () => {
    vi.useFakeTimers()
    const onFinished = vi.fn()
    render(
      <PrintableWorksheet
        article={makeArticle()}
        questions={[]}
        grammarQuestions={[]}
        onFinished={onFinished}
      />,
    )

    // 挂载后延迟 100ms 唤起打印
    expect(window.print).not.toHaveBeenCalled()
    vi.advanceTimersByTime(150)
    expect(window.print).toHaveBeenCalledTimes(1)

    // 浏览器打印对话框关闭后触发 afterprint → 卸载回调
    expect(onFinished).not.toHaveBeenCalled()
    fireEvent(window, new Event('afterprint'))
    expect(onFinished).toHaveBeenCalledTimes(1)
    vi.useRealTimers()
  })
})
