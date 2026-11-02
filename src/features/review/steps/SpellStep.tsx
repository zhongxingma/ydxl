// 五步复习 - 第四步：拼写（分级提示 + 抖动动画 + 闪现）
// 1. 自动播放单词发音（mount 时）
// 2. 分级提示（提示按钮点击次数递进）：
//    - 第 1 次：显示首尾字母（a____e）
//    - 第 2 次：在首尾基础上露出 1-2 个元音
//    - 第 3 次：自定义键盘高亮可能字母（单词中包含的字母）
//    - 第 4+ 次：显示完整单词 0.5 秒后清空（闪现浮层）
// 3. 拼错抖动动画：提交错误时输入框 animate-shake
// 4. 正确拼写闪现：拼错后输入框上方闪现正确拼写 0.5 秒
// 5. 拼对则完成；多次拼错可"查看答案"完成（correctRate=0）
//
// 状态与提交逻辑见 useSpellStep，本组件仅负责视图渲染。
import type { Word } from '@/shared/types'
import { useTranslation } from '@/shared/i18n/useTranslation'
import HintButton from '../components/HintButton'
import CustomKeyboard from '../components/CustomKeyboard'
import { cn } from '@/shared/utils/cn'
import { estimateSyllables } from '../utils/phonetics'
import { speak } from '@/shared/utils/speech'
import type { StepResult } from '../types'
import { useSpellStep } from './useSpellStep'
import '../review-animations.css'

interface SpellStepProps {
  word: Word
  onComplete: (result: StepResult) => void
}

// 显示"查看答案"按钮的最低错误次数
const GIVE_UP_THRESHOLD = 2

export default function SpellStep({ word, onComplete }: SpellStepProps) {
  const { t } = useTranslation()
  const {
    input,
    setInput,
    hintLevel,
    submitted,
    wrongCount,
    shaking,
    flashKey,
    showFlash,
    inputRef,
    speechSupported,
    isCorrect,
    mask,
    highlightedLetters,
    hintLabel,
    handleHint,
    handleKeyPress,
    handleBackspace,
    handleSubmit,
    handleGiveUp,
  } = useSpellStep(word, onComplete)

  return (
    <div className="space-y-4">
      {/* 标题 */}
      <div className="text-center">
        <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
          {t('review.spell.title')}
        </h3>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
          {t('review.spell.play_hint')}
        </p>
      </div>

      {/* 发音按钮 */}
      <div className="flex justify-center">
        <button
          type="button"
          onClick={() => speak(word.word)}
          disabled={!speechSupported}
          className="inline-flex h-16 w-16 items-center justify-center rounded-full bg-blue-50 text-blue-600 transition-colors hover:bg-blue-100 dark:bg-blue-900/30 dark:text-blue-300 dark:hover:bg-blue-900/50"
          aria-label={t('review.play_audio')}
        >
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="h-8 w-8" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" d="M19.114 5.636a9 9 0 0 1 0 12.728M16.463 8.288a5.25 5.25 0 0 1 0 7.424M6.75 8.25l4.72-4.72a.75.75 0 0 1 1.28.53v15.88a.75.75 0 0 1-1.28.53l-4.72-4.72H4.51c-.96 0-1.74-.78-1.74-1.74V9.99c0-.96.78-1.74 1.74-1.74H6.75Z" />
          </svg>
        </button>
      </div>

      {!speechSupported && (
        <p className="text-center text-xs text-gray-400 dark:text-gray-500">
          {t('review.spell.no_speech')}
        </p>
      )}

      {/* 音标提示（不支持发音时显示） */}
      {!speechSupported && word.phonetic && (
        <p className="text-center text-sm text-gray-600 dark:text-gray-400">
          {t('review.spell.phonetic_label')}<span className="font-mono">{word.phonetic}</span>
        </p>
      )}

      {/* 中文释义提示 */}
      <div className="text-center">
        {word.definition ? (
          <p className="text-sm text-gray-700 dark:text-gray-300">
            {t('review.spell.definition_label')}<span className="font-medium">{word.definition}</span>
          </p>
        ) : word.phonetic ? (
          <p className="text-sm text-gray-700 dark:text-gray-300">
            {t('review.spell.phonetic_label')}<span className="font-mono">{word.phonetic}</span>
          </p>
        ) : (
          <p className="text-sm text-gray-500 dark:text-gray-400">
            {t('review.spell.missing_hints')}
          </p>
        )}
      </div>

      {/* 输入区（含正确拼写闪现浮层） */}
      <form onSubmit={handleSubmit} className="relative space-y-2">
        {/* 正确拼写闪现浮层（绝对定位） */}
        {showFlash && (
          <div
            key={flashKey}
            className="flash-appear pointer-events-none absolute -top-2 left-1/2 z-10 -translate-x-1/2 rounded-md bg-green-100 px-4 py-1.5 text-lg font-semibold text-green-700 shadow dark:bg-green-900/40 dark:text-green-300"
            role="status"
          >
            {word.word}
          </div>
        )}
        <input
          ref={inputRef}
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          disabled={submitted}
          placeholder={t('review.spell.placeholder')}
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          className={cn(
            'w-full rounded-lg border bg-white px-4 py-2.5 text-center text-lg font-medium text-gray-900 outline-none transition-colors dark:bg-gray-800 dark:text-gray-100',
            shaking && 'animate-shake',
            submitted
              ? isCorrect
                ? 'border-green-400 dark:border-green-500'
                : 'border-red-400 dark:border-red-500'
              : wrongCount > 0
                ? 'border-red-300 focus:border-indigo-500 dark:border-red-700 dark:focus:border-indigo-400'
                : 'border-gray-300 focus:border-indigo-500 dark:border-gray-600 dark:focus:border-indigo-400',
          )}
        />
        {/* 提交按钮 */}
        {!submitted && (
          <div className="flex items-center justify-between gap-2">
            {wrongCount >= GIVE_UP_THRESHOLD ? (
              <button
                type="button"
                onClick={handleGiveUp}
                className="text-xs text-gray-400 underline transition-colors hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300"
              >
                {t('review.spell.give_up')}
              </button>
            ) : (
              <span />
            )}
            <button
              type="submit"
              disabled={!input.trim()}
              className="inline-flex items-center gap-1.5 rounded-md bg-indigo-600 px-5 py-2 text-sm font-medium text-white transition-colors hover:bg-indigo-700 disabled:cursor-not-allowed disabled:bg-gray-300 dark:bg-indigo-500 dark:hover:bg-indigo-600 dark:disabled:bg-gray-600"
            >
              {t('review.submit')}
            </button>
          </div>
        )}
      </form>

      {/* 提示按钮（多级，始终可点击） */}
      {!submitted && (
        <HintButton onShowHint={handleHint} hintShown={false} label={hintLabel} />
      )}

      {/* 提示内容：首尾字母 / 元音遮罩 */}
      {hintLevel >= 1 && mask && (
        <div className="rounded-lg border border-blue-200 bg-blue-50/50 p-3 text-center dark:border-blue-800 dark:bg-blue-900/10">
          <h4 className="text-sm font-semibold text-blue-800 dark:text-blue-200">
            {hintLevel >= 2
              ? t('review.spell.letter_hint_vowels')
              : t('review.spell.letter_hint_edges')}
          </h4>
          <p className="mt-1 font-mono text-lg tracking-widest text-gray-800 dark:text-gray-200">
            {mask}
          </p>
        </div>
      )}

      {/* 自定义键盘（提示等级 3 时高亮可能字母） */}
      {hintLevel >= 3 && !submitted && (
        <div className="rounded-lg border border-blue-200 bg-blue-50/30 p-3 dark:border-blue-800 dark:bg-blue-900/10">
          <h4 className="mb-2 text-center text-sm font-semibold text-blue-800 dark:text-blue-200">
            {t('review.spell.keyboard_title')}
          </h4>
          <CustomKeyboard
            onKeyPress={handleKeyPress}
            onBackspace={handleBackspace}
            highlightedLetters={highlightedLetters}
          />
        </div>
      )}

      {/* 音节数提示（提示等级 >= 2 时附加展示） */}
      {hintLevel >= 2 && (
        <div className="rounded-lg border border-blue-200 bg-blue-50/50 p-3 text-center dark:border-blue-800 dark:bg-blue-900/10">
          <h4 className="text-sm font-semibold text-blue-800 dark:text-blue-200">{t('review.syllable_title')}</h4>
          <p className="mt-1 text-sm text-gray-700 dark:text-gray-300">
            {t('review.syllable_prefix')}{' '}
            <span className="font-bold">{estimateSyllables(word.word)}</span>{' '}
            {t('review.syllable_suffix')}
          </p>
        </div>
      )}

      {/* 答题反馈 */}
      {submitted && (
        <div
          className={cn(
            'rounded-lg p-3 text-sm',
            isCorrect
              ? 'bg-green-50 text-green-700 dark:bg-green-900/20 dark:text-green-300'
              : 'bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-300',
          )}
        >
          {isCorrect ? t('review.spell.correct') : t('review.spell.wrong')}
          {!isCorrect && (
            <p className="mt-1">
              {t('review.correct_answer')}<span className="font-mono font-semibold">{word.word}</span>
            </p>
          )}
        </div>
      )}
    </div>
  )
}
