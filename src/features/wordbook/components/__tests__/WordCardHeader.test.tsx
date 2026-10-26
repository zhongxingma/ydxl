// WordCardHeader 生词卡片头部单元测试
//
// 覆盖场景：
// 1. 单词、音标、收藏星标与掌握 / 顽固词徽章
// 2. 收藏切换成功、失败提示与进行中防重复
// 3. 发音按钮支持性与朗读调用
//
// Mock 策略：mock toggleFavorite 与语音工具，聚焦头部交互。
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import type { Word } from '@/shared/types'
import WordCardHeader from '../WordCardHeader'
import { toggleFavorite } from '../../services/wordbookService'
import { speak, isSpeechSupported } from '@/shared/utils/speech'

vi.mock('../../services/wordbookService', () => ({
  toggleFavorite: vi.fn(),
}))

vi.mock('@/shared/utils/speech', () => ({
  speak: vi.fn(),
  isSpeechSupported: vi.fn(() => true),
}))

const toggleFavoriteMock = vi.mocked(toggleFavorite)
const speakMock = vi.mocked(speak)
const isSpeechSupportedMock = vi.mocked(isSpeechSupported)

function makeWord(overrides: Partial<Word> = {}): Word {
  const now = Date.now()
  return {
    id: 'apple',
    updated_at: now,
    word: 'apple',
    phonetic: '/ˈæpl/',
    pos: 'n.',
    definition: '苹果',
    example: '',
    mastery: 0,
    nextReview: now,
    lastReview: now,
    reviewCount: 0,
    interval: 1,
    easeFactor: 2.5,
    createdAt: now,
    ...overrides,
  }
}

function renderHeader(
  options: {
    word?: Word
    isMastered?: boolean
    isStubborn?: boolean
    onRefresh?: () => void
    showToast?: (msg: string) => void
  } = {}
) {
  const onRefresh = options.onRefresh ?? vi.fn()
  const showToast = options.showToast ?? vi.fn()
  const view = render(
    <WordCardHeader
      word={options.word ?? makeWord()}
      isMastered={options.isMastered ?? false}
      isStubborn={options.isStubborn ?? false}
      onRefresh={onRefresh}
      showToast={showToast}
    />
  )
  return { ...view, onRefresh, showToast }
}

describe('WordCardHeader 生词卡片头部', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    toggleFavoriteMock.mockResolvedValue(undefined)
    isSpeechSupportedMock.mockReturnValue(true)
  })

  it('渲染单词、音标与未收藏星标', () => {
    renderHeader()

    expect(screen.getByText('apple')).toBeInTheDocument()
    expect(screen.getByText('/ˈæpl/')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '收藏单词' })).toBeInTheDocument()
  })

  it('已收藏时展示取消收藏入口', () => {
    renderHeader({ word: makeWord({ favorite: 1 }) })

    const button = screen.getByRole('button', { name: '取消收藏' })
    expect(button).toHaveAttribute('title', '取消收藏')
    expect(button.className).toContain('text-yellow-500')
  })

  it('收藏成功刷新列表', async () => {
    const { onRefresh } = renderHeader()

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '收藏单词' }))
    })

    expect(toggleFavoriteMock).toHaveBeenCalledWith('apple')
    expect(onRefresh).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('button', { name: '收藏单词' })).toBeEnabled()
  })

  it('收藏失败时提示并恢复按钮', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const showToast = vi.fn()
    toggleFavoriteMock.mockRejectedValue(new Error('network'))
    renderHeader({ showToast })

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '收藏单词' }))
    })

    expect(showToast).toHaveBeenCalledWith('收藏操作失败')
    expect(screen.getByRole('button', { name: '收藏单词' })).toBeEnabled()
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('收藏操作失败'),
      expect.any(Error)
    )
    warn.mockRestore()
  })

  it('收藏进行中禁用按钮并防重复点击', async () => {
    let resolveToggle: (() => void) | undefined
    toggleFavoriteMock.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveToggle = resolve
        })
    )
    renderHeader()

    fireEvent.click(screen.getByRole('button', { name: '收藏单词' }))

    const pending = screen.getByRole('button', { name: '收藏单词' })
    expect(pending).toBeDisabled()

    fireEvent.click(pending)
    expect(toggleFavoriteMock).toHaveBeenCalledTimes(1)

    await act(async () => {
      resolveToggle?.()
    })
    expect(screen.getByRole('button', { name: '收藏单词' })).toBeEnabled()
  })

  it('支持语音时点击朗读单词', () => {
    renderHeader()

    const button = screen.getByRole('button', { name: '朗读 apple' })
    expect(button).toBeEnabled()
    expect(button).toHaveAttribute('title', '朗读单词')

    fireEvent.click(button)
    expect(speakMock).toHaveBeenCalledWith('apple', 1)
  })

  it('不支持语音时朗读按钮禁用并提示', () => {
    isSpeechSupportedMock.mockReturnValue(false)
    renderHeader()

    const button = screen.getByRole('button', { name: '朗读 apple' })
    expect(button).toBeDisabled()
    expect(button).toHaveAttribute('title', '当前浏览器不支持语音朗读')
  })

  it('按状态展示已掌握与顽固词徽章', () => {
    renderHeader({ isMastered: true, isStubborn: true })

    expect(screen.getByText('✓ 已掌握')).toBeInTheDocument()
    expect(screen.getByText('顽固词')).toBeInTheDocument()
  })

  it('缺少音标时不渲染音标文本', () => {
    renderHeader({ word: makeWord({ phonetic: '' }) })

    expect(screen.queryByText('/ˈæpl/')).not.toBeInTheDocument()
  })
})
