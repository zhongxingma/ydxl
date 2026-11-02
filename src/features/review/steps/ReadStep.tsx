// 五步复习 - 第二步：朗读（游戏化增强版）
// 1. 常速 / 慢速 切换按钮组，默认常速
// 2. 基于音节数生成简化 SVG 波形，朗读时波形依次起伏
// 3. 鼓励性发音评分：基于朗读时长与用户跟读录音时长比较，给出 1-3 星
//    麦克风未授权时跳过评分，仅保留发音播放
// 4. AI 提示：调用 aiProvider.generateWordBreakdown 获取自然拼读分解与音节数
//
// 状态与录音逻辑见 useReadStep，本组件仅负责视图渲染。
import type { Word } from '@/shared/types'
import { useTranslation } from '@/shared/i18n/useTranslation'
import AIProviderBadge from '@/shared/components/AIProviderBadge'
import WordHeader from '../components/WordHeader'
import HintButton from '../components/HintButton'
import { cn } from '@/shared/utils/cn'
import type { StepResult } from '../types'
import { useReadStep } from './useReadStep'
import '../review-animations.css'

interface ReadStepProps {
  word: Word
  onComplete: (result: StepResult) => void
}

export default function ReadStep({ word, onComplete }: ReadStepProps) {
  const { t } = useTranslation()
  const {
    speechSupported,
    recorderSupported,
    speed,
    setSpeed,
    speaking,
    waveBars,
    recording,
    recordedUrl,
    score,
    hint,
    hintLoading,
    hintError,
    handleShowHint,
    handlePlay,
    handleStartRecording,
    handleStopRecording,
    handleComplete,
  } = useReadStep(word, onComplete)

  return (
    <div className="space-y-4">
      {/* 单词头部（含发音按钮） */}
      <WordHeader word={word} />

      {/* 释义提示 */}
      {word.definition && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg bg-gray-50 p-3 text-sm text-gray-700 dark:bg-gray-800 dark:text-gray-300">
          <span>
            <span className="font-medium">{t('review.read.definition_label')}</span>
            {word.definition}
          </span>
          {/* AI 来源徽章：拼读分解由哪个 AI 接口生成 */}
          <AIProviderBadge scenario="wordBreakdown" />
        </div>
      )}

      {/* 跟读区 */}
      <div className="space-y-3 rounded-lg border border-gray-200 bg-white p-3 dark:border-gray-700 dark:bg-gray-800">
        <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-200">{t('review.read.follow_title')}</h3>

        {/* 速度切换按钮组 */}
        {speechSupported && (
          <div className="inline-flex rounded-md border border-gray-200 p-0.5 dark:border-gray-700">
            {(['normal', 'slow'] as const).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setSpeed(s)}
                className={cn(
                  'rounded px-3 py-1 text-xs font-medium transition-colors',
                  speed === s
                    ? 'bg-indigo-600 text-white dark:bg-indigo-500'
                    : 'text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700',
                )}
              >
                {s === 'normal' ? t('review.read.speed_normal') : t('review.read.speed_slow')}
              </button>
            ))}
          </div>
        )}

        {/* 波形示意 */}
        {speechSupported && (
          <div
            className={cn(
              'flex h-12 items-center justify-center gap-1',
              speaking && 'wave-active',
            )}
            aria-hidden="true"
          >
            {Array.from({ length: waveBars }).map((_, i) => {
              // 高度按位置呈正弦分布，中央最高
              const heightRatio =
                0.4 + 0.6 * Math.abs(Math.sin((i + 1) / waveBars * Math.PI))
              return (
                <span
                  key={i}
                  className="wave-bar inline-block w-1.5 rounded-full bg-indigo-400 dark:bg-indigo-500"
                  style={{
                    height: `${heightRatio * 36}px`,
                    animationDelay: `${i * 90}ms`,
                  }}
                />
              )
            })}
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          {/* 朗读按钮 */}
          {speechSupported && (
            <button
              type="button"
              onClick={handlePlay}
              disabled={speaking}
              className="inline-flex items-center gap-1.5 rounded-md bg-blue-50 px-3 py-1.5 text-sm font-medium text-blue-700 transition-colors hover:bg-blue-100 disabled:opacity-60 dark:bg-blue-900/30 dark:text-blue-300 dark:hover:bg-blue-900/50"
            >
              <SpeakerIcon />{' '}
              {speaking ? t('review.read.speaking') : t('review.step.read')}
            </button>
          )}
          {/* 录音按钮 */}
          {recorderSupported && !recording && (
            <button
              type="button"
              onClick={handleStartRecording}
              className="inline-flex items-center gap-1.5 rounded-md bg-red-50 px-3 py-1.5 text-sm font-medium text-red-700 transition-colors hover:bg-red-100 dark:bg-red-900/30 dark:text-red-300 dark:hover:bg-red-900/50"
            >
              <MicIcon /> {t('review.read.start_record')}
            </button>
          )}
          {recorderSupported && recording && (
            <button
              type="button"
              onClick={handleStopRecording}
              className="inline-flex items-center gap-1.5 rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-red-700 dark:bg-red-500 dark:hover:bg-red-600"
            >
              <StopIcon /> {t('review.read.stop_record')}
            </button>
          )}
        </div>

        {/* 录音回放 */}
        {recordedUrl && (
          <div className="mt-1">
            <p className="mb-1 text-xs text-gray-500 dark:text-gray-400">
              {t('review.read.recording_label')}
            </p>
            <audio src={recordedUrl} controls className="w-full" />
          </div>
        )}

        {/* 鼓励性评分 */}
        {score !== null && (
          <div className="rounded-md bg-amber-50 px-3 py-2 text-sm dark:bg-amber-900/20">
            <p className="text-amber-700 dark:text-amber-300">
              {t('review.read.score_label')}
              <span
                className="ml-1 text-base tracking-widest"
                aria-label={t('review.read.score_stars', { score })}
              >
                {'★'.repeat(score)}
                <span className="text-gray-300 dark:text-gray-600">
                  {'★'.repeat(3 - score)}
                </span>
              </span>
              <span className="ml-2 text-xs text-gray-500 dark:text-gray-400">
                {score === 3
                  ? t('review.read.score_high')
                  : score === 2
                    ? t('review.read.score_mid')
                    : t('review.read.score_low')}
              </span>
            </p>
          </div>
        )}

        {!recorderSupported && (
          <p className="text-xs text-gray-400 dark:text-gray-500">
            {t('review.read.no_recorder')}
          </p>
        )}
      </div>

      {/* 提示按钮 */}
      <div>
        <HintButton onShowHint={handleShowHint} hintShown={!!hint} label={t('review.read.hint_button')} />
      </div>

      {/* 提示加载中 */}
      {hintLoading && (
        <div className="rounded-lg bg-blue-50 p-3 text-sm text-blue-700 dark:bg-blue-900/20 dark:text-blue-300">
          {t('review.read.hint_loading')}
        </div>
      )}

      {/* 提示错误 / 降级提示：有 hint 时为蓝色提示，无 hint 时为红色错误 */}
      {hintError && (
        <div className={cn(
          'rounded-lg p-3 text-sm',
          hint
            ? 'bg-blue-50 text-blue-700 dark:bg-blue-900/20 dark:text-blue-300'
            : 'bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-300',
        )}>
          {hintError}
        </div>
      )}

      {/* 提示内容：拼读分解 */}
      {hint && (
        <div className="space-y-2 rounded-lg border border-blue-200 bg-blue-50/50 p-3 dark:border-blue-800 dark:bg-blue-900/10">
          <div>
            <h4 className="text-sm font-semibold text-blue-800 dark:text-blue-200">{t('review.read.phonics_title')}</h4>
            <p className="mt-1 text-sm text-gray-700 dark:text-gray-300">
              {hint.phonics.join(' - ')}
            </p>
          </div>
          <div>
            <h4 className="text-sm font-semibold text-blue-800 dark:text-blue-200">{t('review.syllable_title')}</h4>
            <p className="mt-1 text-sm text-gray-700 dark:text-gray-300">
              {hint.syllables} {t('review.syllable_suffix')}
            </p>
          </div>
        </div>
      )}

      {/* 下一步按钮 */}
      <div className="flex justify-end pt-2">
        <button
          type="button"
          onClick={handleComplete}
          className="inline-flex items-center gap-1.5 rounded-md bg-indigo-600 px-5 py-2 text-sm font-medium text-white transition-colors hover:bg-indigo-700 dark:bg-indigo-500 dark:hover:bg-indigo-600"
        >
          {t('review.next_step')}
          <ArrowRightIcon />
        </button>
      </div>
    </div>
  )
}

// 内联 SVG 图标组件
function SpeakerIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="h-4 w-4" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="M19.114 5.636a9 9 0 0 1 0 12.728M16.463 8.288a5.25 5.25 0 0 1 0 7.424M6.75 8.25l4.72-4.72a.75.75 0 0 1 1.28.53v15.88a.75.75 0 0 1-1.28.53l-4.72-4.72H4.51c-.96 0-1.74-.78-1.74-1.74V9.99c0-.96.78-1.74 1.74-1.74H6.75Z" />
    </svg>
  )
}

function MicIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="h-4 w-4" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 18.75a6 6 0 0 0 6-6v-1.5m-6 7.5a6 6 0 0 1-6-6v-1.5m6 7.5v3.75m-9-3.75h18M2.25 6.75h19.5" />
    </svg>
  )
}

function StopIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="h-4 w-4" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="M5.25 7.5A2.25 2.25 0 0 1 7.5 5.25h9a2.25 2.25 0 0 1 2.25 2.25v9a2.25 2.25 0 0 1-2.25 2.25h-9a2.25 2.25 0 0 1-2.25-2.25v-9Z" />
    </svg>
  )
}

function ArrowRightIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="h-4 w-4" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5 21 12m0 0-7.5 7.5M21 12H3" />
    </svg>
  )
}
