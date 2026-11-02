// useModalFocus 单元测试
//
// 覆盖场景：
// 1. 打开时焦点移入弹窗首个表单控件
// 2. Tab 在最后一个可聚焦元素上回绕到第一个
// 3. Shift+Tab 在第一个可聚焦元素上回绕到最后一个
// 4. 关闭后焦点还给打开前的触发元素
import { describe, it, expect } from 'vitest'
import { render, fireEvent } from '@testing-library/react'
import { useState } from 'react'
import { useModalFocus } from '../useModalFocus'

function Dialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const dialogRef = useModalFocus<HTMLDivElement>(open)
  if (!open) return null
  return (
    <div ref={dialogRef} role="dialog" aria-label="测试弹窗">
      <input aria-label="第一个输入" />
      <button type="button">中间按钮</button>
      <button type="button" onClick={onClose}>
        关闭
      </button>
    </div>
  )
}

function Harness() {
  const [open, setOpen] = useState(false)
  return (
    <div>
      <button type="button" onClick={() => setOpen(true)}>
        打开
      </button>
      <Dialog open={open} onClose={() => setOpen(false)} />
    </div>
  )
}

describe('useModalFocus', () => {
  it('打开时焦点落在弹窗内首个表单控件', () => {
    const { getByText, getByLabelText } = render(<Harness />)

    fireEvent.click(getByText('打开'))

    expect(getByLabelText('第一个输入')).toHaveFocus()
  })

  it('Tab 在最后一个元素上回绕到第一个元素', () => {
    const { getByText, getByLabelText } = render(<Harness />)
    fireEvent.click(getByText('打开'))

    getByText('关闭').focus()
    fireEvent.keyDown(document, { key: 'Tab' })

    expect(getByLabelText('第一个输入')).toHaveFocus()
  })

  it('Shift+Tab 在第一个元素上回绕到最后一个元素', () => {
    const { getByText, getByLabelText } = render(<Harness />)
    fireEvent.click(getByText('打开'))

    expect(getByLabelText('第一个输入')).toHaveFocus()
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true })

    expect(getByText('关闭')).toHaveFocus()
  })

  it('关闭后焦点还给打开前的触发元素', () => {
    const { getByText, getByLabelText } = render(<Harness />)
    const trigger = getByText('打开')
    trigger.focus()
    fireEvent.click(trigger)

    expect(getByLabelText('第一个输入')).toHaveFocus()

    fireEvent.click(getByText('关闭'))

    expect(trigger).toHaveFocus()
  })
})
