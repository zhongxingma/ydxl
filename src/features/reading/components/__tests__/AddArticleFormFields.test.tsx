// AddArticleFormFields 添加文章表单字段单元测试
//
// 覆盖场景：
// 1. 标题 / 正文 / 翻译 / 文体 / 题材 / 难度渲染与当前值
// 2. 各输入与下拉变更回调
// 3. AI 翻译中遮罩、提示轮播与按钮禁用
// 4. AI 补全按钮显隐与点击
// 5. 错误与成功 toast 展示
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import type { AddArticleFormState } from '../../hooks/useAddArticleForm'
import AddArticleFormFields from '../AddArticleFormFields'

vi.mock('@/shared/components/AIProviderBadge', () => ({
  default: ({ scenario }: { scenario: string }) => (
    <span data-testid="ai-badge">{scenario}</span>
  ),
}))

function makeForm(
  overrides: Partial<AddArticleFormState> = {}
): AddArticleFormState {
  const form = {
    title: 'A Brave Boy',
    setTitle: vi.fn(),
    content: 'abcde',
    setContent: vi.fn(),
    translation: '',
    setTranslation: vi.fn(),
    genre: 'narrative',
    setGenre: vi.fn(),
    topic: 'campus',
    setTopic: vi.fn(),
    difficulty: 'medium',
    setDifficulty: vi.fn(),
    translating: false,
    translationHintIndex: 0,
    error: null,
    toast: null,
    canShowAITranslate: false,
    handleAITranslate: vi.fn(),
    ...overrides,
  }
  return form as unknown as AddArticleFormState
}

describe('AddArticleFormFields 添加文章表单字段', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('渲染标题、正文、翻译与三个下拉的当前值', () => {
    const form = makeForm({ translation: '从前有个勇敢的男孩。' })
    render(<AddArticleFormFields form={form} />)

    expect(screen.getByDisplayValue('A Brave Boy')).toBeInTheDocument()
    expect(screen.getByDisplayValue('abcde')).toBeInTheDocument()
    expect(screen.getByDisplayValue('从前有个勇敢的男孩。')).toBeInTheDocument()
    expect(screen.getByText(/（至少 50 字符，当前 5 字符）/)).toBeInTheDocument()
    expect(screen.getAllByRole('combobox')).toHaveLength(3)
    expect(screen.getByText('记叙文')).toBeInTheDocument()
    expect(screen.getByText('校园')).toBeInTheDocument()
    expect(screen.getByText('中等')).toBeInTheDocument()
    expect(screen.getByTestId('ai-badge')).toHaveTextContent('translation')
  })

  it('输入标题、正文与翻译时分别调用 setter', () => {
    const form = makeForm()
    render(<AddArticleFormFields form={form} />)

    fireEvent.change(screen.getByPlaceholderText('请输入文章标题'), {
      target: { value: 'New Title' },
    })
    expect(form.setTitle).toHaveBeenCalledWith('New Title')

    fireEvent.change(
      screen.getByPlaceholderText('请输入英文正文（至少 50 字符）'),
      { target: { value: 'new body' } }
    )
    expect(form.setContent).toHaveBeenCalledWith('new body')

    fireEvent.change(
      screen.getByPlaceholderText('请输入中文翻译（可选，可点击下方 AI 补全）'),
      { target: { value: '新译文' } }
    )
    expect(form.setTranslation).toHaveBeenCalledWith('新译文')
  })

  it('切换文体、题材与难度', () => {
    const form = makeForm()
    render(<AddArticleFormFields form={form} />)

    const [genre, topic, difficulty] = screen.getAllByRole('combobox')

    fireEvent.change(genre, { target: { value: 'expository' } })
    expect(form.setGenre).toHaveBeenCalledWith('expository')

    fireEvent.change(topic, { target: { value: 'science' } })
    expect(form.setTopic).toHaveBeenCalledWith('science')

    fireEvent.change(difficulty, { target: { value: 'hard' } })
    expect(form.setDifficulty).toHaveBeenCalledWith('hard')
  })

  it('翻译中展示提示轮播、遮罩与禁用按钮', () => {
    const form = makeForm({
      translating: true,
      translationHintIndex: 1,
      canShowAITranslate: true,
    })
    render(<AddArticleFormFields form={form} />)

    const translationArea = screen.getByPlaceholderText(
      '请输入中文翻译（可选，可点击下方 AI 补全）'
    )
    expect(translationArea.className).toContain('opacity-50')

    const button = screen.getByRole('button', { name: /AI 翻译中…/ })
    expect(button).toBeDisabled()
    // 提示轮播文案存在（任一提示即可说明遮罩已渲染）
    expect(document.querySelector('.animate-spin')).not.toBeNull()
  })

  it('可翻译时点击 AI 补全按钮触发回调', () => {
    const form = makeForm({ canShowAITranslate: true })
    render(<AddArticleFormFields form={form} />)

    const button = screen.getByRole('button', { name: 'AI 补全翻译' })
    expect(button).toBeEnabled()

    fireEvent.click(button)
    expect(form.handleAITranslate).toHaveBeenCalledTimes(1)
  })

  it('不满足翻译条件时不展示 AI 补全按钮', () => {
    render(<AddArticleFormFields form={makeForm({ canShowAITranslate: false })} />)

    expect(
      screen.queryByRole('button', { name: /AI 补全翻译|AI 翻译中…/ })
    ).not.toBeInTheDocument()
  })

  it('展示错误与成功 toast', () => {
    render(
      <AddArticleFormFields
        form={makeForm({ error: '保存失败', toast: '保存成功' })}
      />
    )

    expect(screen.getByText('保存失败')).toBeInTheDocument()
    expect(screen.getByText('保存成功')).toBeInTheDocument()
  })
})
