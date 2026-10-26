// 添加文章表单逻辑 hook
//
// 覆盖字段默认值与派生状态、AI 翻译成功 / 失败 / 进度提示 / 并发守卫、
// 保存成功自动关闭与实体字段、保存失败与参数守卫、关闭重置、Escape 与滚动锁定。

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import type { Article } from '@/shared/types'
import { articleService } from '@/features/reading/services/articleService'
import { aiProvider } from '@/shared/services/ai'
import { useAddArticleForm, MIN_CONTENT_LENGTH, TRANSLATION_HINTS } from '../useAddArticleForm'

vi.mock('@/features/reading/services/articleService', () => ({
  articleService: {
    saveArticle: vi.fn(),
  },
}))

vi.mock('@/shared/services/ai', () => ({
  aiProvider: {
    generateTranslation: vi.fn(),
  },
}))

const saveMock = vi.mocked(articleService.saveArticle)
const translateMock = vi.mocked(aiProvider.generateTranslation)

const LONG_CONTENT =
  'Tom goes to school every day. He likes reading English stories with his friends.'

function renderForm(open = true, onClose = vi.fn()) {
  const utils = renderHook(
    ({ open: isOpen }) => useAddArticleForm(isOpen, onClose),
    { initialProps: { open } },
  )
  return { ...utils, onClose }
}

describe('useAddArticleForm 添加文章表单', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    saveMock.mockImplementation(async (article: Article) => article)
    translateMock.mockResolvedValue('汤姆每天去上学。')
    document.body.style.overflow = ''
  })

  afterEach(() => {
    vi.useRealTimers()
    document.body.style.overflow = ''
  })

  it('初始状态：默认文体 / 题材 / 难度与空字段', () => {
    const { result } = renderForm()

    expect(result.current.title).toBe('')
    expect(result.current.content).toBe('')
    expect(result.current.translation).toBe('')
    expect(result.current.genre).toBe('narrative')
    expect(result.current.topic).toBe('campus')
    expect(result.current.difficulty).toBe('medium')
    expect(result.current.translating).toBe(false)
    expect(result.current.saving).toBe(false)
    expect(result.current.error).toBe('')
    expect(result.current.toast).toBe('')
    expect(result.current.translationHintIndex).toBe(0)
    expect(result.current.canSave).toBe(false)
    expect(result.current.canShowAITranslate).toBe(false)
  })

  it('派生状态：正文达标后才可 AI 翻译，翻译非空后隐藏按钮', () => {
    const { result } = renderForm()

    act(() => {
      result.current.setContent('short')
    })
    expect(result.current.canShowAITranslate).toBe(false)

    act(() => {
      result.current.setContent(LONG_CONTENT)
    })
    expect(result.current.canShowAITranslate).toBe(true)
    expect(result.current.canSave).toBe(false)

    act(() => {
      result.current.setTitle('My Day')
    })
    expect(result.current.canSave).toBe(true)

    act(() => {
      result.current.setTranslation('已有翻译')
    })
    expect(result.current.canShowAITranslate).toBe(false)
  })

  it('AI 翻译成功：写入译文并结束翻译态', async () => {
    const { result } = renderForm()
    act(() => {
      result.current.setContent(`  ${LONG_CONTENT}  `)
    })

    await act(async () => {
      await result.current.handleAITranslate()
    })

    expect(translateMock).toHaveBeenCalledWith(LONG_CONTENT)
    expect(result.current.translation).toBe('汤姆每天去上学。')
    expect(result.current.translating).toBe(false)
    expect(result.current.error).toBe('')
  })

  it('AI 翻译进度提示：每 4 秒切换文案并循环', async () => {
    vi.useFakeTimers()
    let resolveTranslation!: (value: string) => void
    translateMock.mockReturnValue(
      new Promise<string>((resolve) => {
        resolveTranslation = resolve
      }),
    )
    const { result } = renderForm()
    act(() => {
      result.current.setContent(LONG_CONTENT)
    })

    let pending!: Promise<void>
    act(() => {
      pending = result.current.handleAITranslate()
    })
    expect(result.current.translating).toBe(true)

    act(() => {
      vi.advanceTimersByTime(4000)
    })
    expect(result.current.translationHintIndex).toBe(1)
    act(() => {
      vi.advanceTimersByTime(4000)
    })
    expect(result.current.translationHintIndex).toBe(2)

    await act(async () => {
      resolveTranslation('译文')
      await pending
    })
    expect(result.current.translation).toBe('译文')
    expect(result.current.translating).toBe(false)
    // 定时器已清理，不再推进
    act(() => {
      vi.advanceTimersByTime(8000)
    })
    expect(result.current.translationHintIndex).toBe(2)
  })

  it('AI 翻译守卫：正文过短或翻译进行中不发起请求', async () => {
    const { result } = renderForm()
    act(() => {
      result.current.setContent('too short')
    })
    await act(async () => {
      await result.current.handleAITranslate()
    })
    expect(translateMock).not.toHaveBeenCalled()

    act(() => {
      result.current.setContent(LONG_CONTENT)
    })
    let resolveTranslation!: (value: string) => void
    translateMock.mockReturnValue(
      new Promise<string>((resolve) => {
        resolveTranslation = resolve
      }),
    )
    let pending!: Promise<void>
    act(() => {
      pending = result.current.handleAITranslate()
    })
    await act(async () => {
      await result.current.handleAITranslate()
    })
    expect(translateMock).toHaveBeenCalledTimes(1)

    await act(async () => {
      resolveTranslation('译文')
      await pending
    })
  })

  it('AI 翻译失败：告警并展示错误，支持非 Error 兜底', async () => {
    translateMock.mockRejectedValue(new Error('翻译服务不可用'))
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { result } = renderForm()
    act(() => {
      result.current.setContent(LONG_CONTENT)
    })

    await act(async () => {
      await result.current.handleAITranslate()
    })

    expect(warnSpy).toHaveBeenCalledWith(
      '[AddArticleModal] AI 翻译失败',
      expect.any(Error),
    )
    expect(result.current.error).toBe('翻译服务不可用')
    expect(result.current.translating).toBe(false)

    translateMock.mockRejectedValue('oops')
    await act(async () => {
      await result.current.handleAITranslate()
    })
    expect(result.current.error).toBe('AI 翻译失败，可手动填写')
  })

  it('保存成功：构造完整文章实体并在 1 秒后关闭', async () => {
    vi.useFakeTimers()
    const { result, onClose } = renderForm()
    act(() => {
      result.current.setTitle('  My Day  ')
      result.current.setContent(`  ${LONG_CONTENT}  `)
      result.current.setTranslation('  我的一天  ')
      result.current.setGenre('expository')
      result.current.setTopic('science')
      result.current.setDifficulty('hard')
    })

    await act(async () => {
      await result.current.handleSave()
    })

    expect(saveMock).toHaveBeenCalledTimes(1)
    const saved = saveMock.mock.calls[0][0]
    expect(saved).toMatchObject({
      title: 'My Day',
      content: LONG_CONTENT,
      translation: '我的一天',
      genre: 'expository',
      topic: 'science',
      difficulty: 'hard',
      lexileRange: { min: 600, max: 800 },
      highlightedWords: [],
      readAt: null,
      startedAt: null,
    })
    expect(saved.id).toMatch(/^user-\d+$/)
    expect(saved.wordCount).toBe(LONG_CONTENT.split(/\s+/).filter(Boolean).length)
    expect(result.current.toast).toBe('已添加')
    expect(result.current.saving).toBe(false)
    expect(onClose).not.toHaveBeenCalled()

    act(() => {
      vi.advanceTimersByTime(1000)
    })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('保存守卫：缺少标题、正文过短或保存中均不发起请求', async () => {
    const { result } = renderForm()
    act(() => {
      result.current.setContent(LONG_CONTENT)
    })
    await act(async () => {
      await result.current.handleSave()
    })
    expect(saveMock).not.toHaveBeenCalled()

    act(() => {
      result.current.setContent('short')
      result.current.setTitle('Title')
    })
    await act(async () => {
      await result.current.handleSave()
    })
    expect(saveMock).not.toHaveBeenCalled()

    act(() => {
      result.current.setContent(LONG_CONTENT)
    })
    let resolveSave!: (value: Article) => void
    saveMock.mockReturnValue(
      new Promise<Article>((resolve) => {
        resolveSave = resolve
      }),
    )
    let pending!: Promise<void>
    act(() => {
      pending = result.current.handleSave()
    })
    await act(async () => {
      await result.current.handleSave()
    })
    expect(saveMock).toHaveBeenCalledTimes(1)
    expect(result.current.saving).toBe(true)

    await act(async () => {
      resolveSave({} as Article)
      await pending
    })
  })

  it('保存失败：告警、展示错误并恢复保存态', async () => {
    saveMock.mockRejectedValue(new Error('写入失败'))
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { result } = renderForm()
    act(() => {
      result.current.setTitle('Title')
      result.current.setContent(LONG_CONTENT)
    })

    await act(async () => {
      await result.current.handleSave()
    })

    expect(warnSpy).toHaveBeenCalledWith(
      '[AddArticleModal] 保存失败',
      expect.any(Error),
    )
    expect(result.current.error).toBe('写入失败')
    expect(result.current.saving).toBe(false)

    saveMock.mockRejectedValue('oops')
    await act(async () => {
      await result.current.handleSave()
    })
    expect(result.current.error).toBe('保存失败，请重试')
  })

  it('关闭：重置全部字段并清理自动关闭定时器', async () => {
    vi.useFakeTimers()
    const onClose = vi.fn()
    const { result } = renderForm(true, onClose)
    act(() => {
      result.current.setTitle('Title')
      result.current.setContent(LONG_CONTENT)
      result.current.setTranslation('译文')
      result.current.setGenre('practical')
      result.current.setTopic('travel')
      result.current.setDifficulty('easy')
    })

    await act(async () => {
      await result.current.handleSave()
    })
    expect(result.current.toast).toBe('已添加')

    act(() => {
      result.current.handleClose()
    })

    expect(onClose).toHaveBeenCalledTimes(1)
    expect(result.current.title).toBe('')
    expect(result.current.content).toBe('')
    expect(result.current.translation).toBe('')
    expect(result.current.genre).toBe('narrative')
    expect(result.current.topic).toBe('campus')
    expect(result.current.difficulty).toBe('medium')
    expect(result.current.toast).toBe('')

    // 自动关闭定时器已被清理
    act(() => {
      vi.advanceTimersByTime(2000)
    })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('Escape 关闭：open 为 true 时生效，false 时不监听', () => {
    const { result, onClose, rerender } = renderForm(false)

    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    })
    expect(onClose).not.toHaveBeenCalled()

    rerender({ open: true })
    act(() => {
      result.current.setTitle('Title')
    })
    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    })
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(result.current.title).toBe('')
  })

  it('打开时锁定背景滚动，关闭 / 卸载后恢复', () => {
    const { rerender, unmount } = renderForm(true)
    expect(document.body.style.overflow).toBe('hidden')

    rerender({ open: false })
    expect(document.body.style.overflow).toBe('')

    rerender({ open: true })
    expect(document.body.style.overflow).toBe('hidden')
    unmount()
    expect(document.body.style.overflow).toBe('')
  })

  it('卸载时清理保存后的自动关闭定时器', async () => {
    const onClose = vi.fn()
    const { result, unmount } = renderForm(true, onClose)
    act(() => {
      result.current.setTitle('Title')
      result.current.setContent(LONG_CONTENT)
    })

    await act(async () => {
      await result.current.handleSave()
    })
    expect(result.current.toast).toBe('已添加')

    unmount()
    vi.useFakeTimers()
    act(() => {
      vi.advanceTimersByTime(2000)
    })
    expect(onClose).not.toHaveBeenCalled()
  })

  it('导出常量：最小正文长度与翻译提示文案', () => {
    expect(MIN_CONTENT_LENGTH).toBe(50)
    expect(TRANSLATION_HINTS).toHaveLength(5)
    expect(TRANSLATION_HINTS[0]).toBe('正在分析正文...')
  })
})
