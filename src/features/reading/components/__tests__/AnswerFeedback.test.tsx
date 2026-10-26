// AnswerFeedback 答题反馈组件单元测试
//
// 覆盖场景：
// 1. 得分与正确率计算（含空题目除零兜底）
// 2. 每题正误徽章与题干渲染
// 3. 详解展开 / 收起及选项正误标注
// 4. 未作答按错误处理且不标记错误选项
// 5. 原文定位线索与跳转回调、解析文案的条件展示
// 6. 重新答题回调
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import type { Question } from '@/shared/types'
import AnswerFeedback from '../AnswerFeedback'

function makeQuestion(id: string, overrides: Partial<Question> = {}): Question {
  return {
    id,
    updated_at: Date.now(),
    articleId: 'a1',
    type: 'detail',
    stem: `题干 ${id}`,
    options: ['选项 A', '选项 B', '选项 C', '选项 D'],
    correctIndex: 1,
    explanation: `解析 ${id}`,
    locationClue: `线索 ${id}`,
    createdAt: Date.now(),
    ...overrides,
  }
}

describe('AnswerFeedback 答题反馈', () => {
  it('计算得分与正确率并渲染每题正误', () => {
    render(
      <AnswerFeedback
        questions={[
          makeQuestion('q1', { stem: '第一题' }),
          makeQuestion('q2', { stem: '第二题', correctIndex: 2 }),
        ]}
        answers={{ 0: 1, 1: 0 }}
        onRetry={vi.fn()}
      />
    )

    expect(screen.getByText('1 / 2')).toBeInTheDocument()
    expect(screen.getByText('50%')).toBeInTheDocument()
    expect(screen.getByText('第一题')).toBeInTheDocument()
    expect(screen.getByText('第二题')).toBeInTheDocument()
    expect(screen.getByText('正确')).toBeInTheDocument()
    expect(screen.getByText('错误')).toBeInTheDocument()
    expect(screen.getAllByText('细节题')).toHaveLength(2)
  })

  it('无题目时得分与正确率均为 0', () => {
    render(<AnswerFeedback questions={[]} answers={{}} onRetry={vi.fn()} />)

    expect(screen.getByText('0 / 0')).toBeInTheDocument()
    expect(screen.getByText('0%')).toBeInTheDocument()
  })

  it('点击题干展开详解并标注正确项与用户错误选项', () => {
    render(
      <AnswerFeedback
        questions={[
          makeQuestion('q1', {
            stem: '展开题',
            options: ['错选', '正确项', '其它', '其它二'],
            correctIndex: 1,
          }),
        ]}
        answers={{ 0: 0 }}
        onRetry={vi.fn()}
      />
    )

    expect(screen.queryByText('原文定位线索')).not.toBeInTheDocument()
    expect(screen.getByText('详解')).toBeInTheDocument()

    fireEvent.click(screen.getByText('展开题'))

    expect(screen.getByText('收起')).toBeInTheDocument()
    expect(screen.getByText('原文定位线索')).toBeInTheDocument()
    expect(screen.getByText('解析（含正确项依据 / 干扰项排除原因）')).toBeInTheDocument()
    expect(screen.getByText('解析 q1')).toBeInTheDocument()

    const correctRow = screen.getByText('正确项').closest('div')
    const wrongRow = screen.getByText('错选').closest('div')
    expect(correctRow?.className).toContain('border-emerald-300')
    expect(wrongRow?.className).toContain('border-rose-300')

    fireEvent.click(screen.getByText('展开题'))
    expect(screen.queryByText('原文定位线索')).not.toBeInTheDocument()
  })

  it('未作答按错误处理，仅标注正确选项', () => {
    render(
      <AnswerFeedback
        questions={[makeQuestion('q1', { stem: '未答题' })]}
        answers={{}}
        onRetry={vi.fn()}
      />
    )

    expect(screen.getByText('错误')).toBeInTheDocument()

    fireEvent.click(screen.getByText('未答题'))

    const correctRow = screen.getByText('选项 B').closest('div')
    expect(correctRow?.className).toContain('border-emerald-300')
    // 未作答不应把任何选项标为错误
    expect(screen.queryByText('选项 A')?.closest('div')?.className).not.toContain(
      'border-rose-300'
    )
  })

  it('点击跳转回原文按钮回传原文线索', () => {
    const onLocateInArticle = vi.fn()
    render(
      <AnswerFeedback
        questions={[makeQuestion('q1', { locationClue: '第二段第一句' })]}
        answers={{ 0: 1 }}
        onRetry={vi.fn()}
        onLocateInArticle={onLocateInArticle}
      />
    )

    fireEvent.click(screen.getByText('题干 q1'))
    fireEvent.click(screen.getByRole('button', { name: '跳转回原文' }))

    expect(onLocateInArticle).toHaveBeenCalledWith('第二段第一句')
  })

  it('未提供跳转回调时不展示跳转按钮', () => {
    render(
      <AnswerFeedback
        questions={[makeQuestion('q1')]}
        answers={{ 0: 1 }}
        onRetry={vi.fn()}
      />
    )

    fireEvent.click(screen.getByText('题干 q1'))

    expect(
      screen.queryByRole('button', { name: '跳转回原文' })
    ).not.toBeInTheDocument()
  })

  it('缺少原文线索与解析时不展示对应区块', () => {
    render(
      <AnswerFeedback
        questions={[
          makeQuestion('q1', { stem: '无解析题', locationClue: '', explanation: '' }),
        ]}
        answers={{ 0: 1 }}
        onRetry={vi.fn()}
      />
    )

    fireEvent.click(screen.getByText('无解析题'))

    expect(screen.queryByText('原文定位线索')).not.toBeInTheDocument()
    expect(
      screen.queryByText('解析（含正确项依据 / 干扰项排除原因）')
    ).not.toBeInTheDocument()
    expect(screen.getByText('选项 A')).toBeInTheDocument()
  })

  it('点击重新答题触发回调', () => {
    const onRetry = vi.fn()
    render(<AnswerFeedback questions={[]} answers={{}} onRetry={onRetry} />)

    fireEvent.click(screen.getByRole('button', { name: '重新答题' }))

    expect(onRetry).toHaveBeenCalledTimes(1)
  })
})
