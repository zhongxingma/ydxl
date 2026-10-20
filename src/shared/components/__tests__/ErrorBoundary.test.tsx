// ErrorBoundary 单元测试
//
// 已迁移到 vitest 风格（globals 模式），jsdom 环境
//
// 关于错误恢复 UI 的测试方式：
// react-dom/server 的 renderToString 在 React 18 同步 SSR 下不会触发错误边界
// （子组件抛错时错误直接向上传播，getDerivedStateFromError 不会被调用）。
// 因此这里通过直接构造 ErrorBoundary 实例，调用静态方法 getDerivedStateFromError
// 得到错误状态后赋给实例的 state，再调用实例的 render() 并用 renderToString 渲染
// 其返回值。这等价于模拟 React 在客户端捕获错误后重新渲染边界的过程，
// 能够验证恢复 UI 的实际渲染输出。
//
// 测试覆盖：
// - getDerivedStateFromError 静态方法返回正确的错误状态
// - 正常子组件渲染：不抛错时应原样渲染子组件内容
// - 子组件抛错时显示默认恢复 UI（含「刷新页面」与「返回首页」按钮）
// - 自定义 fallback：提供 fallback prop 时应渲染 fallback 内容

import { createElement, type ReactElement } from 'react'
import { renderToString } from 'react-dom/server'
import { ErrorBoundary } from '../ErrorBoundary'

// ---------- 测试用辅助组件 ----------

// 渲染一段固定文本的正常子组件
function NormalChild() {
  return createElement('span', null, '正常子组件内容-渲染成功')
}

// 模拟子组件抛错的错误对象
const CHILD_RENDER_ERROR = new Error('子组件渲染失败：模拟运行时错误')

// ---------- 主测试流程 ----------

describe('ErrorBoundary', () => {
  // ===== 1. getDerivedStateFromError 静态方法 =====

  it('getDerivedStateFromError 返回 hasError=true 与对应 error', () => {
    const err = new Error('测试错误')
    const state = ErrorBoundary.getDerivedStateFromError(err)
    expect(state.hasError).toBe(true)
    expect(state.error).toBe(err)
  })

  it('getDerivedStateFromError 多次调用均返回独立正确的状态', () => {
    const err1 = new Error('错误一')
    const state1 = ErrorBoundary.getDerivedStateFromError(err1)
    const err2 = new Error('错误二')
    const state2 = ErrorBoundary.getDerivedStateFromError(err2)
    expect(state1.hasError).toBe(true)
    expect(state2.hasError).toBe(true)
    expect(state1.error).toBe(err1)
    expect(state2.error).toBe(err2)
  })

  // ===== 2. 正常子组件渲染 =====

  it('正常子组件渲染：应原样输出子组件内容', () => {
    const html = renderToString(
      createElement(ErrorBoundary, { children: createElement(NormalChild) })
    )
    expect(
      html.includes('正常子组件内容-渲染成功')
    ).toBe(true)
    // 正常渲染时不应出现错误恢复 UI
    expect(html.includes('出错了')).toBe(false)
    expect(html.includes('刷新页面')).toBe(false)
  })

  // ===== 3. 子组件抛错时显示默认恢复 UI =====
  // 说明：renderToString 不会触发错误边界，因此通过直接构造实例并设置
  // 错误状态来模拟 React 在客户端捕获错误后重新渲染边界的过程。

  it('子组件抛错时显示默认恢复 UI（含「刷新页面」与「返回首页」按钮）', () => {
    const boundary = new ErrorBoundary({ children: null })
    // 模拟 getDerivedStateFromError 被调用后的状态
    boundary.state = ErrorBoundary.getDerivedStateFromError(CHILD_RENDER_ERROR)
    const html = renderToString(boundary.render() as ReactElement)

    // 应显示默认恢复 UI 的关键元素
    expect(html.includes('出错了')).toBe(true)
    expect(html.includes('刷新页面')).toBe(true)
    expect(html.includes('返回首页')).toBe(true)
    // 应显示错误简要信息（error.message）
    expect(
      html.includes('子组件渲染失败：模拟运行时错误')
    ).toBe(true)
    // 应提供可折叠的错误堆栈
    expect(html.includes('查看错误堆栈')).toBe(true)
  })

  // ===== 4. 自定义 fallback =====

  it('自定义 fallback：子组件抛错时应渲染 fallback 内容', () => {
    const fallbackElement = createElement('div', null, '自定义降级 UI-占位文案')
    const boundary = new ErrorBoundary({ children: null, fallback: fallbackElement })
    boundary.state = ErrorBoundary.getDerivedStateFromError(CHILD_RENDER_ERROR)
    const html = renderToString(boundary.render() as ReactElement)

    expect(
      html.includes('自定义降级 UI-占位文案')
    ).toBe(true)
    // 提供 fallback 时不应显示默认恢复 UI
    expect(html.includes('出错了')).toBe(false)
    expect(html.includes('刷新页面')).toBe(false)
  })
})
