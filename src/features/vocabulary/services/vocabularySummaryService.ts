// 重点词汇汇总服务
//
// 设计要点（与 phraseService 模式一致）：
// - 不新建 Dexie 表，复用 Article.vocabulary 字段（vocabularyService 提取增强后写回，
//   含 word/phonetic/pos/definition/example/exampleTranslation/exampleSentence/emojiHint 全部显示内容）
// - 数据来源：articleService.getReadHistory() 获取已读文章 → 提取 vocabulary
// - 按 readAt 日期分组（YYYY-MM-DD），组内按文章顺序保留
// - 纯只读：不调用 AI、不写库，避免页面加载触发批量 AI 调用
//   历史文章若 vocabulary 缺失则跳过（阅读页首次打开时已自动提取并持久化）
import { articleService } from '@/features/reading/services/articleService'
import type { TranslateFn } from '@/shared/i18n/useTranslation'
import zhCN from '@/shared/i18n/locales/zh-CN.json'
import type { VocabularyGroup, VocabularyWithSource } from '../types'

// 一天的毫秒数（用于日期差计算）
const ONE_DAY = 24 * 60 * 60 * 1000

// 兜底翻译函数：未注入 t 时按 zh-CN 字典返回，保持无参调用输出中文原文
const ZH_DICT: Record<string, string> = zhCN
const zhT: TranslateFn = (key, params) => {
  const template = ZH_DICT[key] ?? key
  if (!params) return template
  return template.replace(/\{(\w+)\}/g, (_, name: string) => String(params[name] ?? ''))
}

/**
 * 时间戳转日期键（YYYY-MM-DD）
 * 用于分组键与排序，按日历天对齐（忽略同日内小时差异）
 */
function toDateKey(timestamp: number): string {
  const d = new Date(timestamp)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/**
 * 格式化日期标签：今天 / 昨天 / 前天 / N 天前 / YYYY-MM-DD
 * 与 HistoryPage / phraseService 的展示风格保持一致
 * 文案通过传入的 t() 翻译（由调用方注入）
 */
function formatDateLabel(dateKey: string, t: TranslateFn): string {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  // 按 dateKey 解析为本地午夜（避免时区偏移）
  const target = new Date(dateKey + 'T00:00:00')
  const diffDays = Math.round((today.getTime() - target.getTime()) / ONE_DAY)
  if (diffDays === 0) return t('vocabulary.date.today')
  if (diffDays === 1) return t('vocabulary.date.yesterday')
  if (diffDays === 2) return t('vocabulary.date.day_before_yesterday')
  if (diffDays > 0 && diffDays < 7) return t('vocabulary.date.days_ago', { count: diffDays })
  return dateKey
}

/**
 * 获取按阅读日期分组的重点词汇列表
 *
 * 流程：
 * 1. 调用 articleService.getReadHistory 拉取已读文章（按 readAt 倒序）
 * 2. 提取每篇文章的 vocabulary（缺失则跳过该文章，不触发 AI）
 * 3. 为每个词汇附加来源信息（articleId / articleTitle / readAt）
 * 4. 按 readAt 的日期键分组，组内保留文章顺序
 * 5. 返回按日期倒序的分组数组
 *
 * @param t 翻译函数（由调用方组件通过 useTranslation 提供；缺省按 zh-CN 返回）
 * @returns 按日期倒序的词汇分组数组；无数据时返回空数组
 */
export async function getVocabulariesGroupedByDate(t: TranslateFn = zhT): Promise<VocabularyGroup[]> {
  // 拉取已读文章（limit 500 足够覆盖长期使用，避免一次性加载过多）
  const articles = await articleService.getReadHistory(500, 0)

  // 展平为带来源的词汇列表
  const allVocabularies: VocabularyWithSource[] = []
  for (const article of articles) {
    // 历史文章可能 vocabulary 为 undefined（从未在阅读页打开过），跳过不调 AI
    if (!article.vocabulary || article.vocabulary.length === 0) continue
    const ts = article.readAt ?? article.startedAt ?? article.createdAt
    for (const v of article.vocabulary) {
      allVocabularies.push({
        ...v,
        articleId: article.id,
        articleTitle: article.title,
        readAt: ts,
      })
    }
  }

  // 按日期分组
  const groupMap = new Map<string, VocabularyWithSource[]>()
  for (const v of allVocabularies) {
    const key = toDateKey(v.readAt)
    if (!groupMap.has(key)) groupMap.set(key, [])
    groupMap.get(key)!.push(v)
  }

  // 转为数组并按日期倒序（最近在前）
  const groups: VocabularyGroup[] = Array.from(groupMap.entries()).map(
    ([date, vocabularies]) => ({
      date,
      dateLabel: formatDateLabel(date, t),
      vocabularies,
    }),
  )
  groups.sort((a, b) => b.date.localeCompare(a.date))
  return groups
}

export const vocabularySummaryService = {
  getVocabulariesGroupedByDate,
}
