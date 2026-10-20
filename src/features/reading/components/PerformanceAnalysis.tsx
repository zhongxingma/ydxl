// 练习成绩分析组件（Task 2.3）
// 在 result 视图渲染于成绩单与 AnswerFeedback 之间，提供：
// - 各题型正确率分解（main_idea / detail / inference / word_guess）
// - 用时分析：总用时 + 平均每题用时
// - 强弱项分析文案（基于规则，无 API 调用）：识别最弱题型并给出中文建议
// - 总评徽章：≥85% 优秀 / 70-85% 良好 / <70% 加油
//
// 数据来源：questions + answers + elapsedSec，纯本地计算，不发起任何 API 请求
import clsx from 'clsx'
import { useMemo } from 'react'
import type { Question, QuestionType } from '@/shared/types'
import { QUESTION_TYPE_LABEL } from '../types'

interface PerformanceAnalysisProps {
  questions: Question[]
  // 用户作答：题号（在 questions 数组中的下标） -> 选项下标
  answers: Record<number, number>
  // 本次阅读会话累计有效时长（秒）
  elapsedSec: number
}

// 题型显示顺序（与 QUESTION_TYPE_LABEL 保持一致）
const QUESTION_TYPE_ORDER: QuestionType[] = [
  'main_idea',
  'detail',
  'inference',
  'word_guess',
  'attitude',
  'fact_opinion',
  'structure',
  'paragraph_main',
  'causality',
  'grammar_fill',
]

// 总评阈值
const RATING_EXCELLENT_THRESHOLD = 85 // ≥85% 优秀
const RATING_GOOD_THRESHOLD = 70 // 70-85% 良好
// <70% 加油

// 总评徽章配置
interface RatingConfig {
  label: string
  // tailwind 样式类
  containerCls: string
  labelCls: string
}

function getRating(scorePercent: number): RatingConfig {
  if (scorePercent >= RATING_EXCELLENT_THRESHOLD) {
    return {
      label: '优秀',
      containerCls: 'bg-emerald-50 dark:bg-emerald-900/30',
      labelCls: 'text-emerald-700 dark:text-emerald-300',
    }
  }
  if (scorePercent >= RATING_GOOD_THRESHOLD) {
    return {
      label: '良好',
      containerCls: 'bg-indigo-50 dark:bg-indigo-900/30',
      labelCls: 'text-indigo-700 dark:text-indigo-300',
    }
  }
  return {
    label: '加油',
    containerCls: 'bg-amber-50 dark:bg-amber-900/30',
    labelCls: 'text-amber-700 dark:text-amber-300',
  }
}

// 各题型建议文案（弱项时展示）
const WEAKNESS_ADVICE: Record<QuestionType, string> = {
  main_idea: '建议阅读时关注首段与各段首句，练习归纳文章中心思想。',
  detail: '建议练习定位原文细节信息，注意题干中的时间、地点、人物等关键词。',
  inference: '建议结合上下文线索进行合理推断，关注作者态度与言外之意。',
  word_guess: '建议根据词根词缀与上下文语境猜测词义，积累常见构词法。',
  attitude: '建议关注作者表达态度的形容词与副词，留意语气与褒贬倾向。',
  fact_opinion: '建议区分客观事实陈述与主观观点表达，注意观点性词汇。',
  structure: '建议梳理文章脉络，关注过渡词与段落间的逻辑关系。',
  paragraph_main: '建议练习归纳各段中心句，关注段落首句与支撑句关系。',
  causality: '建议留意因果连接词（because/therefore/due to），理清因果关系。',
  grammar_fill: '建议系统复习语法要点（时态/语态/从句/非谓语），结合语境分析句子结构。',
}

// 强项鼓励文案
const STRENGTH_PRAISE: Record<QuestionType, string> = {
  main_idea: '主旨把握准确，能够快速抓住文章中心。',
  detail: '细节定位准确，对文章具体信息理解到位。',
  inference: '推断能力出色，善于从上下文中获取隐含信息。',
  word_guess: '词义猜测能力出色，能够灵活运用构词法与语境线索。',
  attitude: '态度推断准确，能敏锐捕捉作者倾向。',
  fact_opinion: '事实与观点区分清晰，具备良好的批判性思维。',
  structure: '文章结构把握到位，能理清行文脉络。',
  paragraph_main: '段落大意归纳准确，善于抓住段落核心。',
  causality: '因果关系理解透彻，能准确把握逻辑链条。',
  grammar_fill: '语法掌握扎实，能在真实语境中准确运用语法规则。',
}

// 时间格式化：将秒数格式化为 mm:ss
function formatDuration(sec: number): string {
  const m = Math.floor(sec / 60)
  const s = sec % 60
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

// 各题型统计项
interface TypeStat {
  type: QuestionType
  label: string
  total: number
  correct: number
  accuracy: number // 0-100
}

/**
 * 计算各题型统计：正确数 / 总数 / 正确率
 * 仅统计出现的题型（total > 0）
 */
function computeTypeStats(questions: Question[], answers: Record<number, number>): TypeStat[] {
  const stats = new Map<QuestionType, { total: number; correct: number }>()
  for (const type of QUESTION_TYPE_ORDER) {
    stats.set(type, { total: 0, correct: 0 })
  }
  questions.forEach((q, idx) => {
    const s = stats.get(q.type)
    if (!s) return
    s.total += 1
    if (answers[idx] === q.correctIndex) {
      s.correct += 1
    }
  })
  return QUESTION_TYPE_ORDER.map((type) => {
    const s = stats.get(type)!
    return {
      type,
      label: QUESTION_TYPE_LABEL[type],
      total: s.total,
      correct: s.correct,
      accuracy: s.total > 0 ? Math.round((s.correct / s.total) * 100) : 0,
    }
  }).filter((s) => s.total > 0)
}

/**
 * 生成强弱项分析文案（基于规则，无 API 调用）
 * - 识别正确率最低的题型作为弱项
 * - 识别正确率最高的题型作为强项
 * - 弱项展示针对性建议；强项展示鼓励
 * - 全对时仅展示鼓励文案，不提弱项
 */
function buildNarrative(typeStats: TypeStat[]): {
  strength: string | null
  weakness: string | null
} {
  if (typeStats.length === 0) {
    return { strength: null, weakness: null }
  }
  // 按 accuracy 升序排序，便于取最弱与最强
  const sorted = [...typeStats].sort((a, b) => a.accuracy - b.accuracy)
  const weakest = sorted[0]
  const strongest = sorted[sorted.length - 1]

  let strength: string | null = null
  let weakness: string | null = null

  // 仅当强项与弱项不同时才分别展示（避免只有一种题型时重复）
  if (strongest.type !== weakest.type) {
    if (strongest.accuracy >= RATING_GOOD_THRESHOLD) {
      strength = `${strongest.label}（${strongest.accuracy}%）：${STRENGTH_PRAISE[strongest.type]}`
    }
  }
  // 弱项：未达优秀的题型
  if (weakest.accuracy < RATING_EXCELLENT_THRESHOLD) {
    weakness = `${weakest.label}（${weakest.accuracy}%）：${WEAKNESS_ADVICE[weakest.type]}`
  }

  return { strength, weakness }
}

export default function PerformanceAnalysis({
  questions,
  answers,
  elapsedSec,
}: PerformanceAnalysisProps) {
  // 总体正确率
  const totalCorrect = useMemo(
    () => questions.filter((q, idx) => answers[idx] === q.correctIndex).length,
    [questions, answers],
  )
  const totalQuestions = questions.length
  const scorePercent = totalQuestions > 0 ? Math.round((totalCorrect / totalQuestions) * 100) : 0

  // 各题型统计
  const typeStats = useMemo(
    () => computeTypeStats(questions, answers),
    [questions, answers],
  )

  // 强弱项文案
  const narrative = useMemo(() => buildNarrative(typeStats), [typeStats])

  // 平均每题用时（秒）
  const avgPerQuestionSec =
    totalQuestions > 0 ? Math.round(elapsedSec / totalQuestions) : 0

  // 总评徽章
  const rating = getRating(scorePercent)

  // 边界保护：无题目时不渲染分析（避免除零与空数据展示）
  if (totalQuestions === 0) {
    return null
  }

  return (
    <section className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm dark:border-gray-700 dark:bg-gray-800">
      <h3 className="mb-4 text-base font-semibold text-gray-900 dark:text-gray-100">
        成绩分析
      </h3>

      {/* 顶部：总评徽章 + 关键指标 */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        {/* 总评徽章 */}
        <span
          className={clsx(
            'inline-flex items-center gap-1 rounded-full px-3 py-1 text-sm font-semibold',
            rating.containerCls,
            rating.labelCls,
          )}
          aria-label={`总评：${rating.label}`}
        >
          总评：{rating.label}
        </span>
        {/* 正确率 */}
        <span className="text-sm text-gray-600 dark:text-gray-400">
          正确率 <span className="font-semibold text-gray-900 dark:text-gray-100">{scorePercent}%</span>
          <span className="text-gray-400 dark:text-gray-500">（{totalCorrect}/{totalQuestions}）</span>
        </span>
        {/* 总用时 */}
        <span className="text-sm text-gray-600 dark:text-gray-400">
          总用时 <span className="font-semibold text-gray-900 dark:text-gray-100">{formatDuration(elapsedSec)}</span>
        </span>
        {/* 平均每题用时 */}
        <span className="text-sm text-gray-600 dark:text-gray-400">
          平均 <span className="font-semibold text-gray-900 dark:text-gray-100">{formatDuration(avgPerQuestionSec)}</span>/题
        </span>
      </div>

      {/* 各题型正确率分解 */}
      <div className="mb-4">
        <p className="mb-2 text-xs font-medium text-gray-500 dark:text-gray-400">
          题型正确率分解
        </p>
        <div className="space-y-2">
          {typeStats.map((stat) => (
            <div key={stat.type} className="flex items-center gap-3">
              {/* 题型标签 */}
              <span className="w-20 shrink-0 text-sm text-gray-700 dark:text-gray-300">
                {stat.label}
              </span>
              {/* 进度条 */}
              <div className="h-2 flex-1 overflow-hidden rounded-full bg-gray-100 dark:bg-gray-700">
                <div
                  className={clsx(
                    'h-full rounded-full transition-all',
                    stat.accuracy >= RATING_EXCELLENT_THRESHOLD
                      ? 'bg-emerald-500'
                      : stat.accuracy >= RATING_GOOD_THRESHOLD
                        ? 'bg-indigo-500'
                        : 'bg-amber-500',
                  )}
                  style={{ width: `${stat.accuracy}%` }}
                  role="progressbar"
                  aria-valuenow={stat.accuracy}
                  aria-valuemin={0}
                  aria-valuemax={100}
                />
              </div>
              {/* 正确率数字 */}
              <span className="w-16 shrink-0 text-right text-sm font-medium text-gray-700 dark:text-gray-300">
                {stat.correct}/{stat.total}
                <span className="ml-1 text-xs text-gray-400 dark:text-gray-500">
                  ({stat.accuracy}%)
                </span>
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* 强弱项分析文案 */}
      {(narrative.strength || narrative.weakness) && (
        <div className="space-y-2 rounded-md bg-gray-50 p-3 dark:bg-gray-700/40">
          <p className="text-xs font-medium text-gray-500 dark:text-gray-400">
            强弱项分析
          </p>
          {narrative.strength && (
            <div className="flex items-start gap-2 text-sm">
              <span className="mt-0.5 inline-block rounded bg-emerald-100 px-1.5 py-0.5 text-xs font-medium text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">
                强项
              </span>
              <p className="flex-1 text-gray-700 dark:text-gray-300">{narrative.strength}</p>
            </div>
          )}
          {narrative.weakness && (
            <div className="flex items-start gap-2 text-sm">
              <span className="mt-0.5 inline-block rounded bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">
                待提升
              </span>
              <p className="flex-1 text-gray-700 dark:text-gray-300">{narrative.weakness}</p>
            </div>
          )}
        </div>
      )}
    </section>
  )
}
