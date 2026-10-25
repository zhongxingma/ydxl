// 选词浮层：选区处理、查词竞态保护与浮层关闭
//
// 从 useWordLookup 抽离，负责浮层状态、选区事件与全局关闭监听；
// 生词本写入动作见 useWordbookActions。
import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'
import type { Article, HighlightedWord } from '@/shared/types'
import { lookupWord } from '../services/wordLookup'
import {
  computePopoverPosition,
  filterValidWords,
  type PopoverState,
} from '../components/articleUtils'

export interface UseWordSelectionPopoverResult {
  // 容器引用：用于检测点击是否在浮层外
  containerRef: RefObject<HTMLDivElement>
  // 浮层引用：用于检测点击是否在浮层内
  popoverRef: RefObject<HTMLDivElement>
  // 当前浮层状态（null 表示无浮层）
  popover: PopoverState | null
  // 关闭浮层（同时使在途查词结果失效）
  closePopover: () => void
  // mouseup 处理：选词触发查词或批量收藏
  handleMouseUp: (e: React.MouseEvent<HTMLDivElement>) => Promise<void>
  // touchend 处理：触控端长按选词（延迟 300ms 等待选区稳定）
  handleTouchEnd: (e: React.TouchEvent<HTMLDivElement>) => Promise<void>
  // 高亮词点击：弹出气泡
  handleHighlightedWordClick: (hw: HighlightedWord, rect: DOMRect) => void
  // 直接更新浮层（供生词本动作标记 added / processing）
  setPopover: React.Dispatch<React.SetStateAction<PopoverState | null>>
}

export function useWordSelectionPopover(article: Article): UseWordSelectionPopoverResult {
  // 选词/高亮词/批量收藏 浮层状态（互斥）
  const [popover, setPopover] = useState<PopoverState | null>(null)
  // 容器引用，用于检测点击是否在浮层外
  const containerRef = useRef<HTMLDivElement>(null)
  // 浮层引用，用于检测点击是否在浮层内
  const popoverRef = useRef<HTMLDivElement>(null)
  // 查词请求计数器，用于丢弃过期的异步结果（避免竞态）
  const lookupTokenRef = useRef(0)
  // 最近一次已处理的选区文本，用于 touchend / mouseup / selectionchange 间去重
  const lastHandledTextRef = useRef<string>('')
  // 弹窗外关闭去重时间戳，防止 touchstart 与合成 mousedown 重复关闭
  const lastCloseTimeRef = useRef<number>(0)
  // 指针按下状态：拖拽过程中跳过 selectionchange，避免中间选区触发查词
  const pointerDownRef = useRef<boolean>(false)

  // 关闭浮层：自增 token 使任何在途的异步查词结果失效
  const closePopover = useCallback(() => {
    lookupTokenRef.current += 1
    // 清空去重记录，允许下次重新选词查词
    lastHandledTextRef.current = ''
    setPopover(null)
  }, [])

  /**
   * 统一处理选区：从当前系统选区读取文本并触发查词/批量收藏浮层
   * 供 handleMouseUp / handleTouchEnd / handleSelectionChange 共用，避免逻辑重复
   * @param position 可选浮层位置；未提供时从选区视口坐标计算
   */
  const processSelection = useCallback(
    async (position?: { top: number; left: number }) => {
      const selection = window.getSelection()
      // iOS Safari 上 getSelection() 可能返回 null
      if (!selection) return
      const text = selection.toString().trim()
      // 选区为空或长度过短/过长，不显示浮层
      if (!text || text.length < 1 || text.length > 200) {
        return
      }
      // 去重：同一选区文本已被处理则跳过（避免 touchend + 合成 mouseup 重复触发）
      if (text === lastHandledTextRef.current) {
        return
      }
      lastHandledTextRef.current = text

      // 获取选区的视口坐标
      let rect: DOMRect | null = null
      try {
        if (selection.rangeCount > 0) {
          rect = selection.getRangeAt(0).getBoundingClientRect()
        }
      } catch (err) {
        if (import.meta.env.DEV)
          console.warn('[useWordLookup] 获取选区坐标失败', err)
        rect = null
      }
      if (!rect) {
        return
      }

      const pos = position ?? computePopoverPosition(rect)

      // 多词判定：按空格分割后过滤，若 ≥ 2 个有效词则进入批量模式
      const rawWords = text.split(/\s+/)
      const validWords = filterValidWords(rawWords)

      if (validWords.length >= 2) {
        // 多词：批量收藏浮层
        setPopover({
          kind: 'batch',
          position: pos,
          words: validWords,
          processing: false,
          result: null,
        })
        // 清除系统选区高亮，避免蓝色高亮遮挡浮层
        selection.removeAllRanges()
        return
      }

      // 单词查词：使用 filterValidWords 清理后的单词（去除首尾标点）
      // raw text 可能包含尾随标点（如 "example." / "word,"），直接传入 lookupWord
      // 会被正则 /^[a-z]+(?:[-'][a-z]+)?$/i 拒绝并返回 null，导致查词永远失败
      const cleanWord = validWords[0]
      if (!cleanWord) {
        // 选区中无有效单词（纯标点/数字等），不显示浮层
        return
      }

      // 单词：保持原有查词浮层行为
      // 生成新的 token，使前一次在途查词结果失效
      const token = ++lookupTokenRef.current
      setPopover({
        kind: 'lookup',
        position: pos,
        lookup: null,
        loading: true,
        added: false,
      })
      // 清除系统选区高亮，避免蓝色高亮遮挡浮层
      selection.removeAllRanges()

      try {
        // 调用查词（异步），使用清理后的单词
        const result = await lookupWord(cleanWord)
        // 若期间发起了新的查词或已关闭浮层，丢弃本次结果
        if (token !== lookupTokenRef.current) return
        setPopover({
          kind: 'lookup',
          position: pos,
          lookup: result,
          loading: false,
          added: false,
        })
      } catch (err) {
        console.warn('[useWordLookup] 查词失败', err)
        if (token !== lookupTokenRef.current) return
        setPopover({
          kind: 'lookup',
          position: pos,
          lookup: null,
          loading: false,
          added: false,
        })
      }
    },
    []
  )

  // mouseup 处理：选词触发查词或批量收藏
  const handleMouseUp = useCallback(
    async (e: React.MouseEvent<HTMLDivElement>) => {
      // 若 mouseup 发生在浮层内，不处理选词
      if (popoverRef.current && popoverRef.current.contains(e.target as Node)) {
        return
      }
      await processSelection()
    },
    [processSelection]
  )

  // touchend 处理：触控端长按选词后延迟读取选区
  const handleTouchEnd = useCallback(
    async (e: React.TouchEvent<HTMLDivElement>) => {
      // 若 touchend 发生在浮层内，不处理选词
      if (popoverRef.current && popoverRef.current.contains(e.target as Node)) {
        return
      }
      // 延迟约 300ms 等待系统选区稳定，再读取 getSelection()
      await new Promise<void>((resolve) => window.setTimeout(resolve, 300))
      await processSelection()
    },
    [processSelection]
  )

  /**
   * selectionchange 处理：选区变化时触发查词
   * 用于触控端长按选词的兜底监听；通过 lastHandledTextRef 与 mouseup/touchend 去重
   */
  const handleSelectionChange = useCallback(() => {
    // 拖拽过程中不处理选区变化，避免中间选区触发查词
    if (pointerDownRef.current) return
    void processSelection()
  }, [processSelection])

  // 点击高亮词：弹出气泡
  const handleHighlightedWordClick = useCallback(
    (hw: HighlightedWord, rect: DOMRect) => {
      const position = computePopoverPosition(rect)
      lookupTokenRef.current += 1
      setPopover({
        kind: 'highlight',
        position,
        word: hw,
        added: false,
      })
    },
    []
  )

  // 跟踪指针按下状态：拖拽过程中跳过 selectionchange，避免中间选区触发查词
  useEffect(() => {
    const onDown = (): void => {
      pointerDownRef.current = true
    }
    const onUp = (): void => {
      pointerDownRef.current = false
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('mouseup', onUp)
    document.addEventListener('touchstart', onDown, { passive: true })
    document.addEventListener('touchend', onUp, { passive: true })
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('mouseup', onUp)
      document.removeEventListener('touchstart', onDown)
      document.removeEventListener('touchend', onUp)
    }
  }, [])

  // 监听全局 mousedown / touchstart：点击浮层与容器外则关闭浮层
  useEffect(() => {
    if (!popover) return
    const handleOutsideClose = (e: MouseEvent | TouchEvent) => {
      // 浮层内点击不关闭（让按钮点击正常工作）
      if (popoverRef.current && popoverRef.current.contains(e.target as Node)) {
        return
      }
      // 容器内点击由 mouseup/touchend 处理，这里不重复关闭
      if (containerRef.current && containerRef.current.contains(e.target as Node)) {
        return
      }
      // 500ms 内去重，防止 touchstart 与合成 mousedown 重复关闭
      const now = Date.now()
      if (now - lastCloseTimeRef.current < 500) {
        return
      }
      lastCloseTimeRef.current = now
      setPopover(null)
    }
    // 监听 Escape 关闭浮层
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setPopover(null)
      }
    }
    document.addEventListener('mousedown', handleOutsideClose)
    document.addEventListener('touchstart', handleOutsideClose, { passive: true })
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('mousedown', handleOutsideClose)
      document.removeEventListener('touchstart', handleOutsideClose)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [popover])

  // selectionchange 监听：选区变化时触发查词（仅在无浮层时监听）
  // pointerDownRef 防止拖拽过程中间选区触发；lastHandledTextRef 与 mouseup/touchend 去重
  useEffect(() => {
    if (popover) return
    const handleChange = (): void => {
      if (pointerDownRef.current) return
      handleSelectionChange()
    }
    document.addEventListener('selectionchange', handleChange)
    return () => {
      document.removeEventListener('selectionchange', handleChange)
    }
  }, [popover, handleSelectionChange])

  // 切换文章时清除浮层
  useEffect(() => {
    closePopover()
  }, [article.id, closePopover])

  return {
    containerRef,
    popoverRef,
    popover,
    closePopover,
    handleMouseUp,
    handleTouchEnd,
    handleHighlightedWordClick,
    setPopover,
  }
}
