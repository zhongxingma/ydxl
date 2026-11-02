// VirtualList 窗口化虚拟滚动组件单元测试
//
// 覆盖：
// 1. 仅渲染视口内行（含 overscan），视口外行不进入 DOM
// 2. 容器总高度按估算行高累加，保证滚动条比例正确
// 3. 滚动后渲染区间随容器可见位置平移
// 4. 空数据渲染空容器
// 5. 支持按行差异化估算高度与行间距
//
// jsdom 无布局：行元素 getBoundingClientRect().height 为 0，组件因此退回估算行高，
// 视口高度固定为 jsdom 默认的 window.innerHeight（768）。
import { describe, it, expect } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import VirtualList from '../VirtualList'

// 行高估算与 jsdom 视口高度（768）配合，可推导出确定的可视区间
const ROW_HEIGHT = 50

interface TestRow {
  id: string
  text: string
}

function makeRows(count: number): TestRow[] {
  return Array.from({ length: count }, (_, i) => ({ id: `row-${i}`, text: `row ${i}` }))
}

function renderList(count: number, rowGap = 0) {
  const rows = makeRows(count)
  const result = render(
    <VirtualList<TestRow>
      rows={rows}
      getKey={(row) => row.id}
      estimateRowHeight={ROW_HEIGHT}
      overscan={2}
      rowGap={rowGap}
      renderRow={(row) => <div>{row.text}</div>}
    />,
  )
  return { ...result, rows }
}

describe('VirtualList', () => {
  it('仅渲染视口内行与 overscan 行', () => {
    renderList(100)

    // 视口 768px → 可见 0..15 行，overscan 2 → 渲染 0..17 行
    expect(screen.getByText('row 0')).toBeInTheDocument()
    expect(screen.getByText('row 17')).toBeInTheDocument()
    expect(screen.queryByText('row 18')).not.toBeInTheDocument()
    expect(screen.queryByText('row 99')).not.toBeInTheDocument()
  })

  it('容器总高度按估算行高累加', () => {
    const { container } = renderList(100)
    const root = container.firstElementChild as HTMLElement
    expect(root.style.height).toBe(`${100 * ROW_HEIGHT}px`)
  })

  it('滚动到列表中部时渲染区间随之下移', () => {
    const { container } = renderList(100)
    const root = container.firstElementChild as HTMLElement
    // 模拟容器顶部移出视口 1000px
    root.getBoundingClientRect = () =>
      ({
        top: -1000,
        bottom: 4000,
        left: 0,
        right: 800,
        width: 800,
        height: 5000,
        x: 0,
        y: -1000,
        toJSON: () => ({}),
      }) as DOMRect

    fireEvent.scroll(window)

    // visibleTop = 1000 → 起始行 20；visibleBottom = 1768 → 结束行 36；overscan 2 → 18..37
    expect(screen.queryByText('row 0')).not.toBeInTheDocument()
    expect(screen.getByText('row 18')).toBeInTheDocument()
    expect(screen.getByText('row 37')).toBeInTheDocument()
    expect(screen.queryByText('row 38')).not.toBeInTheDocument()
  })

  it('空数据渲染空容器（高度 0）', () => {
    const { container } = render(
      <VirtualList<TestRow>
        rows={[]}
        getKey={(row) => row.id}
        estimateRowHeight={ROW_HEIGHT}
        renderRow={(row) => <div>{row.text}</div>}
      />,
    )
    const root = container.firstElementChild as HTMLElement
    expect(root.style.height).toBe('0px')
    expect(root.children).toHaveLength(0)
  })

  it('支持按行差异化估算高度与行间距', () => {
    const rows = [
      { id: 'h', text: 'header', kind: 'header' as const },
      { id: 'r1', text: 'row 1', kind: 'row' as const },
      { id: 'r2', text: 'row 2', kind: 'row' as const },
    ]
    const { container } = render(
      <VirtualList<(typeof rows)[number]>
        rows={rows}
        getKey={(row) => row.id}
        estimateRowHeight={(row) => (row.kind === 'header' ? 20 : 60)}
        rowGap={10}
        renderRow={(row) => <div>{row.text}</div>}
      />,
    )
    // 20 + 10 + 60 + 10 + 60 = 160
    const root = container.firstElementChild as HTMLElement
    expect(root.style.height).toBe('160px')
    expect(screen.getByText('row 1')).toBeInTheDocument()
  })
})
