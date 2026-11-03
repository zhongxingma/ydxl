// VirtualList DOM 预算回归护栏（性能防回退）
//
// 目的：拦截「虚拟化失效退化为全量渲染」的性能回退。虚拟滚动的核心承诺是
// DOM 节点数与数据量解耦（O(视口) 而非 O(总数)），本文件以「实际渲染进 DOM 的
// 行数」作为确定性代理指标——不依赖真实性能计时 / heap 快照 / Lighthouse
//（jsdom 与 CI 上均易抖动），只断言 DOM 预算，保证可确定性复现。
//
// 确定性保证：
// - 固定视口高度（显式覆写 window.innerHeight）+ 固定估算行高：jsdom 无布局
//   （getBoundingClientRect().height 恒 0），行高回退估算值 → 可见区间可推导
// - 断言一律用「小于预算阈值」而非精确行数，对 overscan 调整等实现细节不敏感
// - 行数统计基于组件自带的 data-row-key 属性，不依赖行内容文案
//
// 覆盖：
// 1. 渲染 10000 行：DOM 行数 < 80（≈视口容量），不足总数的 1%
// 2. 数据量 100 → 10000：DOM 行数不随之增长
// 3. 滚动到列表深处（第 9600 行附近）：DOM 行数仍 < 80，视口外行不进 DOM
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { render, fireEvent, screen } from '@testing-library/react'
import VirtualList from '../VirtualList'

// DOM 行数预算：视口 800px / 行高 50px ≈ 16 行可见 + 2×overscan(默认 4) = 24 行，
// 阈值 80 留足余量（对 overscan / 行高估算调整不敏感），同时远小于线性渲染
const DOM_ROW_BUDGET = 80
const VIEWPORT_HEIGHT = 800
const ROW_HEIGHT = 50

interface TestRow {
  id: string
  text: string
}

const makeRows = (count: number): TestRow[] =>
  Array.from({ length: count }, (_, i) => ({ id: `row-${i}`, text: `row ${i}` }))

// getKey / renderRow 使用模块级稳定引用：避免内联函数导致 updateRange 身份抖动
const getRowKey = (row: TestRow) => row.id
const renderRow = (row: TestRow) => <div>{row.text}</div>

function renderList(count: number) {
  return render(
    <VirtualList<TestRow>
      rows={makeRows(count)}
      getKey={getRowKey}
      estimateRowHeight={ROW_HEIGHT}
      renderRow={renderRow}
    />,
  )
}

// 实际渲染进 DOM 的行数（组件为每行挂 data-row-key）
const countDomRows = (container: HTMLElement) =>
  container.querySelectorAll('[data-row-key]').length

describe('VirtualList DOM 预算回归（虚拟化防退化）', () => {
  let originalInnerHeight: number

  beforeEach(() => {
    // 固定视口高度：jsdom 默认值随环境可能漂移，显式覆写保证可见区间可推导
    originalInnerHeight = window.innerHeight
    Object.defineProperty(window, 'innerHeight', {
      configurable: true,
      writable: true,
      value: VIEWPORT_HEIGHT,
    })
  })

  afterEach(() => {
    Object.defineProperty(window, 'innerHeight', {
      configurable: true,
      writable: true,
      value: originalInnerHeight,
    })
  })

  it('渲染 10000 行数据时 DOM 行数保持 O(视口) 小预算，不随数据量膨胀', () => {
    const { container } = renderList(10000)
    const domRows = countDomRows(container)
    // 远小于总数：确认没有退化为全量渲染
    expect(domRows).toBeLessThan(10000 * 0.01)
    expect(domRows).toBeLessThan(DOM_ROW_BUDGET)
  })

  it('数据量从 100 增至 10000 时 DOM 行数不随之线性增长', () => {
    const small = renderList(100)
    const large = renderList(10000)
    const smallCount = countDomRows(small.container)
    const largeCount = countDomRows(large.container)
    // 行数只取决于视口容量：数据量 ×100，DOM 行数不增长
    expect(largeCount).toBeLessThanOrEqual(smallCount)
    expect(smallCount).toBeLessThan(DOM_ROW_BUDGET)
    expect(largeCount).toBeLessThan(DOM_ROW_BUDGET)
  })

  it('滚动到列表深处后 DOM 行数仍保持小预算，视口外行不进 DOM', () => {
    const { container } = renderList(10000)
    const root = container.firstElementChild as HTMLElement
    // 模拟已滚动至第 9600 行附近（容器顶部移出视口 480000px = 9600 × 50px）
    root.getBoundingClientRect = () =>
      ({
        top: -480000,
        bottom: 20000,
        left: 0,
        right: 800,
        width: 800,
        height: 500000,
        x: 0,
        y: -480000,
        toJSON: () => ({}),
      }) as DOMRect

    fireEvent.scroll(window)

    // 视口窗口已平移到深处：远端行进 DOM，首部行不进 DOM
    expect(screen.queryByText('row 0')).not.toBeInTheDocument()
    expect(screen.getByText('row 9600')).toBeInTheDocument()
    expect(countDomRows(container)).toBeLessThan(DOM_ROW_BUDGET)
  })
})
