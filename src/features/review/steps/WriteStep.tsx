// 五步复习 - 第五步：默写（例句填空 + 对比展示）
// 1. 模式切换："单词默写"（默认）/ "例句填空"
//    - 单词默写：根据中文释义输入英文单词（原有逻辑）
//    - 例句填空：显示例句并将目标词替换为 ____，用户在空格处输入完整单词
// 2. 对比展示：提交后逐字符对比
//    - 正确字母绿色，错误字母红色，缺失字母灰色下划线
//    - 例句填空模式下，将用户输入填回例句展示完整句子
// 3. 保留：中文释义显示、提示功能（首尾字母 / 例句或音节）
import { logger } from '../../../shared/utils/logger'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from '@/shared/i18n/useTranslation'
import type { Word } from '@/shared/types'
import { wordRepository } from '@/shared/services'
import HintButton from '../components/HintButton'
import { cn } from '@/shared/utils/cn'
import { estimateSyllables } from '../utils/phonetics'
import { isSpeechSupported, speak } from '@/shared/utils/speech'
import type { StepResult } from '../types'

interface WriteStepProps {
  word: Word
  onComplete: (result: StepResult) => void
}

// 默写模式
type WriteMode = 'word' | 'sentence'

// 字符对比状态
type CharStatus = 'correct' | 'wrong' | 'missing'

interface CompareChar {
  user: string
  correct: string
  status: CharStatus
}

// 逐字符对比：正确=green，错误=red，缺失=gray underline
function compareChars(userInput: string, correctWord: string): CompareChar[] {
  const user = userInput.toLowerCase()
  const correct = correctWord.toLowerCase()
  const result: CompareChar[] = []
  const maxLen = Math.max(user.length, correct.length)
  for (let i = 0; i < maxLen; i++) {
    const u = user[i] ?? ''
    const c = correct[i] ?? ''
    if (i >= correct.length) {
      // 用户多输入的字符
      result.push({ user: u, correct: '', status: 'wrong' })
    } else if (i >= user.length) {
      // 用户缺失的字符
      result.push({ user: '', correct: c, status: 'missing' })
    } else if (u === c) {
      result.push({ user: u, correct: c, status: 'correct' })
    } else {
      result.push({ user: u, correct: c, status: 'wrong' })
    }
  }
  return result
}

// 获取首尾字母提示（中间用 _ 填充）
function getLetterHint(word: string): string {
  const len = word.length
  if (len <= 1) return word
  if (len === 2) return `${word[0]}_`
  return `${word[0]}${'_'.repeat(len - 2)}${word[len - 1]}`
}

// 用空缺替换例句中的单词
function getBlankedExample(word: string, example: string): string {
  if (!example) return ''
  const regex = new RegExp(word, 'gi')
  if (!regex.test(example)) return example
  return example.replace(regex, '______')
}

export default function WriteStep({ word, onComplete }: WriteStepProps) {
  const { t } = useTranslation()
  const startTimeRef = useRef(Date.now())
  const [mode, setMode] = useState<WriteMode>('word')
  const [input, setInput] = useState('')
  const [hintLevel, setHintLevel] = useState(0) // 0: 无; 1: 首尾字母; 2: 例句/音节
  const [submitted, setSubmitted] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const speechSupported = isSpeechSupported()
  const isCorrect = input.trim().toLowerCase() === word.word.toLowerCase()

  // 字符对比结果（提交后计算）
  const compareResult = submitted ? compareChars(input.trim(), word.word) : []
  // 例句填空模式：填回后的句子（用用户输入替换空缺）
  const filledExample =
    mode === 'sentence' && word.example
      ? word.example.replace(new RegExp(word.word, 'gi'), input.trim() || '______')
      : ''

  // 切换模式时重置输入与提示
  const handleModeChange = (next: WriteMode) => {
    if (next === mode) return
    setMode(next)
    setInput('')
    setHintLevel(0)
    setSubmitted(false)
  }

  // 自动聚焦输入框
  useEffect(() => {
    inputRef.current?.focus()
  }, [mode])

  // 应用提示
  const handleHint = () => {
    if (hintLevel === 0) {
      setHintLevel(1)
    } else if (hintLevel === 1) {
      setHintLevel(2)
    }
  }

  // 提交
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!input.trim() || submitted) return
    setSubmitted(true)
    const timeSpent = Math.round((Date.now() - startTimeRef.current) / 1000)
    // 默写错误计入顽固词计数（与 PracticeStep/SpellStep 一致）
    if (!isCorrect) {
      void (async () => {
        try {
          const fresh = await wordRepository.getByIdLocalFirst(word.id)
          const next = (fresh?.stubbornCount ?? 0) + 1
          await wordRepository.update(word.id, { stubbornCount: next })
        } catch (err) {
          logger.warn('[WriteStep] 更新顽固词计数失败', err)
        }
      })()
    }
    onComplete({
      correct: isCorrect,
      correctRate: isCorrect ? 1 : 0,
      timeSpent,
    })
  }

  // 二级提示标签：单词默写=例句，例句填空=音节数
  const hintLabelL2 =
    mode === 'word' ? t('review.hint.show_example') : t('review.hint.show_syllables')

  return (
    <div className="space-y-4">
      {/* 标题 + 模式切换 */}
      <div className="text-center">
        <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
          {t('review.write.title')}
        </h3>
        <div className="mt-2 inline-flex rounded-md border border-gray-200 p-0.5 dark:border-gray-700">
          {(['word', 'sentence'] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => handleModeChange(m)}
              className={cn(
                'rounded px-3 py-1 text-xs font-medium transition-colors',
                mode === m
                  ? 'bg-indigo-600 text-white dark:bg-indigo-500'
                  : 'text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700',
              )}
            >
              {m === 'word' ? t('review.write.mode_word') : t('review.fill_blank')}
            </button>
          ))}
        </div>
      </div>

      {/* 中文释义 */}
      <div className="rounded-lg bg-indigo-50 p-4 text-center dark:bg-indigo-900/20">
        <p className="text-xs text-gray-500 dark:text-gray-400">{t('review.write.definition_title')}</p>
        <p className="mt-1 text-lg text-gray-900 dark:text-gray-100">{word.definition || t('review.write.definition_missing')}</p>
        {word.pos && (
          <span className="mt-2 inline-block rounded bg-indigo-100 px-2 py-0.5 text-xs text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300">
            {word.pos}
          </span>
        )}
      </div>

      {/* 例句填空模式：展示挖空后的例句 */}
      {mode === 'sentence' && word.example && (
        <div className="rounded-lg border-l-4 border-indigo-400 bg-indigo-50/50 px-3 py-2 dark:border-indigo-500 dark:bg-indigo-900/10">
          <p className="text-sm italic text-gray-700 dark:text-gray-300">
            &ldquo;{getBlankedExample(word.word, word.example)}&rdquo;
          </p>
        </div>
      )}

      {/* 输入区 */}
      <form onSubmit={handleSubmit} className="space-y-2">
        <input
          ref={inputRef}
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          disabled={submitted}
          placeholder={mode === 'word' ? t('review.write.placeholder_word') : t('review.write.placeholder_sentence')}
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          className={cn(
            'w-full rounded-lg border bg-white px-4 py-2.5 text-center text-lg font-medium text-gray-900 outline-none transition-colors dark:bg-gray-800 dark:text-gray-100',
            submitted
              ? isCorrect
                ? 'border-green-400 dark:border-green-500'
                : 'border-red-400 dark:border-red-500'
              : 'border-gray-300 focus:border-indigo-500 dark:border-gray-600 dark:focus:border-indigo-400',
          )}
        />
        {/* 提交按钮 */}
        {!submitted && (
          <div className="flex justify-end">
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

      {/* 提示按钮 */}
      {!submitted && hintLevel < 2 && (
        <HintButton
          onShowHint={handleHint}
          hintShown={false}
          label={hintLevel === 0 ? t('review.hint.first_last') : hintLabelL2}
        />
      )}

      {/* 提示内容：首尾字母 */}
      {hintLevel >= 1 && (
        <div className="rounded-lg border border-blue-200 bg-blue-50/50 p-3 text-center dark:border-blue-800 dark:bg-blue-900/10">
          <h4 className="text-sm font-semibold text-blue-800 dark:text-blue-200">{t('review.write.first_last_title')}</h4>
          <p className="mt-1 font-mono text-lg tracking-widest text-gray-800 dark:text-gray-200">
            {getLetterHint(word.word)}
          </p>
        </div>
      )}

      {/* 提示内容：例句（单词默写模式）或 音节数（例句填空模式） */}
      {hintLevel >= 2 && mode === 'word' && word.example && (
        <div className="rounded-lg border-l-4 border-indigo-400 bg-indigo-50/50 px-3 py-2 dark:border-indigo-500 dark:bg-indigo-900/10">
          <h4 className="mb-1 text-sm font-semibold text-blue-800 dark:text-blue-200">{t('review.write.example_hint_title')}</h4>
          <p className="text-sm italic text-gray-700 dark:text-gray-300">
            &ldquo;{getBlankedExample(word.word, word.example)}&rdquo;
          </p>
        </div>
      )}
      {hintLevel >= 2 && mode === 'sentence' && (
        <div className="rounded-lg border border-blue-200 bg-blue-50/50 p-3 text-center dark:border-blue-800 dark:bg-blue-900/10">
          <h4 className="text-sm font-semibold text-blue-800 dark:text-blue-200">{t('review.syllable_title')}</h4>
          <p className="mt-1 text-sm text-gray-700 dark:text-gray-300">
            {t('review.syllable_prefix')}{' '}
            <span className="font-bold">{estimateSyllables(word.word)}</span>{' '}
            {t('review.syllable_suffix')}
          </p>
        </div>
      )}

      {/* 对比展示：逐字符对比 */}
      {submitted && (
        <div className="space-y-3 rounded-lg border border-gray-200 bg-white p-3 dark:border-gray-700 dark:bg-gray-800">
          <h4 className="text-sm font-semibold text-gray-800 dark:text-gray-200">
            {t('review.write.compare_title')}
          </h4>
          {/* 你写的 vs 正确答案 */}
          <div className="space-y-2">
            <div>
              <p className="text-xs text-gray-500 dark:text-gray-400">{t('review.write.your_input')}</p>
              <p className="mt-0.5 font-mono text-lg tracking-widest">
                {compareResult.map((c, i) => (
                  <span
                    key={i}
                    className={cn(
                      c.status === 'correct' && 'text-green-600 dark:text-green-400',
                      c.status === 'wrong' && 'text-red-600 dark:text-red-400',
                      c.status === 'missing' &&
                        'text-gray-400 underline decoration-gray-400 dark:text-gray-600',
                    )}
                  >
                    {c.user || '_'}
                  </span>
                ))}
                {compareResult.length === 0 && (
                  <span className="text-gray-400 dark:text-gray-600">{t('review.write.empty_input')}</span>
                )}
              </p>
            </div>
            <div>
              <p className="text-xs text-gray-500 dark:text-gray-400">{t('review.correct_answer')}</p>
              <p className="mt-0.5 font-mono text-lg tracking-widest text-green-600 dark:text-green-400">
                {word.word}
              </p>
            </div>
          </div>

          {/* 例句填空模式：填回后的完整句子 */}
          {mode === 'sentence' && filledExample && (
            <div className="rounded-md bg-indigo-50/60 p-2 dark:bg-indigo-900/10">
              <p className="text-xs text-gray-500 dark:text-gray-400">{t('review.write.filled_example')}</p>
              <p className="mt-0.5 text-sm italic text-gray-700 dark:text-gray-300">
                &ldquo;{filledExample}&rdquo;
              </p>
            </div>
          )}
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
          {isCorrect ? t('review.write.correct') : t('review.write.wrong')}
        </div>
      )}

      {/* 答题后可朗读单词 */}
      {submitted && speechSupported && (
        <div className="flex justify-center">
          <button
            type="button"
            onClick={() => speak(word.word)}
            className="inline-flex items-center gap-1.5 rounded-md bg-blue-50 px-3 py-1.5 text-sm font-medium text-blue-700 transition-colors hover:bg-blue-100 dark:bg-blue-900/30 dark:text-blue-300 dark:hover:bg-blue-900/50"
          >
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="h-4 w-4" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M19.114 5.636a9 9 0 0 1 0 12.728M16.463 8.288a5.25 5.25 0 0 1 0 7.424M6.75 8.25l4.72-4.72a.75.75 0 0 1 1.28.53v15.88a.75.75 0 0 1-1.28.53l-4.72-4.72H4.51c-.96 0-1.74-.78-1.74-1.74V9.99c0-.96.78-1.74 1.74-1.74H6.75Z" />
            </svg>
            {t('review.write.speak_word')}
          </button>
        </div>
      )}
    </div>
  )
}
