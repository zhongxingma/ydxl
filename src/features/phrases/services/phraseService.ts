// 重点短语汇总服务
//
// 设计要点：
// - 不新建 Dexie 表，复用 Article.phrases 字段（AI 生成文章时已提取 3-5 个/篇）
//   避免引入同步成本，不影响其他功能模块
// - 数据来源：articleService.getReadHistory() 获取已读文章 → 提取 phrases
// - 按 readAt 日期分组（YYYY-MM-DD），组内按文章顺序保留
// - 纯只读：不调用 AI、不写库，避免页面加载触发批量 AI 调用
//   历史文章若 phrases 缺失则跳过（新文章均有 phrases，体验会越来越好）
import { articleService } from '@/features/reading/services/articleService'
import type { PhraseGroup, PhraseWithSource } from '../types'

// 一天的毫秒数（用于日期差计算）
const ONE_DAY = 24 * 60 * 60 * 1000

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
 * 与 HistoryPage 的 formatRelativeTime 风格保持一致
 */
function formatDateLabel(dateKey: string): string {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  // 按 dateKey 解析为本地午夜（避免时区偏移）
  const target = new Date(dateKey + 'T00:00:00')
  const diffDays = Math.round((today.getTime() - target.getTime()) / ONE_DAY)
  if (diffDays === 0) return '今天'
  if (diffDays === 1) return '昨天'
  if (diffDays === 2) return '前天'
  if (diffDays > 0 && diffDays < 7) return `${diffDays} 天前`
  return dateKey
}

/**
 * 获取按阅读日期分组的重点短语列表
 *
 * 流程：
 * 1. 调用 articleService.getReadHistory 拉取已读文章（按 readAt 倒序）
 * 2. 提取每篇文章的 phrases（缺失则跳过该文章）
 * 3. 为每个短语附加来源信息（articleId / articleTitle / readAt）
 * 4. 按 readAt 的日期键分组，组内保留文章顺序
 * 5. 返回按日期倒序的分组数组
 *
 * @returns 按日期倒序的短语分组数组；无数据时返回空数组
 */
export async function getPhrasesGroupedByDate(): Promise<PhraseGroup[]> {
  // 拉取已读文章（limit 500 足够覆盖长期使用，避免一次性加载过多）
  const articles = await articleService.getReadHistory(500, 0)

  // 展平为带来源的短语列表
  const allPhrases: PhraseWithSource[] = []
  for (const article of articles) {
    // 历史文章可能 phrases 为 undefined（功能上线前生成），跳过不调 AI
    if (!article.phrases || article.phrases.length === 0) continue
    const ts = article.readAt ?? article.startedAt ?? article.createdAt
    for (const p of article.phrases) {
      allPhrases.push({
        ...p,
        articleId: article.id,
        articleTitle: article.title,
        readAt: ts,
      })
    }
  }

  // 按日期分组
  const groupMap = new Map<string, PhraseWithSource[]>()
  for (const ph of allPhrases) {
    const key = toDateKey(ph.readAt)
    if (!groupMap.has(key)) groupMap.set(key, [])
    groupMap.get(key)!.push(ph)
  }

  // 转为数组并按日期倒序（最近在前）
  const groups: PhraseGroup[] = Array.from(groupMap.entries()).map(([date, phs]) => ({
    date,
    dateLabel: formatDateLabel(date),
    phrases: phs,
  }))
  groups.sort((a, b) => b.date.localeCompare(a.date))
  return groups
}

export const phraseService = {
  getPhrasesGroupedByDate,
}
