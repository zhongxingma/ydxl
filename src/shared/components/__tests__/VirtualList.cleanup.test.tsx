// VirtualList 资源清理回归测试（长会话 / 反复进出场景）
//
// 背景：docs/COMPREHENSIVE_ANALYSIS_REPORT.md §4.2「事件/定时器清理」建议补一次
// 长会话/反复进出页面的内存快照回归。jsdom 无真实堆快照，这里用「资源计数」等价验证：
// 组件反复 mount/unmount 后，window 的 scroll/resize 监听与 ResizeObserver 不残留。
//
// 可靠性保证（计数差法）：
// - 只统计测试窗口内 window 新增的 scroll/resize 监听，断言「添加数 == 移除数」
//   与净增量 0（挂载前后计数差），不受 jsdom / 测试库自身全局监听噪声影响，
//   不依赖绝对监听数，也不依赖真实 heap，避免 flaky。
// - ResizeObserver 用 stub 替身统计 observe/disconnect，同样只看计数配对。
//
// 覆盖：
// 1. 单次挂载卸载：scroll/resize 监听全部移除、ResizeObserver disconnect 并释放全部行
// 2. 反复挂载卸载 20 次：监听不累积，净增量恒为 0
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from '@testing-library/react'
import VirtualList from '../VirtualList'

// ---------- window 监听器计数追踪 ----------
// 仅追踪 scroll/resize（VirtualList 在 effect 中注册的目标事件），其余事件不计数
const TRACKED_EVENTS: readonly string[] = ['scroll', 'resize']

const tracker = {
  // type → 已添加但尚未移除的监听器（净增量即各集合大小之和）
  live: new Map<string, Set<unknown>>(),
  addCount: 0,
  removeCount: 0,
}

function resetTracker(): void {
  tracker.live.clear()
  tracker.addCount = 0
  tracker.removeCount = 0
}

function liveCount(): number {
  let total = 0
  for (const listeners of tracker.live.values()) total += listeners.size
  return total
}

function installListenerTracker(): void {
  const originalAdd = window.addEventListener.bind(window)
  const originalRemove = window.removeEventListener.bind(window)
  vi.spyOn(window, 'addEventListener').mockImplementation((
    type: string,
    listener: unknown,
    options?: unknown,
  ) => {
    if (TRACKED_EVENTS.includes(type)) {
      tracker.addCount++
      let set = tracker.live.get(type)
      if (!set) {
        set = new Set()
        tracker.live.set(type, set)
      }
      set.add(listener)
    }
    originalAdd(
      type,
      listener as EventListenerOrEventListenerObject,
      options as AddEventListenerOptions,
    )
  })
  vi.spyOn(window, 'removeEventListener').mockImplementation((
    type: string,
    listener: unknown,
    options?: unknown,
  ) => {
    if (TRACKED_EVENTS.includes(type)) {
      tracker.removeCount++
      tracker.live.get(type)?.delete(listener)
    }
    originalRemove(
      type,
      listener as EventListenerOrEventListenerObject,
      options as EventListenerOptions,
    )
  })
}

// ---------- ResizeObserver 替身 ----------
// jsdom 无 ResizeObserver；替身记录 observe/unobserve/disconnect 便于断言释放
class FakeResizeObserver {
  static instances: FakeResizeObserver[] = []
  observed = new Set<Element>()
  disconnectCount = 0

  constructor() {
    FakeResizeObserver.instances.push(this)
  }

  observe(el: Element): void {
    this.observed.add(el)
  }

  unobserve(el: Element): void {
    this.observed.delete(el)
  }

  disconnect(): void {
    this.observed.clear()
    this.disconnectCount++
  }
}

// ---------- 测试数据与渲染辅助 ----------
interface TestRow {
  id: string
  text: string
}

const ROWS: TestRow[] = Array.from({ length: 50 }, (_, i) => ({
  id: `row-${i}`,
  text: `row ${i}`,
}))
// getKey / renderRow 使用模块级稳定引用：保证 updateRange 身份稳定，
// 每次挂载只注册一轮监听（监听器效应仅在 mount/unmount 各跑一次）
const getRowKey = (row: TestRow) => row.id
const renderRow = (row: TestRow) => <div>{row.text}</div>

function renderList() {
  return render(
    <VirtualList<TestRow>
      rows={ROWS}
      getKey={getRowKey}
      estimateRowHeight={50}
      renderRow={renderRow}
    />,
  )
}

describe('VirtualList 资源清理回归（长会话 / 反复进出）', () => {
  beforeEach(() => {
    resetTracker()
    FakeResizeObserver.instances = []
    installListenerTracker()
    vi.stubGlobal('ResizeObserver', FakeResizeObserver)
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('单次挂载卸载后 scroll/resize 监听与 ResizeObserver 全部释放', () => {
    const addsBefore = tracker.addCount
    const removesBefore = tracker.removeCount
    const liveBefore = liveCount()

    const { unmount } = renderList()

    // 挂载期间确实注册了监听且保持存活（净增量 > 0）
    expect(tracker.addCount - addsBefore).toBeGreaterThan(0)
    expect(liveCount()).toBeGreaterThan(liveBefore)
    // ResizeObserver 已创建并接入已渲染行
    const observer = FakeResizeObserver.instances[FakeResizeObserver.instances.length - 1]
    expect(observer).toBeDefined()
    expect(observer.observed.size).toBeGreaterThan(0)

    unmount()

    // 添加数 == 移除数：组件新增的监听全部移除
    expect(tracker.removeCount - removesBefore).toBe(tracker.addCount - addsBefore)
    // 净增量归 0：scroll/resize 无残留监听
    expect(liveCount()).toBe(liveBefore)
    // ResizeObserver disconnect 并释放全部已观察行
    expect(observer.disconnectCount).toBe(1)
    expect(observer.observed.size).toBe(0)
  })

  it('反复挂载卸载 20 次后 scroll/resize 监听不累积', () => {
    const N = 20
    const addsBefore = tracker.addCount
    const removesBefore = tracker.removeCount
    const liveBefore = liveCount()

    for (let i = 0; i < N; i++) {
      const { unmount } = renderList()
      // 挂载期间监听生效
      expect(liveCount()).toBeGreaterThan(liveBefore)
      unmount()
      // 每次卸载后净增量回 0：不随进出次数累积
      expect(liveCount()).toBe(liveBefore)
    }

    // 20 次进出的监听全部成对：添加数 == 移除数
    expect(tracker.addCount - addsBefore).toBeGreaterThan(0)
    expect(tracker.removeCount - removesBefore).toBe(tracker.addCount - addsBefore)
    // 每次挂载创建的 ResizeObserver 均已 disconnect 并释放行
    expect(FakeResizeObserver.instances).toHaveLength(N)
    for (const instance of FakeResizeObserver.instances) {
      expect(instance.disconnectCount).toBe(1)
      expect(instance.observed.size).toBe(0)
    }
  })
})
