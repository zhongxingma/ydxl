// PerformanceAnalysis 组件单元测试（Task 5.2）
//
// 覆盖场景：
// 1. 各题型正确率计算（main_idea / detail / inference / word_guess）
// 2. 总评徽章阈值（≥85% 优秀 / 70-85% 良好 / <70% 加油）
// 3. 强弱项文案生成（识别最弱题型并展示建议，识别最强题型并展示鼓励）
// 4. 用时分析（总用时 + 平均每题用时）
// 5. 无题目时不渲染
// 6. 全对时仅展示强项，不展示弱项
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import PerformanceAnalysis from '../PerformanceAnalysis'
import type { Question } from '@/shared/types'

// ---------- 测试数据工厂 ----------

function makeQuestion(overrides: Partial<Question> = {}): Question {
  return {
    id: 'q-1',
    articleId: 'art-1',
    type: 'detail',
    stem: '题干',
    options: ['A', 'B', 'C', 'D'],
    correctIndex: 0,
    explanation: '解析',
    locationClue: '线索',
    createdAt: Date.now(),
    updated_at: Date.now(),
    ...overrides,
  }
}

// 构造多题型题目集：每种题型 1 题，共 4 题
function makeMixedQuestions(): Question[] {
  return [
    makeQuestion({ id: 'q-main', type: 'main_idea', correctIndex: 0 }),
    makeQuestion({ id: 'q-detail', type: 'detail', correctIndex: 1 }),
    makeQuestion({ id: 'q-infer', type: 'inference', correctIndex: 2 }),
    makeQuestion({ id: 'q-word', type: 'word_guess', correctIndex: 3 }),
  ]
}

describe('PerformanceAnalysis', () => {
  // 1. 各题型正确率计算
  it('各题型正确率分解：按题型分组计算 correct/total 与百分比', () => {
    const questions = makeMixedQuestions()
    // 全对：每个题型 1/1 = 100%
    const answers: Record<number, number> = { 0: 0, 1: 1, 2: 2, 3: 3 }

    render(
      <PerformanceAnalysis questions={questions} answers={answers} elapsedSec={120} />,
    )

    // 每个题型标签都应出现
    expect(screen.getByText('主旨题')).toBeInTheDocument()
    expect(screen.getByText('细节题')).toBeInTheDocument()
    expect(screen.getByText('推断题')).toBeInTheDocument()
    expect(screen.getByText('词义猜测题')).toBeInTheDocument()

    // 每个题型应为 1/1 (100%)
    // 正确率数字格式：1/1 (100%)
    expect(screen.getAllByText(/1\/1/)).toHaveLength(4)
    expect(screen.getAllByText(/\(100%\)/)).toHaveLength(4)
  })

  // 2. 总评徽章阈值：≥85% 优秀
  it('总评徽章：正确率 100% 时显示「优秀」', () => {
    const questions = makeMixedQuestions()
    const answers: Record<number, number> = { 0: 0, 1: 1, 2: 2, 3: 3 }

    render(
      <PerformanceAnalysis questions={questions} answers={answers} elapsedSec={60} />,
    )

    expect(screen.getByText(/总评：优秀/)).toBeInTheDocument()
  })

  // 2. 总评徽章阈值：70-85% 良好
  it('总评徽章：正确率 75% 时显示「良好」', () => {
    // 4 题，3 对 1 错 = 75%
    const questions = makeMixedQuestions()
    const answers: Record<number, number> = {
      0: 0, // main_idea 对
      1: 1, // detail 对
      2: 2, // inference 对
      3: 0, // word_guess 错（正确为 3）
    }

    render(
      <PerformanceAnalysis questions={questions} answers={answers} elapsedSec={90} />,
    )

    expect(screen.getByText(/总评：良好/)).toBeInTheDocument()
  })

  // 2. 总评徽章阈值：<70% 加油
  it('总评徽章：正确率 50% 时显示「加油」', () => {
    // 4 题，2 对 2 错 = 50%
    const questions = makeMixedQuestions()
    const answers: Record<number, number> = {
      0: 0, // 对
      1: 0, // 错
      2: 2, // 对
      3: 0, // 错
    }

    render(
      <PerformanceAnalysis questions={questions} answers={answers} elapsedSec={120} />,
    )

    expect(screen.getByText(/总评：加油/)).toBeInTheDocument()
  })

  // 3. 强弱项文案生成：识别最弱题型并展示建议
  it('强弱项分析：word_guess 错误时展示「待提升」标签与针对性建议', () => {
    const questions = makeMixedQuestions()
    const answers: Record<number, number> = {
      0: 0, // main_idea 对
      1: 1, // detail 对
      2: 2, // inference 对
      3: 0, // word_guess 错（正确为 3）
    }

    render(
      <PerformanceAnalysis questions={questions} answers={answers} elapsedSec={60} />,
    )

    // 应展示「待提升」标签
    expect(screen.getByText('待提升')).toBeInTheDocument()
    // word_guess 题型的建议文案应出现
    expect(screen.getByText(/词义猜测题（0%）：/)).toBeInTheDocument()
    expect(screen.getByText(/根据词根词缀与上下文语境猜测词义/)).toBeInTheDocument()
  })

  // 3. 强弱项文案生成：识别最强题型并展示鼓励
  it('强弱项分析：main_idea 全对且达良好阈值时展示「强项」标签与鼓励文案', () => {
    const questions = makeMixedQuestions()
    const answers: Record<number, number> = {
      0: 0, // main_idea 对（100%）
      1: 0, // detail 错
      2: 0, // inference 错
      3: 0, // word_guess 错
    }

    render(
      <PerformanceAnalysis questions={questions} answers={answers} elapsedSec={60} />,
    )

    // 应展示「强项」标签
    expect(screen.getByText('强项')).toBeInTheDocument()
    // main_idea 题型的鼓励文案应出现
    expect(screen.getByText(/主旨题（100%）：/)).toBeInTheDocument()
    expect(screen.getByText(/主旨把握准确/)).toBeInTheDocument()
  })

  // 4. 用时分析：总用时 + 平均每题用时
  it('用时分析：显示总用时与平均每题用时', () => {
    const questions = makeMixedQuestions() // 4 题
    const answers: Record<number, number> = { 0: 0, 1: 1, 2: 2, 3: 3 }
    // 120 秒 / 4 题 = 30 秒/题

    render(
      <PerformanceAnalysis questions={questions} answers={answers} elapsedSec={120} />,
    )

    // 总用时 02:00
    expect(screen.getByText('02:00', { exact: false })).toBeInTheDocument()
    // 平均每题用时 00:30
    expect(screen.getByText(/00:30/)).toBeInTheDocument()
  })

  // 5. 无题目时不渲染
  it('无题目时不渲染（避免除零与空数据展示）', () => {
    const { container } = render(
      <PerformanceAnalysis questions={[]} answers={{}} elapsedSec={0} />,
    )

    // 容器内不应有成绩分析 section
    expect(container.firstChild).toBeNull()
  })

  // 6. 全对时仅展示强项，不展示弱项
  it('全对时不展示「待提升」标签（无弱项）', () => {
    const questions = makeMixedQuestions()
    const answers: Record<number, number> = { 0: 0, 1: 1, 2: 2, 3: 3 }

    render(
      <PerformanceAnalysis questions={questions} answers={answers} elapsedSec={60} />,
    )

    // 不应出现「待提升」标签
    expect(screen.queryByText('待提升')).not.toBeInTheDocument()
  })

  // 7. 边界：85% 阈值边界（4 题无法精确到 85%，改用 20 题测试）
  it('总评徽章阈值边界：85% 显示「优秀」', () => {
    // 20 题，17 对 3 错 = 85%
    const questions: Question[] = []
    const answers: Record<number, number> = {}
    for (let i = 0; i < 20; i++) {
      questions.push(
        makeQuestion({
          id: `q-${i}`,
          type: i % 4 === 0 ? 'main_idea' : i % 4 === 1 ? 'detail' : i % 4 === 2 ? 'inference' : 'word_guess',
          correctIndex: 0,
        }),
      )
      answers[i] = i < 17 ? 0 : 1 // 前 17 对，后 3 错
    }

    render(
      <PerformanceAnalysis questions={questions} answers={answers} elapsedSec={600} />,
    )

    expect(screen.getByText(/总评：优秀/)).toBeInTheDocument()
  })

  // 8. 边界：70% 阈值边界
  it('总评徽章阈值边界：70% 显示「良好」', () => {
    // 20 题，14 对 6 错 = 70%
    const questions: Question[] = []
    const answers: Record<number, number> = {}
    for (let i = 0; i < 20; i++) {
      questions.push(
        makeQuestion({
          id: `q-${i}`,
          type: i % 4 === 0 ? 'main_idea' : i % 4 === 1 ? 'detail' : i % 4 === 2 ? 'inference' : 'word_guess',
          correctIndex: 0,
        }),
      )
      answers[i] = i < 14 ? 0 : 1 // 前 14 对，后 6 错
    }

    render(
      <PerformanceAnalysis questions={questions} answers={answers} elapsedSec={600} />,
    )

    expect(screen.getByText(/总评：良好/)).toBeInTheDocument()
  })

  // 9. 仅一种题型时不重复展示强弱项
  it('仅一种题型时：全对则不展示强弱项标签（无对比）', () => {
    const questions = [makeQuestion({ id: 'q-0', type: 'detail', correctIndex: 0 })]
    const answers: Record<number, number> = { 0: 0 }

    render(
      <PerformanceAnalysis questions={questions} answers={answers} elapsedSec={30} />,
    )

    // 全对时无弱项，不应展示「待提升」
    expect(screen.queryByText('待提升')).not.toBeInTheDocument()
  })

  // 10. 仅一种题型时答错展示弱项
  it('仅一种题型时：答错则展示「待提升」标签', () => {
    const questions = [makeQuestion({ id: 'q-0', type: 'detail', correctIndex: 0 })]
    const answers: Record<number, number> = { 0: 1 } // 错

    render(
      <PerformanceAnalysis questions={questions} answers={answers} elapsedSec={30} />,
    )

    expect(screen.getByText('待提升')).toBeInTheDocument()
    expect(screen.getByText(/细节题（0%）：/)).toBeInTheDocument()
  })
})
