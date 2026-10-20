// 重点短语翻转卡片
//
// 交互：点击卡片翻转，正面显示英文短语 + 发音按钮，背面显示中文释义 + 例句 + 出处
// 实现：CSS 3D transform（preserve-3d + backface-visibility:hidden + rotateY）
//       使用内联 style 处理 3D 属性（Tailwind 对 3D transform 支持有限），保证跨浏览器一致性
//
// 性能：用 React.memo 避免父组件状态变化时全量重渲染（仅当 phrase 变化时重渲染）
import { memo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { PhraseWithSource } from '../types'
import { cn } from '@/shared/utils/cn'
import { speak, isSpeechSupported } from '@/shared/utils/speech'

interface PhraseFlipCardProps {
  phrase: PhraseWithSource
}

function PhraseFlipCardInner({ phrase }: PhraseFlipCardProps) {
  const [flipped, setFlipped] = useState(false)
  const navigate = useNavigate()

  const handleSpeak = (e: React.MouseEvent) => {
    // 阻止冒泡避免触发卡片翻转
    e.stopPropagation()
    speak(phrase.phrase, 0.9)
  }

  const handleNavigate = (e: React.MouseEvent) => {
    e.stopPropagation()
    navigate(`/reading?articleId=${encodeURIComponent(phrase.articleId)}`)
  }

  return (
    <div style={{ perspective: '1200px' }} className="h-44 cursor-pointer select-none">
      <div
        onClick={() => setFlipped((v) => !v)}
        style={{
          transformStyle: 'preserve-3d',
          transform: flipped ? 'rotateY(180deg)' : 'rotateY(0deg)',
          transition: 'transform 0.5s ease',
        }}
        className="relative h-full w-full"
      >
        {/* 正面：英文短语 + 发音按钮 */}
        <div
          style={{
            backfaceVisibility: 'hidden',
            WebkitBackfaceVisibility: 'hidden',
          }}
          className="absolute inset-0 flex flex-col justify-between rounded-lg border border-indigo-200 bg-white p-4 shadow-sm dark:border-indigo-900/50 dark:bg-gray-800"
        >
          <div className="flex items-start justify-between gap-2">
            <span className="rounded bg-indigo-50 px-1.5 py-0.5 text-[10px] font-medium text-indigo-600 dark:bg-indigo-900/40 dark:text-indigo-300">
              PHRASE
            </span>
            <button
              type="button"
              onClick={handleSpeak}
              disabled={!isSpeechSupported()}
              className={cn(
                'inline-flex h-7 w-7 items-center justify-center rounded-full text-gray-500 transition-colors hover:bg-indigo-50 hover:text-indigo-600 dark:text-gray-400 dark:hover:bg-indigo-900/30 dark:hover:text-indigo-300',
                !isSpeechSupported() && 'cursor-not-allowed opacity-50',
              )}
              aria-label={`朗读 ${phrase.phrase}`}
              title={isSpeechSupported() ? '朗读短语' : '当前浏览器不支持语音朗读'}
            >
              <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} aria-hidden>
                <path strokeLinecap="round" strokeLinejoin="round" d="M19.114 5.636a9 9 0 0 1 0 12.728M16.463 8.288a5.25 5.25 0 0 1 0 7.424M6.75 8.25l4.72-4.72a.75.75 0 0 1 1.28.53v15.88a.75.75 0 0 1-1.28.53l-4.72-4.72H4.51c-.88 0-1.704-.507-1.938-1.354A9.01 9.01 0 0 1 2.25 12c0-.83.112-1.633.322-2.396C2.806 8.756 3.63 8.25 4.51 8.25H6.75Z" />
              </svg>
            </button>
          </div>

          <div className="flex flex-1 items-center justify-center px-2 text-center">
            <p className="text-lg font-semibold leading-snug text-gray-900 dark:text-gray-100 md:text-xl">
              {phrase.phrase}
            </p>
          </div>

          <p className="text-center text-[10px] text-gray-400 dark:text-gray-500">
            点击查看释义
          </p>
        </div>

        {/* 背面：中文释义 + 例句 + 出处 */}
        <div
          style={{
            backfaceVisibility: 'hidden',
            WebkitBackfaceVisibility: 'hidden',
            transform: 'rotateY(180deg)',
          }}
          className="absolute inset-0 flex flex-col overflow-hidden rounded-lg border border-indigo-300 bg-indigo-50/60 p-3 shadow-sm dark:border-indigo-700 dark:bg-indigo-900/20"
        >
          {/* 顶部：释义 */}
          <div className="flex items-start gap-2">
            <span className="mt-0.5 shrink-0 rounded bg-indigo-100 px-1.5 py-0.5 text-[10px] font-medium text-indigo-700 dark:bg-indigo-800/60 dark:text-indigo-200">
              释义
            </span>
            <p className="text-sm font-medium text-gray-900 dark:text-gray-100">
              {phrase.meaning}
            </p>
          </div>

          {/* 中部：例句 + 翻译（可滚动） */}
          {phrase.example && (
            <div className="mt-2 flex-1 overflow-y-auto">
              <p className="text-xs italic leading-relaxed text-gray-700 dark:text-gray-300">
                {phrase.example}
              </p>
              {phrase.exampleTranslation && (
                <p className="mt-1 text-xs leading-relaxed text-gray-500 dark:text-gray-400">
                  {phrase.exampleTranslation}
                </p>
              )}
            </div>
          )}

          {/* 底部：来源文章（点击跳转原文） */}
          <button
            type="button"
            onClick={handleNavigate}
            className="mt-2 flex items-center gap-1 truncate rounded bg-white/70 px-2 py-1 text-left text-[10px] text-gray-500 transition-colors hover:bg-white hover:text-indigo-600 dark:bg-gray-800/60 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-indigo-300"
            title={`查看原文：${phrase.articleTitle}`}
          >
            <svg className="h-3 w-3 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} aria-hidden>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 10.5a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1 1 15 0Z" />
            </svg>
            <span className="truncate">{phrase.articleTitle}</span>
          </button>
        </div>
      </div>
    </div>
  )
}

export default memo(PhraseFlipCardInner)
