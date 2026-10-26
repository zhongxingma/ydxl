// CustomKeyboard 自定义键盘单元测试
//
// 覆盖场景：
// 1. 26 个字母键与退格键渲染、容器标签
// 2. 字母与退格回调
// 3. 高亮字母集合的样式切换
// 4. 禁用状态下所有按键不可点击
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import CustomKeyboard from '../CustomKeyboard'

describe('CustomKeyboard 自定义键盘', () => {
  it('渲染 26 个字母键与退格键', () => {
    render(<CustomKeyboard onKeyPress={vi.fn()} onBackspace={vi.fn()} />)

    expect(screen.getByLabelText('自定义键盘')).toBeInTheDocument()
    for (const letter of 'abcdefghijklmnopqrstuvwxyz') {
      expect(screen.getByRole('button', { name: `字母 ${letter}` })).toBeInTheDocument()
    }
    expect(screen.getByRole('button', { name: '退格' })).toBeInTheDocument()
  })

  it('点击字母与退格分别触发对应回调', () => {
    const onKeyPress = vi.fn()
    const onBackspace = vi.fn()
    render(<CustomKeyboard onKeyPress={onKeyPress} onBackspace={onBackspace} />)

    fireEvent.click(screen.getByRole('button', { name: '字母 a' }))
    expect(onKeyPress).toHaveBeenLastCalledWith('a')

    fireEvent.click(screen.getByRole('button', { name: '字母 m' }))
    expect(onKeyPress).toHaveBeenLastCalledWith('m')

    fireEvent.click(screen.getByRole('button', { name: '退格' }))
    expect(onBackspace).toHaveBeenCalledTimes(1)
  })

  it('高亮集合内的字母使用绿色样式，其余保持默认', () => {
    render(
      <CustomKeyboard
        onKeyPress={vi.fn()}
        onBackspace={vi.fn()}
        highlightedLetters={new Set(['a', 'm'])}
      />
    )

    expect(screen.getByRole('button', { name: '字母 a' }).className).toContain(
      'bg-green-100'
    )
    expect(screen.getByRole('button', { name: '字母 m' }).className).toContain(
      'bg-green-100'
    )
    expect(screen.getByRole('button', { name: '字母 z' }).className).toContain(
      'bg-gray-100'
    )
  })

  it('禁用状态下所有按键包括退格均不可点击', () => {
    const onKeyPress = vi.fn()
    const onBackspace = vi.fn()
    render(
      <CustomKeyboard
        onKeyPress={onKeyPress}
        onBackspace={onBackspace}
        disabled
      />
    )

    const letterButton = screen.getByRole('button', { name: '字母 q' })
    const backspaceButton = screen.getByRole('button', { name: '退格' })
    expect(letterButton).toBeDisabled()
    expect(backspaceButton).toBeDisabled()

    fireEvent.click(letterButton)
    fireEvent.click(backspaceButton)
    expect(onKeyPress).not.toHaveBeenCalled()
    expect(onBackspace).not.toHaveBeenCalled()
  })
})
