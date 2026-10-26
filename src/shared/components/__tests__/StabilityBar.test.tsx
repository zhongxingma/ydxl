// StabilityBar 记忆稳固度进度条单元测试
//
// 覆盖场景：
// 1. 分数标签与进度条宽度 / aria 属性
// 2. 四档颜色与文案边界（80 / 50 / 25）
// 3. showLabel=false 仅显示数值
// 4. 分数四舍五入与 0-100 范围截断
// 5. 自定义 className 透传
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import StabilityBar from '../StabilityBar'

function getBar() {
  return screen.getByRole('progressbar')
}

describe('StabilityBar 记忆稳固度', () => {
  it('默认展示标签、数值、进度条宽度与绿色梯度', () => {
    render(<StabilityBar score={85} />)

    expect(screen.getByText('记忆稳固度')).toBeInTheDocument()
    expect(screen.getByText('稳固 · 85')).toBeInTheDocument()

    const bar = getBar()
    expect(bar).toHaveAttribute('aria-valuenow', '85')
    expect(bar).toHaveAttribute('aria-valuemin', '0')
    expect(bar).toHaveAttribute('aria-valuemax', '100')
    expect(bar.firstElementChild).toHaveStyle({ width: '85%' })
    expect(bar.firstElementChild).toHaveClass('bg-green-500')
  })

  it('按 80 / 50 / 25 边界切换颜色与文案', () => {
    const { rerender } = render(<StabilityBar score={80} />)
    expect(screen.getByText('稳固 · 80')).toBeInTheDocument()
    expect(getBar().firstElementChild).toHaveClass('bg-green-500')

    rerender(<StabilityBar score={79} />)
    expect(screen.getByText('学习中 · 79')).toBeInTheDocument()
    expect(getBar().firstElementChild).toHaveClass('bg-amber-500')

    rerender(<StabilityBar score={50} />)
    expect(screen.getByText('学习中 · 50')).toBeInTheDocument()
    expect(getBar().firstElementChild).toHaveClass('bg-amber-500')

    rerender(<StabilityBar score={49} />)
    expect(screen.getByText('薄弱 · 49')).toBeInTheDocument()
    expect(getBar().firstElementChild).toHaveClass('bg-orange-500')

    rerender(<StabilityBar score={25} />)
    expect(screen.getByText('薄弱 · 25')).toBeInTheDocument()
    expect(getBar().firstElementChild).toHaveClass('bg-orange-500')

    rerender(<StabilityBar score={24} />)
    expect(screen.getByText('待巩固 · 24')).toBeInTheDocument()
    expect(getBar().firstElementChild).toHaveClass('bg-red-500')
  })

  it('showLabel=false 时仅展示数值', () => {
    render(<StabilityBar score={85} showLabel={false} />)

    expect(screen.getByText('85')).toBeInTheDocument()
    expect(screen.queryByText('稳固 · 85')).not.toBeInTheDocument()
  })

  it('分数四舍五入并截断到 0-100', () => {
    const { rerender } = render(<StabilityBar score={85.6} />)
    expect(screen.getByText('稳固 · 86')).toBeInTheDocument()
    expect(getBar()).toHaveAttribute('aria-valuenow', '86')
    expect(getBar().firstElementChild).toHaveStyle({ width: '86%' })

    rerender(<StabilityBar score={-10} />)
    expect(screen.getByText('待巩固 · 0')).toBeInTheDocument()
    expect(getBar().firstElementChild).toHaveStyle({ width: '0%' })

    rerender(<StabilityBar score={120} />)
    expect(screen.getByText('稳固 · 100')).toBeInTheDocument()
    expect(getBar().firstElementChild).toHaveStyle({ width: '100%' })
  })

  it('透传自定义 className', () => {
    const { container } = render(<StabilityBar score={60} className="mt-4" />)

    expect(container.firstElementChild).toHaveClass('w-full', 'mt-4')
  })
})
