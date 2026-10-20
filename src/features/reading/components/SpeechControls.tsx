// 全文朗读控制 UI：浮动在文章正文区底部的胶囊条
// - 播放/暂停切换主按钮
// - 停止按钮
// - 语速下拉（0.5x ~ 1.5x）
// - 当前朗读段落指示
// - 浏览器不支持语音合成时整体禁用
import clsx from 'clsx'

interface SpeechControlsProps {
  /** 是否正在朗读 */
  isPlaying: boolean
  /** 当前语速 */
  rate: number
  /** 当前朗读段落索引，-1 表示未开始 */
  currentParagraph: number
  /** 文章总段落数 */
  totalParagraphs: number
  /** 点击播放按钮（未开始时从头播，暂停后恢复） */
  onPlay: () => void
  /** 点击暂停按钮 */
  onPause: () => void
  /** 点击停止按钮 */
  onStop: () => void
  /** 语速变化回调 */
  onRateChange: (rate: number) => void
  /** 不支持语音合成时为 true，整体禁用 */
  disabled?: boolean
}

// 语速选项
const RATE_OPTIONS = [0.5, 0.75, 1, 1.25, 1.5]

export default function SpeechControls({
  isPlaying,
  rate,
  currentParagraph,
  totalParagraphs,
  onPlay,
  onPause,
  onStop,
  onRateChange,
  disabled = false,
}: SpeechControlsProps) {
  // 当前段落指示文本
  const progressText =
    currentParagraph >= 0
      ? `朗读中：第 ${currentParagraph + 1}/${totalParagraphs} 段`
      : '未开始'

  return (
    <div
      className={clsx(
        'sticky bottom-4 z-10 flex justify-center',
        disabled && 'opacity-50 pointer-events-none',
      )}
      title={disabled ? '当前浏览器不支持语音朗读' : undefined}
    >
      <div className="flex items-center gap-3 rounded-full border border-gray-200 bg-white/95 px-4 py-2 shadow-lg backdrop-blur dark:border-gray-700 dark:bg-gray-800/95">
        {/* 播放/暂停切换主按钮 */}
        <button
          type="button"
          onClick={isPlaying ? onPause : onPlay}
          disabled={disabled}
          aria-label={isPlaying ? '暂停朗读' : '播放朗读'}
          className="flex h-10 w-10 items-center justify-center rounded-full bg-indigo-600 text-white transition-colors hover:bg-indigo-700 disabled:opacity-50 dark:bg-indigo-500 dark:hover:bg-indigo-600"
        >
          {isPlaying ? (
            // 暂停图标
            <svg
              className="h-5 w-5"
              viewBox="0 0 24 24"
              fill="currentColor"
              aria-hidden
            >
              <path d="M6 5h4v14H6V5zm8 0h4v14h-4V5z" />
            </svg>
          ) : (
            // 播放图标
            <svg
              className="h-5 w-5"
              viewBox="0 0 24 24"
              fill="currentColor"
              aria-hidden
            >
              <path d="M8 5v14l11-7L8 5z" />
            </svg>
          )}
        </button>

        {/* 停止按钮 */}
        <button
          type="button"
          onClick={onStop}
          disabled={disabled}
          aria-label="停止朗读"
          className="flex h-8 w-8 items-center justify-center rounded-full text-gray-600 transition-colors hover:bg-gray-100 disabled:opacity-50 dark:text-gray-300 dark:hover:bg-gray-700"
        >
          <svg
            className="h-4 w-4"
            viewBox="0 0 24 24"
            fill="currentColor"
            aria-hidden
          >
            <rect x="6" y="6" width="12" height="12" rx="1.5" />
          </svg>
        </button>

        {/* 语速下拉 */}
        <select
          value={rate}
          onChange={(e) => onRateChange(Number(e.target.value))}
          disabled={disabled}
          aria-label="语速"
          className="rounded-md border border-gray-300 bg-white px-2 py-1 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-indigo-400 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200"
        >
          {RATE_OPTIONS.map((r) => (
            <option key={r} value={r}>
              {r}x
            </option>
          ))}
        </select>

        {/* 当前段落指示 */}
        <span className="whitespace-nowrap text-xs text-gray-600 dark:text-gray-300">
          {progressText}
        </span>
      </div>
    </div>
  )
}
