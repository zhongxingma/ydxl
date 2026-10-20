// ArticleView 内部共享的工具函数与浮层状态类型
// 仅在 reading/components 目录内复用，不对外导出
import type { ReactNode } from 'react'
import type { HighlightedWord } from '@/shared/types'
import type { WordLookup } from '../types'

// 浮层位置（基于视口的固定定位）
export interface PopoverPosition {
  top: number
  left: number
}

// 选词浮层状态：查词 / 高亮词气泡 / 批量收藏 三种互斥形态
export type PopoverState =
  | {
      kind: 'lookup'
      position: PopoverPosition
      lookup: WordLookup | null
      loading: boolean
      added: boolean
    }
  | {
      kind: 'highlight'
      position: PopoverPosition
      word: HighlightedWord
      added: boolean
    }
  | {
      kind: 'batch'
      position: PopoverPosition
      words: string[]
      processing: boolean
      result: { added: number; failed: number } | null
    }

// 将文本按句子切分（支持英文 . ! ? 与中文 。！？）
export function splitIntoSentences(text: string): string[] {
  const matches = text.match(/[^.!?。！？]+[.!?。！？]+/g)
  if (!matches) {
    return [text.trim()].filter(Boolean)
  }
  return matches.map((s) => s.trim()).filter(Boolean)
}

// 将文本按段落切分（连续换行）
// 防御 null/undefined：历史导入文章或 AI 生成部分失败时可能传入 undefined
export function splitIntoParagraphs(text: string | null | undefined): string[] {
  if (!text) return []
  return text
    .split(/\n+/)
    .map((p) => p.trim())
    .filter(Boolean)
}

// 过滤多词选区中的有效单词：剔除标点、超长字符串、非字母数字开头
export function filterValidWords(raw: string[]): string[] {
  return raw
    .map((w) => w.trim().replace(/^[^\w]+|[^\w]+$/g, '')) // 去除首尾标点
    .filter((w) => w.length >= 1 && w.length <= 50 && /[a-zA-Z]/.test(w)) // 至少含一个字母
}

// 渲染句子时将高亮词包裹为可点击的 span
// 返回 React 节点数组
export function renderSentenceWithHighlights(
  sentence: string,
  highlightedWords: HighlightedWord[],
  onWordClick: (word: HighlightedWord, rect: DOMRect) => void
): ReactNode[] {
  if (!highlightedWords || highlightedWords.length === 0) {
    return [sentence]
  }

  // 构造正则：匹配任一高亮词（按词长降序避免短词先匹配），使用词边界
  // 转义正则特殊字符
  const escapedWords = highlightedWords
    .map((w) => w.word)
    .sort((a, b) => b.length - a.length)
    .map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  if (escapedWords.length === 0) return [sentence]
  const pattern = new RegExp(`\\b(${escapedWords.join('|')})\\b`, 'gi')

  const nodes: React.ReactNode[] = []
  let lastIndex = 0
  let match: RegExpExecArray | null
  let keyCounter = 0
  while ((match = pattern.exec(sentence)) !== null) {
    // 前置文本
    if (match.index > lastIndex) {
      nodes.push(sentence.slice(lastIndex, match.index))
    }
    const matchedText = match[0]
    // 大小写不敏感地查找对应的高亮词定义
    const lower = matchedText.toLowerCase()
    const hw = highlightedWords.find((w) => w.word.toLowerCase() === lower)
    if (hw) {
      nodes.push(
        <span
          key={`hw-${keyCounter++}`}
          className="cursor-pointer rounded bg-yellow-100 px-0.5 underline decoration-dotted underline-offset-2 hover:bg-yellow-200 dark:bg-yellow-900/40 dark:hover:bg-yellow-900/60"
          onClick={(e) => {
            e.stopPropagation()
            const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
            onWordClick(hw, rect)
          }}
        >
          {matchedText}
        </span>
      )
    } else {
      nodes.push(matchedText)
    }
    lastIndex = match.index + matchedText.length
  }
  // 尾部剩余文本
  if (lastIndex < sentence.length) {
    nodes.push(sentence.slice(lastIndex))
  }
  return nodes
}

// 计算浮层位置：选区上方居中（若上方空间不足则放下方）
export function computePopoverPosition(rect: DOMRect): PopoverPosition {
  const top = rect.top > 160 ? rect.top - 8 : rect.bottom + 8
  const left = rect.left + rect.width / 2
  return { top, left }
}
