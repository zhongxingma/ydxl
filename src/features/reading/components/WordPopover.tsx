// 选词/高亮词/批量收藏 浮层组件
// 三种互斥形态由 popover.kind 决定，渲染逻辑统一收敛于此组件
//
// 查词浮层（lookup）与高亮词气泡（highlight）共享相同的视觉层级：
//   顶部行：单词（粗体 16px）+ IPA 音标（monospace 14px indigo）+ 🔊 喇叭按钮
//   POS 徽章（彩色 chip）
//   中文释义（primary 文本色，15px）
//   例句（如有，斜体 + 缩进 + 灰色，前缀 "例："）
//   加入生词本按钮
//
// 喇叭按钮调用 window.speechSynthesis.speak 朗读单词（en-US, rate=0.9）；
// 浏览器不支持 speechSynthesis 时隐藏喇叭按钮
import { type RefObject } from 'react'
import clsx from 'clsx'
import AIProviderBadge from '@/shared/components/AIProviderBadge'
import BatchActionBar from './BatchActionBar'
import type { PopoverState } from './articleUtils'

interface WordPopoverProps {
  popover: PopoverState
  popoverRef: RefObject<HTMLDivElement>
  onClose: () => void
  onAddLookup: () => void
  onAddHighlight: () => void
  onBatchAdd: () => void
}

// 计算浏览器是否支持 speechSynthesis（仅渲染时计算一次）
// SSR 或不支持的环境下返回 false，喇叭按钮不渲染
const speechSupported =
  typeof window !== 'undefined' && 'speechSynthesis' in window

export default function WordPopover({
  popover,
  popoverRef,
  onClose,
  onAddLookup,
  onAddHighlight,
  onBatchAdd,
}: WordPopoverProps) {
  const ariaLabel =
    popover.kind === 'lookup'
      ? '查词结果'
      : popover.kind === 'highlight'
        ? '生词详情'
        : '批量加入生词本'

  // 朗读单词：调用 Web Speech API（en-US, 略慢语速 0.9）
  // 浏览器不支持时静默 no-op；word 参数为待朗读的英文单词
  const handleSpeak = (word: string): void => {
    if (typeof window === 'undefined' || !window.speechSynthesis) return
    const u = new SpeechSynthesisUtterance(word)
    u.lang = 'en-US'
    u.rate = 0.9
    window.speechSynthesis.speak(u)
  }

  return (
    <div
      ref={popoverRef}
      role="dialog"
      aria-label={ariaLabel}
      className="fixed z-50 -translate-x-1/2 -translate-y-full rounded-lg border border-gray-200 bg-white p-3 pr-8 shadow-lg dark:border-gray-700 dark:bg-gray-800"
      style={{
        top: `${popover.position.top}px`,
        left: `${popover.position.left}px`,
        minWidth: '220px',
        maxWidth: '340px',
      }}
    >
      {/* 通用 X 关闭按钮（右上角绝对定位，所有 kind 通用） */}
      <button
        type="button"
        onClick={onClose}
        aria-label="关闭"
        className="absolute right-1 top-1 rounded text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          fill="none"
          viewBox="0 0 24 24"
          strokeWidth={2}
          stroke="currentColor"
          className="h-4 w-4"
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>

      {/* 查词浮层 */}
      {popover.kind === 'lookup' &&
        (popover.loading ? (
          <div className="py-2 text-center text-sm text-gray-500 dark:text-gray-400">
            查词中...
          </div>
        ) : popover.lookup ? (
          <div className="space-y-2">
            {/* 顶部行：单词 + IPA 音标 + 喇叭按钮 */}
            <div className="flex items-center gap-2">
              <span className="text-base font-semibold text-gray-900 dark:text-gray-100">
                {popover.lookup.word}
              </span>
              {popover.lookup.phonetic && (
                <span className="font-mono text-sm text-indigo-600 dark:text-indigo-400">
                  {popover.lookup.phonetic}
                </span>
              )}
              {speechSupported && (
                <button
                  type="button"
                  onClick={() => handleSpeak(popover.lookup!.word)}
                  aria-label="朗读单词"
                  className="rounded p-0.5 text-indigo-600 hover:bg-indigo-50 hover:text-indigo-700 dark:text-indigo-400 dark:hover:bg-indigo-900/40 dark:hover:text-indigo-300"
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    fill="none"
                    viewBox="0 0 24 24"
                    strokeWidth={1.5}
                    stroke="currentColor"
                    className="h-4 w-4"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M11 5L6 9H3v6h3l5 4V5z"
                    />
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M15.54 8.46a5 5 0 010 7.07M17.66 6.34a8 8 0 010 11.31"
                    />
                  </svg>
                </button>
              )}
            </div>
            {/* POS 徽章（indigo chip） */}
            {popover.lookup.pos && (
              <span className="inline-block rounded bg-indigo-50 px-1.5 py-0.5 text-xs text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300">
                {popover.lookup.pos}
              </span>
            )}
            {/* 中文释义：有释义时显示，无释义时显示提示（AI 查询失败或未命中字典） */}
            {popover.lookup.definition ? (
              <p className="text-[15px] text-gray-900 dark:text-gray-100">
                {popover.lookup.definition}
              </p>
            ) : (
              <p className="text-xs text-gray-500 dark:text-gray-400">
                暂未查到释义，可加入生词本后自动补全
              </p>
            )}
            {/* AI 来源徽章：AI 补全的释义由哪个 AI 接口生成 */}
            <AIProviderBadge scenario="wordEnrich" />
            {/* 例句（如有，斜体 + 缩进 + 灰色，前缀 "例："） */}
            {popover.lookup.example && (
              <p className="border-l-2 border-indigo-300 pl-2 text-xs italic text-gray-500 dark:border-indigo-700 dark:text-gray-400">
                例：{popover.lookup.example}
              </p>
            )}
            {/* 加入生词本按钮 */}
            <button
              type="button"
              onClick={onAddLookup}
              disabled={popover.added}
              className={clsx(
                'w-full rounded px-3 py-1.5 text-xs font-medium transition-colors',
                popover.added
                  ? 'cursor-not-allowed bg-gray-100 text-gray-400 dark:bg-gray-700 dark:text-gray-500'
                  : 'bg-indigo-600 text-white hover:bg-indigo-700 dark:bg-indigo-500 dark:hover:bg-indigo-600'
              )}
            >
              {popover.added ? '已加入' : '加入生词本'}
            </button>
          </div>
        ) : (
          <div className="space-y-2">
            <p className="text-sm text-gray-700 dark:text-gray-300">未查询到该词的释义</p>
            <button
              type="button"
              onClick={onClose}
              className="w-full rounded bg-gray-100 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600"
            >
              关闭
            </button>
          </div>
        ))}

      {/* 高亮词气泡 */}
      {popover.kind === 'highlight' && (
        <div className="space-y-2">
          {/* 顶部行：单词 + IPA 音标 + 喇叭按钮 */}
          <div className="flex items-center gap-2">
            <span className="text-base font-semibold text-yellow-700 dark:text-yellow-300">
              {popover.word.word}
            </span>
            {popover.word.phonetic && (
              <span className="font-mono text-sm text-indigo-600 dark:text-indigo-400">
                {popover.word.phonetic}
              </span>
            )}
            {speechSupported && (
              <button
                type="button"
                onClick={() => handleSpeak(popover.word.word)}
                aria-label="朗读单词"
                className="rounded p-0.5 text-indigo-600 hover:bg-indigo-50 hover:text-indigo-700 dark:text-indigo-400 dark:hover:bg-indigo-900/40 dark:hover:text-indigo-300"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  fill="none"
                  viewBox="0 0 24 24"
                  strokeWidth={1.5}
                  stroke="currentColor"
                  className="h-4 w-4"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M11 5L6 9H3v6h3l5 4V5z"
                  />
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M15.54 8.46a5 5 0 010 7.07M17.66 6.34a8 8 0 010 11.31"
                  />
                </svg>
              </button>
            )}
          </div>
          {/* POS 徽章（yellow chip） */}
          {popover.word.pos && (
            <span className="inline-block rounded bg-yellow-50 px-1.5 py-0.5 text-xs text-yellow-700 dark:bg-yellow-900/40 dark:text-yellow-300">
              {popover.word.pos}
            </span>
          )}
          {/* 中文释义（primary 文本色，15px，醒目） */}
          <p className="text-[15px] text-gray-900 dark:text-gray-100">
            {popover.word.definition}
          </p>
          {/* 例句（如有，斜体 + 缩进 + 灰色，前缀 "例："） */}
          {popover.word.example && (
            <p className="border-l-2 border-yellow-300 pl-2 text-xs italic text-gray-500 dark:border-yellow-700 dark:text-gray-400">
              例：{popover.word.example}
            </p>
          )}
          {/* 加入生词本按钮 */}
          <button
            type="button"
            onClick={onAddHighlight}
            disabled={popover.added}
            className={clsx(
              'w-full rounded px-3 py-1.5 text-xs font-medium transition-colors',
              popover.added
                ? 'cursor-not-allowed bg-gray-100 text-gray-400 dark:bg-gray-700 dark:text-gray-500'
                : 'bg-yellow-500 text-white hover:bg-yellow-600 dark:bg-yellow-600 dark:hover:bg-yellow-700'
            )}
          >
            {popover.added ? '已加入' : '加入生词本'}
          </button>
        </div>
      )}

      {/* 批量收藏浮层 */}
      {popover.kind === 'batch' && (
        <BatchActionBar
          words={popover.words}
          processing={popover.processing}
          result={popover.result}
          onAdd={onBatchAdd}
        />
      )}
    </div>
  )
}
