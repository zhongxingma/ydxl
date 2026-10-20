// 单个生词卡片：展示生词、音标、词性释义、例句、笔记、掌握进度、稳固度、下次复习时间及操作按钮
// 支持长按 500ms 弹出操作菜单（与单击互斥）
// 使用 React.memo 避免父组件（WordbookPage）状态变化时全量重渲染：
// 仅当 word/selected 等 props 实际变化时才重渲染当前卡片
import { memo, useEffect, useRef, useState } from 'react'
import type { Word } from '@/shared/types'
import { cn } from '@/shared/utils/cn'
import MasteryProgress from './MasteryProgress'
import NextReviewBadge from './NextReviewBadge'
import StabilityBar from '@/shared/components/StabilityBar'
import Badge from '@/shared/components/Badge'
import AIProviderBadge from '@/shared/components/AIProviderBadge'
import { formatRelativeTime } from '@/shared/utils/relativeTime'
import { enrichWord, toggleFavorite } from '../services/wordbookService'
import { speak, isSpeechSupported } from '@/shared/utils/speech'

// 长按触发延迟（毫秒）
const LONG_PRESS_DELAY = 500
// 触摸滑动阈值（像素），超过则取消长按（避免滚动时误触）
const LONG_PRESS_MOVE_THRESHOLD = 10

interface WordCardProps {
  // 生词实体
  word: Word
  // 是否选中
  selected: boolean
  // 切换选中
  onSelect: (id: string) => void
  // 编辑笔记
  onEditNote: (word: Word) => void
  // 删除
  onDelete: (word: Word) => void
  // 长按触发回调（弹出操作菜单）
  onLongPress: (word: Word) => void
  // AI 补全成功后刷新列表
  onRefresh?: () => void
}

function WordCardInner({
  word,
  selected,
  onSelect,
  onEditNote,
  onDelete,
  onLongPress,
  onRefresh,
}: WordCardProps) {
  // 顽固词标记：stubbornCount >= 3
  const isStubborn = (word.stubbornCount ?? 0) >= 3
  // 已掌握标记：mastery >= 5
  const isMastered = word.mastery >= 5

  // AI 补全 loading 状态
  const [enriching, setEnriching] = useState(false)
  // 收藏切换 loading 状态（防止重复点击）
  const [favoriting, setFavoriting] = useState(false)
  // toast 提示消息
  const [toast, setToast] = useState<string | null>(null)
  // 相关短语展开/收起状态
  const [phrasesExpanded, setPhrasesExpanded] = useState(false)

  // toast 自动消失定时器引用（卸载时清理，避免对已卸载组件 setState）
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // 显示 toast 提示（3 秒后自动消失）
  const showToast = (msg: string) => {
    setToast(msg)
    if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current)
    toastTimerRef.current = setTimeout(() => {
      setToast(null)
      toastTimerRef.current = null
    }, 3000)
  }

  // 长按计时器引用
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // 触摸结束后的标志重置定时器引用（卸载时清理，避免定时器悬空）
  const touchEndTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // 长按是否已触发（用于与单击互斥，拦截后续合成 click 事件）
  const longPressTriggeredRef = useRef(false)
  // 触摸起始坐标（用于判断是否滑动）
  const touchStartPosRef = useRef<{ x: number; y: number } | null>(null)
  // 是否为触摸交互（用于忽略触摸后合成的鼠标事件，避免重复触发）
  const isTouchEventRef = useRef(false)

  // 清除长按计时器
  const clearLongPressTimer = () => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current)
      longPressTimerRef.current = null
    }
  }

  // 开始长按计时
  const startLongPressTimer = () => {
    clearLongPressTimer()
    longPressTriggeredRef.current = false
    longPressTimerRef.current = setTimeout(() => {
      longPressTriggeredRef.current = true
      onLongPress(word)
    }, LONG_PRESS_DELAY)
  }

  // 触摸开始
  const handleTouchStart = (e: React.TouchEvent) => {
    isTouchEventRef.current = true
    const touch = e.touches[0]
    touchStartPosRef.current = { x: touch.clientX, y: touch.clientY }
    startLongPressTimer()
  }

  // 触摸结束
  const handleTouchEnd = () => {
    clearLongPressTimer()
    // 延迟重置触摸标志，确保合成鼠标事件被忽略
    if (touchEndTimerRef.current) window.clearTimeout(touchEndTimerRef.current)
    touchEndTimerRef.current = setTimeout(() => {
      isTouchEventRef.current = false
      touchEndTimerRef.current = null
    }, LONG_PRESS_DELAY)
  }

  // 卸载时清理所有定时器，避免内存泄漏与对已卸载组件 setState
  useEffect(() => {
    return () => {
      clearLongPressTimer()
      if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current)
      if (touchEndTimerRef.current) window.clearTimeout(touchEndTimerRef.current)
    }
  }, [])

  // 触摸移动：若移动距离超过阈值则取消长按（避免滚动时误触）
  const handleTouchMove = (e: React.TouchEvent) => {
    if (!touchStartPosRef.current) return
    const touch = e.touches[0]
    const dx = Math.abs(touch.clientX - touchStartPosRef.current.x)
    const dy = Math.abs(touch.clientY - touchStartPosRef.current.y)
    if (dx > LONG_PRESS_MOVE_THRESHOLD || dy > LONG_PRESS_MOVE_THRESHOLD) {
      clearLongPressTimer()
    }
  }

  // 鼠标按下（忽略触摸合成的鼠标事件）
  const handleMouseDown = () => {
    if (isTouchEventRef.current) return
    startLongPressTimer()
  }

  // 鼠标抬起
  const handleMouseUp = () => {
    if (isTouchEventRef.current) return
    clearLongPressTimer()
  }

  // 鼠标离开：取消长按
  const handleMouseLeave = () => {
    if (isTouchEventRef.current) return
    clearLongPressTimer()
  }

  // 捕获阶段拦截点击：若长按已触发，则阻止后续 click（与单击互斥）
  const handleClickCapture = (e: React.MouseEvent) => {
    if (longPressTriggeredRef.current) {
      e.preventDefault()
      e.stopPropagation()
      longPressTriggeredRef.current = false
    }
  }

  // 阻止原生上下文菜单（移动端长按会触发文本选择菜单，干扰自定义菜单）
  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault()
  }

  return (
    <div
      className={cn(
        'rounded-lg border p-4 transition-colors select-none',
        selected
          ? 'border-indigo-400 bg-indigo-50/50 dark:border-indigo-500 dark:bg-indigo-900/20'
          : 'border-gray-200 bg-white hover:border-gray-300 dark:border-gray-700 dark:bg-gray-800 dark:hover:border-gray-600',
      )}
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
      onTouchMove={handleTouchMove}
      onMouseDown={handleMouseDown}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseLeave}
      onClickCapture={handleClickCapture}
      onContextMenu={handleContextMenu}
    >
      <div className="flex items-start gap-3">
        {/* 选择框 */}
        <label className="flex shrink-0 cursor-pointer items-center pt-1">
          <input
            type="checkbox"
            checked={selected}
            onChange={() => onSelect(word.id)}
            className="h-4 w-4 cursor-pointer rounded border-gray-300 text-indigo-600 focus:ring-indigo-500 dark:border-gray-600 dark:bg-gray-700"
            aria-label={`选中 ${word.word}`}
          />
        </label>

        {/* 内容区 */}
        <div className="min-w-0 flex-1">
          {/* 头部：单词 + 音标 + 已掌握/顽固词徽章 */}
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
            <h3 className="text-xl font-semibold text-gray-900 dark:text-gray-100">
              {word.word}
            </h3>
            {/* 收藏星标按钮 */}
            <button
              type="button"
              onClick={async (e) => {
                e.stopPropagation()
                setFavoriting(true)
                try {
                  await toggleFavorite(word.id)
                  onRefresh?.()
                } catch (err) {
                  console.warn('[WordCard] 收藏操作失败', err)
                  showToast('收藏操作失败')
                } finally {
                  setFavoriting(false)
                }
              }}
              disabled={favoriting}
              className={cn(
                'inline-flex h-7 w-7 items-center justify-center rounded-full transition-colors',
                word.favorite === 1
                  ? 'text-yellow-500 hover:bg-yellow-50 dark:text-yellow-400 dark:hover:bg-yellow-900/30'
                  : 'text-gray-400 hover:bg-gray-100 dark:text-gray-500 dark:hover:bg-gray-700',
                favoriting && 'cursor-not-allowed opacity-50',
              )}
              aria-label={word.favorite === 1 ? '取消收藏' : '收藏单词'}
              title={word.favorite === 1 ? '取消收藏' : '收藏单词'}
            >
              {word.favorite === 1 ? (
                /* 填充星星（已收藏） */
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="h-5 w-5" aria-hidden="true">
                  <path fillRule="evenodd" d="M10.788 3.21c.448-1.077 1.976-1.077 2.424 0l2.082 5.007 5.404.433c1.164.093 1.636 1.545.749 2.305l-4.117 3.527 1.257 5.273c.271 1.136-.964 2.033-1.96 1.425L12 18.354 7.373 21.18c-.996.608-2.231-.29-1.96-1.425l1.257-5.273-4.117-3.527c-.887-.76-.415-2.212.749-2.305l5.404-.433 2.082-5.006z" clipRule="evenodd" />
                </svg>
              ) : (
                /* 描边星星（未收藏） */
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="h-5 w-5" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M11.48 3.499a.562.562 0 011.04 0l2.125 5.111a.563.563 0 00.475.345l5.518.442c.499.04.701.663.321.988l-4.204 3.602a.563.563 0 00-.182.557l1.285 5.385a.562.562 0 01-.84.61l-4.725-2.885a.563.563 0 00-.586 0L6.982 20.54a.562.562 0 01-.84-.61l1.285-5.386a.562.562 0 00-.182-.557l-4.204-3.602a.563.563 0 01.321-.988l5.518-.442a.563.563 0 00.475-.345L11.48 3.5z" />
                </svg>
              )}
            </button>
            {/* 单词发音按钮 */}
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                speak(word.word, 1)
              }}
              disabled={!isSpeechSupported()}
              className={cn(
                'inline-flex h-7 w-7 items-center justify-center rounded-full text-gray-500 transition-colors hover:bg-indigo-50 hover:text-indigo-600 dark:text-gray-400 dark:hover:bg-indigo-900/30 dark:hover:text-indigo-300',
                !isSpeechSupported() && 'cursor-not-allowed opacity-50',
              )}
              aria-label={`朗读 ${word.word}`}
              title={isSpeechSupported() ? '朗读单词' : '当前浏览器不支持语音朗读'}
            >
              {/* 喇叭 SVG 图标 */}
              <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} aria-hidden>
                <path strokeLinecap="round" strokeLinejoin="round" d="M19.114 5.636a9 9 0 0 1 0 12.728M16.463 8.288a5.25 5.25 0 0 1 0 7.424M6.75 8.25l4.72-4.72a.75.75 0 0 1 1.28.53v15.88a.75.75 0 0 1-1.28.53l-4.72-4.72H4.51c-.88 0-1.704-.507-1.938-1.354A9.01 9.01 0 0 1 2.25 12c0-.83.112-1.633.322-2.396C2.806 8.756 3.63 8.25 4.51 8.25H6.75Z" />
              </svg>
            </button>
            {word.phonetic && (
              <span className="text-sm text-gray-500 dark:text-gray-400">
                {word.phonetic}
              </span>
            )}
            {isMastered && (
              <Badge label="✓ 已掌握" color="green" />
            )}
            {isStubborn && (
              <Badge label="顽固词" color="red" />
            )}
          </div>

          {/* 词性 + 释义 */}
          {(word.pos || word.definition) && (
            <p className="mt-1 text-sm text-gray-700 dark:text-gray-300">
              {word.pos && (
                <span className="mr-1 inline-block rounded bg-indigo-50 px-1.5 py-0.5 text-xs text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300">
                  {word.pos}
                </span>
              )}
              <span>{word.definition}</span>
            </p>
          )}

          {/* AI 词义补全按钮：仅缺失 phonetic 或 definition 时显示 */}
          {(!word.phonetic || !word.definition) && (
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={async (e) => {
                  e.stopPropagation()
                  setEnriching(true)
                  try {
                    await enrichWord(word.id)
                    onRefresh?.()
                    showToast('AI 补全成功')
                  } catch (err) {
                    console.warn('[WordCard] AI 补全失败', err)
                    // 从错误中提取具体消息：baseProvider 已将 DeepSeek 错误码翻译为中文
                    // （如 402 → "DeepSeek 账号余额不足，请充值"；401 → "DeepSeek API key 错误..."）
                    // 其他 Error（如网络错误、超时）直接显示其 message
                    const reason =
                      err instanceof Error && err.message
                        ? err.message
                        : '请稍后重试'
                    showToast(`AI 补全失败：${reason}`)
                  } finally {
                    setEnriching(false)
                  }
                }}
                disabled={enriching}
                className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs font-medium text-indigo-600 transition-colors hover:bg-indigo-50 dark:text-indigo-400 dark:hover:bg-indigo-900/30"
              >
                <span aria-hidden>✨</span>
                {enriching ? '补全中...' : 'AI 补全'}
              </button>
              {/* AI 来源徽章：补全由哪个 AI 接口完成 */}
              <AIProviderBadge scenario="wordEnrich" />
            </div>
          )}

          {/* 例句 + 中文翻译 */}
          {word.example && (
            <div className="mt-2">
              <p className="text-sm italic text-gray-500 dark:text-gray-400">
                "{word.example}"
              </p>
              {word.exampleTranslation && (
                <p className="mt-0.5 pl-3 text-xs text-gray-400 dark:text-gray-500">
                  {word.exampleTranslation}
                </p>
              )}
            </div>
          )}

          {/* 相关短语（折叠展示） */}
          {word.phrases && word.phrases.length > 0 && (
            <div className="mt-2">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  setPhrasesExpanded((v) => !v)
                }}
                className="inline-flex items-center gap-1 text-xs font-medium text-indigo-600 hover:text-indigo-700 dark:text-indigo-400"
              >
                <svg
                  className={cn('h-3 w-3 transition-transform', phrasesExpanded && 'rotate-90')}
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={2}
                  aria-hidden
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                </svg>
                相关短语（{word.phrases.length}）
              </button>
              {phrasesExpanded && (
                <ul className="mt-1 space-y-1.5">
                  {word.phrases.map((p, idx) => (
                    <li
                      key={`${p.phrase}-${idx}`}
                      className="rounded-md bg-gray-50 p-2 dark:bg-gray-700/40"
                    >
                      <div className="flex flex-wrap items-baseline gap-1">
                        <span className="text-sm font-medium text-indigo-700 dark:text-indigo-300">
                          {p.phrase}
                        </span>
                        {p.meaning && (
                          <span className="text-xs text-gray-600 dark:text-gray-400">
                            {p.meaning}
                          </span>
                        )}
                      </div>
                      {p.example && (
                        <p className="mt-0.5 text-xs italic text-gray-500 dark:text-gray-400">
                          例：{p.example}
                        </p>
                      )}
                      {p.exampleTranslation && (
                        <p className="mt-0.5 pl-3 text-xs text-gray-400 dark:text-gray-500">
                          {p.exampleTranslation}
                        </p>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {/* 笔记 */}
          {word.note && (
            <p className="mt-2 flex items-start gap-1 rounded bg-amber-50 px-2 py-1 text-sm text-amber-800 dark:bg-amber-900/20 dark:text-amber-200">
              <span aria-hidden="true">📝</span>
              <span className="whitespace-pre-wrap">{word.note}</span>
            </p>
          )}

          {/* 记忆稳固度进度条 */}
          {word.stabilityScore !== undefined && (
            <div className="mt-3">
              <StabilityBar score={word.stabilityScore} />
            </div>
          )}

          {/* 底部：掌握进度 + 复习时间 + 操作 */}
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-3">
              <MasteryProgress mastery={word.mastery} />
              <NextReviewBadge nextReview={word.nextReview} />
              {/* 预计下次复习时间文案 */}
              <span className="text-xs text-gray-500 dark:text-gray-400">
                预计下次复习：{formatRelativeTime(word.nextReview)}
              </span>
            </div>

            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => onEditNote(word)}
                className="rounded px-2 py-1 text-xs font-medium text-gray-600 transition-colors hover:bg-gray-100 hover:text-gray-900 dark:text-gray-300 dark:hover:bg-gray-700 dark:hover:text-white"
              >
                编辑笔记
              </button>
              <button
                type="button"
                onClick={() => onDelete(word)}
                className="rounded px-2 py-1 text-xs font-medium text-red-600 transition-colors hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-900/20"
              >
                删除
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Toast 提示 */}
      {toast && (
        <div className="pointer-events-none fixed inset-x-0 bottom-8 z-50 flex justify-center">
          <div className="rounded-md bg-gray-900 px-4 py-2 text-sm text-white shadow-lg dark:bg-gray-700">
            {toast}
          </div>
        </div>
      )}
    </div>
  )
}

// React.memo 浅比较 props：父组件搜索输入/选中其他卡片等场景下，未受影响的卡片跳过重渲染
export default memo(WordCardInner)
