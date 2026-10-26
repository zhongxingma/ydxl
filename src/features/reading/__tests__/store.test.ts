// 阅读模块 Zustand store 单元测试
//
// 覆盖场景：
// 1. 初始状态默认值与视图切换
// 2. 作答记录、下一题 / 上一题 / 跳题
// 3. 计时器：启动幂等、暂停 / 恢复累计、有效时长计算与暂停中不计时
// 4. 逐句翻译开关（Set 实例不可变更新）
// 5. reset 恢复初始状态并创建新的 Set；标记会话已记录
//
// 环境依赖：Zustand store 为模块级单例，每个用例前 reset
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { useReadingStore } from '../store'

describe('useReadingStore 阅读状态', () => {
  beforeEach(() => {
    useReadingStore.getState().reset()
  })

  it('初始状态：阅读视图、无作答、未开始计时', () => {
    const state = useReadingStore.getState()

    expect(state.view).toBe('reading')
    expect(state.currentQuestionIndex).toBe(0)
    expect(state.answers).toEqual({})
    expect(state.startTime).toBe(0)
    expect(state.pausedDuration).toBe(0)
    expect(state.pauseStartedAt).toBe(0)
    expect(state.sentenceTranslationVisible.size).toBe(0)
    expect(state.sessionRecorded).toBe(false)
  })

  it('setView 与 setAnswer 更新视图和作答记录', () => {
    useReadingStore.getState().setView('quiz')
    useReadingStore.getState().setAnswer(0, 2)
    useReadingStore.getState().setAnswer(1, 1)

    expect(useReadingStore.getState().view).toBe('quiz')
    expect(useReadingStore.getState().answers).toEqual({ 0: 2, 1: 1 })
  })

  it('nextQuestion 非最后一题推进索引，最后一题进入成绩单', () => {
    useReadingStore.getState().nextQuestion(3)
    expect(useReadingStore.getState().currentQuestionIndex).toBe(1)
    expect(useReadingStore.getState().view).toBe('reading')

    useReadingStore.getState().nextQuestion(2)
    expect(useReadingStore.getState().view).toBe('result')
  })

  it('prevQuestion 仅在索引大于 0 时回退', () => {
    useReadingStore.getState().prevQuestion()
    expect(useReadingStore.getState().currentQuestionIndex).toBe(0)

    useReadingStore.setState({ currentQuestionIndex: 2 })
    useReadingStore.getState().prevQuestion()
    expect(useReadingStore.getState().currentQuestionIndex).toBe(1)
  })

  it('goToQuestion 跳转索引并切换到答题视图', () => {
    useReadingStore.getState().goToQuestion(4)

    expect(useReadingStore.getState().currentQuestionIndex).toBe(4)
    expect(useReadingStore.getState().view).toBe('quiz')
  })

  it('startTimer 仅在未开始时启动，重复调用不重置', () => {
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(1000)

    useReadingStore.getState().startTimer()
    expect(useReadingStore.getState().startTime).toBe(1000)

    nowSpy.mockReturnValue(2000)
    useReadingStore.getState().startTimer()
    expect(useReadingStore.getState().startTime).toBe(1000)
    nowSpy.mockRestore()
  })

  it('pauseTimer 未开始或已暂停时不记录，恢复时累计暂停时长', () => {
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(0)

    // 未开始：暂停无效
    useReadingStore.getState().pauseTimer()
    expect(useReadingStore.getState().pauseStartedAt).toBe(0)

    nowSpy.mockReturnValue(1000)
    useReadingStore.getState().startTimer()
    nowSpy.mockReturnValue(3000)
    useReadingStore.getState().pauseTimer()
    expect(useReadingStore.getState().pauseStartedAt).toBe(3000)

    // 已暂停：再次暂停无效
    nowSpy.mockReturnValue(4000)
    useReadingStore.getState().pauseTimer()
    expect(useReadingStore.getState().pauseStartedAt).toBe(3000)

    nowSpy.mockReturnValue(5000)
    useReadingStore.getState().resumeTimer()
    expect(useReadingStore.getState().pauseStartedAt).toBe(0)
    expect(useReadingStore.getState().pausedDuration).toBe(2000)
    nowSpy.mockRestore()
  })

  it('resumeTimer 未暂停时不做任何事', () => {
    useReadingStore.setState({ pausedDuration: 100 })

    useReadingStore.getState().resumeTimer()

    expect(useReadingStore.getState().pausedDuration).toBe(100)
    expect(useReadingStore.getState().pauseStartedAt).toBe(0)
  })

  it('getElapsedSec：未开始返回 0，运行中与暂停中按有效时长计算', () => {
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(0)
    expect(useReadingStore.getState().getElapsedSec()).toBe(0)

    nowSpy.mockReturnValue(10_000)
    useReadingStore.getState().startTimer()

    nowSpy.mockReturnValue(15_000)
    expect(useReadingStore.getState().getElapsedSec()).toBe(5)

    // 暂停中不计入暂停之后的时长
    nowSpy.mockReturnValue(16_000)
    useReadingStore.getState().pauseTimer()
    nowSpy.mockReturnValue(20_000)
    expect(useReadingStore.getState().getElapsedSec()).toBe(6)

    // 恢复后扣除累计暂停时长
    useReadingStore.getState().resumeTimer()
    nowSpy.mockReturnValue(25_000)
    expect(useReadingStore.getState().getElapsedSec()).toBe(11)
    nowSpy.mockRestore()
  })

  it('toggleSentenceTranslation 添加与移除句子索引', () => {
    useReadingStore.getState().toggleSentenceTranslation(3)
    expect(useReadingStore.getState().sentenceTranslationVisible.has(3)).toBe(true)

    const firstSet = useReadingStore.getState().sentenceTranslationVisible
    useReadingStore.getState().toggleSentenceTranslation(3)
    const secondSet = useReadingStore.getState().sentenceTranslationVisible
    expect(secondSet.has(3)).toBe(false)
    expect(secondSet).not.toBe(firstSet)
  })

  it('reset 恢复初始状态并创建新的翻译集合', () => {
    const before = useReadingStore.getState().sentenceTranslationVisible
    useReadingStore.setState({
      view: 'result',
      currentQuestionIndex: 3,
      answers: { 0: 1 },
      sentenceTranslationVisible: new Set([1]),
      sessionRecorded: true,
    })

    useReadingStore.getState().reset()

    const state = useReadingStore.getState()
    expect(state.view).toBe('reading')
    expect(state.currentQuestionIndex).toBe(0)
    expect(state.answers).toEqual({})
    expect(state.sentenceTranslationVisible.size).toBe(0)
    expect(state.sentenceTranslationVisible).not.toBe(before)
    expect(state.sessionRecorded).toBe(false)
  })

  it('markSessionRecorded 标记当前会话已记录', () => {
    useReadingStore.getState().markSessionRecorded()

    expect(useReadingStore.getState().sessionRecorded).toBe(true)
  })
})
