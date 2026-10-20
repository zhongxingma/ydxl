// WordPopover 组件单元测试（Task 5.4）
//
// 覆盖场景：
// 1. 查词浮层显示 word + phonetic + pos + definition
// 2. 例句显示（包含 example 字段时）
// 3. 🔊 喇叭按钮渲染与点击触发 speechSynthesis.speak
// 4. loading 状态显示"查词中..."
// 5. 无查词结果时显示"未查询到该词的释义"
// 6. 高亮词气泡显示 word + phonetic + pos + definition + 喇叭
// 7. 加入生词本按钮（added 状态切换文案）
// 8. 点击加入生词本按钮触发回调
// 9. 点击关闭按钮触发回调
//
// 环境依赖：
// - setup.ts 提供 window.speechSynthesis 与 SpeechSynthesisUtterance stub
//   （jsdom 未原生实现），使 WordPopover 模块加载时 speechSupported=true
// - 测试通过 vi.spyOn(window.speechSynthesis, 'speak') 验证调用
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { createRef } from 'react'
import WordPopover from '../WordPopover'
import type { PopoverState } from '../articleUtils'
import type { HighlightedWord } from '@/shared/types'
import type { WordLookup } from '../../types'

// ---------- 测试数据工厂 ----------

// lookup 字段类型：可显式传入 WordLookup | null，或省略（使用默认值）
// 注意：使用 `in` 检查而非 `??`，因为 `null ?? default` 会返回 default（null 为 nullish）
// 需要显式区分"未提供 lookup"（用默认值）与"显式传入 null"（用 null）
interface LookupPopoverOverrides {
  lookup?: WordLookup | null
  loading?: boolean
  added?: boolean
}

function makeLookupPopover(overrides: LookupPopoverOverrides = {}): PopoverState {
  const hasLookup = 'lookup' in overrides
  return {
    kind: 'lookup',
    position: { top: 100, left: 100 },
    lookup: hasLookup
      ? (overrides.lookup ?? null)
      : {
          word: 'example',
          phonetic: '/ɪɡˈzæmpl/',
          pos: 'n.',
          definition: '例子；榜样',
          example: 'This is an example.',
        },
    loading: overrides.loading ?? false,
    added: overrides.added ?? false,
  }
}

function makeHighlightPopover(overrides: Partial<{
  word: HighlightedWord
  added: boolean
}> = {}): PopoverState {
  return {
    kind: 'highlight',
    position: { top: 100, left: 100 },
    word: overrides.word ?? {
      word: 'highlighted',
      phonetic: '/ˈhaɪlaɪtɪd/',
      pos: 'adj.',
      definition: '突出的；高亮的',
      example: 'The highlighted text is important.',
    },
    added: overrides.added ?? false,
  }
}

// ---------- 测试用例 ----------

describe('WordPopover', () => {
  let speakSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    // 每个测试前安装 speak spy（setup.ts 已提供 speechSynthesis stub）
    speakSpy = vi.spyOn(window.speechSynthesis, 'speak').mockImplementation(() => {})
  })

  afterEach(() => {
    speakSpy.mockRestore()
  })

  // 1. 查词浮层显示 word + phonetic + pos + definition
  it('查词浮层：显示 word + 音标 + 词性 + 释义', () => {
    render(
      <WordPopover
        popover={makeLookupPopover()}
        popoverRef={createRef()}
        onClose={() => {}}
        onAddLookup={() => {}}
        onAddHighlight={() => {}}
        onBatchAdd={() => {}}
      />,
    )

    expect(screen.getByText('example')).toBeInTheDocument()
    expect(screen.getByText('/ɪɡˈzæmpl/')).toBeInTheDocument()
    expect(screen.getByText('n.')).toBeInTheDocument()
    expect(screen.getByText('例子；榜样')).toBeInTheDocument()
  })

  // 2. 例句显示
  it('查词浮层：包含 example 字段时显示例句', () => {
    render(
      <WordPopover
        popover={makeLookupPopover()}
        popoverRef={createRef()}
        onClose={() => {}}
        onAddLookup={() => {}}
        onAddHighlight={() => {}}
        onBatchAdd={() => {}}
      />,
    )

    expect(screen.getByText(/例：This is an example\./)).toBeInTheDocument()
  })

  // 2b. 无例句时不渲染例句区块
  it('查词浮层：无 example 字段时不渲染例句', () => {
    render(
      <WordPopover
        popover={makeLookupPopover({
          lookup: {
            word: 'test',
            phonetic: '/test/',
            pos: 'n.',
            definition: '测试',
          },
        })}
        popoverRef={createRef()}
        onClose={() => {}}
        onAddLookup={() => {}}
        onAddHighlight={() => {}}
        onBatchAdd={() => {}}
      />,
    )

    expect(screen.queryByText(/例：/)).not.toBeInTheDocument()
  })

  // 3. 🔊 喇叭按钮渲染与点击触发 speechSynthesis.speak
  it('喇叭按钮：渲染并点击触发 speechSynthesis.speak（en-US, rate=0.9）', () => {
    render(
      <WordPopover
        popover={makeLookupPopover()}
        popoverRef={createRef()}
        onClose={() => {}}
        onAddLookup={() => {}}
        onAddHighlight={() => {}}
        onBatchAdd={() => {}}
      />,
    )

    // 喇叭按钮存在（aria-label="朗读单词"）
    const speakBtn = screen.getByLabelText('朗读单词')
    expect(speakBtn).toBeInTheDocument()

    // 点击触发朗读
    fireEvent.click(speakBtn)

    // 验证 speechSynthesis.speak 被调用
    expect(speakSpy).toHaveBeenCalledTimes(1)
    // 验证传入的 utterance 参数（SpeechSynthesisUtterance 实例）
    const utterance = speakSpy.mock.calls[0][0] as SpeechSynthesisUtterance
    expect(utterance.text).toBe('example')
    expect(utterance.lang).toBe('en-US')
    expect(utterance.rate).toBe(0.9)
  })

  // 4. loading 状态显示"查词中..."
  it('loading 状态：显示"查词中..."', () => {
    render(
      <WordPopover
        popover={makeLookupPopover({ loading: true, lookup: null })}
        popoverRef={createRef()}
        onClose={() => {}}
        onAddLookup={() => {}}
        onAddHighlight={() => {}}
        onBatchAdd={() => {}}
      />,
    )

    expect(screen.getByText('查词中...')).toBeInTheDocument()
  })

  // 5. 无查词结果时显示"未查询到该词的释义"
  it('无查词结果：显示"未查询到该词的释义"', () => {
    render(
      <WordPopover
        popover={makeLookupPopover({ lookup: null, loading: false })}
        popoverRef={createRef()}
        onClose={() => {}}
        onAddLookup={() => {}}
        onAddHighlight={() => {}}
        onBatchAdd={() => {}}
      />,
    )

    expect(screen.getByText('未查询到该词的释义')).toBeInTheDocument()
  })

  // 6. 高亮词气泡显示 word + phonetic + pos + definition + 喇叭
  it('高亮词气泡：显示 word + 音标 + 词性 + 释义 + 喇叭按钮', () => {
    render(
      <WordPopover
        popover={makeHighlightPopover()}
        popoverRef={createRef()}
        onClose={() => {}}
        onAddLookup={() => {}}
        onAddHighlight={() => {}}
        onBatchAdd={() => {}}
      />,
    )

    expect(screen.getByText('highlighted')).toBeInTheDocument()
    expect(screen.getByText('/ˈhaɪlaɪtɪd/')).toBeInTheDocument()
    expect(screen.getByText('adj.')).toBeInTheDocument()
    expect(screen.getByText('突出的；高亮的')).toBeInTheDocument()
    expect(screen.getByLabelText('朗读单词')).toBeInTheDocument()
  })

  // 7. 加入生词本按钮文案切换
  it('加入生词本按钮：added=false 显示"加入生词本"，added=true 显示"已加入"', () => {
    const { rerender } = render(
      <WordPopover
        popover={makeLookupPopover({ added: false })}
        popoverRef={createRef()}
        onClose={() => {}}
        onAddLookup={() => {}}
        onAddHighlight={() => {}}
        onBatchAdd={() => {}}
      />,
    )

    expect(screen.getByText('加入生词本')).toBeInTheDocument()

    rerender(
      <WordPopover
        popover={makeLookupPopover({ added: true })}
        popoverRef={createRef()}
        onClose={() => {}}
        onAddLookup={() => {}}
        onAddHighlight={() => {}}
        onBatchAdd={() => {}}
      />,
    )

    expect(screen.getByText('已加入')).toBeInTheDocument()
  })

  // 8. 点击加入生词本按钮触发 onAddLookup 回调
  it('点击加入生词本按钮：触发 onAddLookup 回调', () => {
    const onAddLookup = vi.fn()
    render(
      <WordPopover
        popover={makeLookupPopover({ added: false })}
        popoverRef={createRef()}
        onClose={() => {}}
        onAddLookup={onAddLookup}
        onAddHighlight={() => {}}
        onBatchAdd={() => {}}
      />,
    )

    fireEvent.click(screen.getByText('加入生词本'))
    expect(onAddLookup).toHaveBeenCalledTimes(1)
  })

  // 9. 点击关闭按钮触发 onClose 回调
  it('点击关闭按钮：触发 onClose 回调', () => {
    const onClose = vi.fn()
    render(
      <WordPopover
        popover={makeLookupPopover()}
        popoverRef={createRef()}
        onClose={onClose}
        onAddLookup={() => {}}
        onAddHighlight={() => {}}
        onBatchAdd={() => {}}
      />,
    )

    fireEvent.click(screen.getByLabelText('关闭'))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  // 10. 高亮词气泡喇叭按钮点击触发朗读
  it('高亮词气泡喇叭按钮：点击触发 speechSynthesis.speak', () => {
    render(
      <WordPopover
        popover={makeHighlightPopover()}
        popoverRef={createRef()}
        onClose={() => {}}
        onAddLookup={() => {}}
        onAddHighlight={() => {}}
        onBatchAdd={() => {}}
      />,
    )

    fireEvent.click(screen.getByLabelText('朗读单词'))

    expect(speakSpy).toHaveBeenCalledTimes(1)
    const utterance = speakSpy.mock.calls[0][0] as SpeechSynthesisUtterance
    expect(utterance.text).toBe('highlighted')
    expect(utterance.lang).toBe('en-US')
  })

  // 11. 无音标时不渲染音标区块
  it('查词浮层：无 phonetic 时不渲染音标', () => {
    render(
      <WordPopover
        popover={makeLookupPopover({
          lookup: {
            word: 'test',
            phonetic: '',
            pos: 'n.',
            definition: '测试',
          },
        })}
        popoverRef={createRef()}
        onClose={() => {}}
        onAddLookup={() => {}}
        onAddHighlight={() => {}}
        onBatchAdd={() => {}}
      />,
    )

    // 单词和释义应渲染
    expect(screen.getByText('test')).toBeInTheDocument()
    expect(screen.getByText('测试')).toBeInTheDocument()
    // 音标 /ɪɡˈzæmpl/ 不应出现（来自默认数据）
    expect(screen.queryByText('/ɪɡˈzæmpl/')).not.toBeInTheDocument()
  })
})
