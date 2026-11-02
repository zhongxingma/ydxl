// 重点词汇汇总页（模仿重点短语 PhrasesPage 的结构与交互模式）
//
// 按阅读时间自动整理已读文章的重点词汇，以翻转卡片模式展示：
// - 正面：英文单词 + 音标 + 词性 + 重要程度徽章 + 发音按钮
// - 背面：中文释义 + 真题例句 + emoji 助记 + 原文例句（含翻译）+ 来源文章（可跳转原文）
//
// 数据来源：vocabularySummaryService.getVocabulariesGroupedByDate()
//   从已读文章的 Article.vocabulary 字段提取（阅读页首次打开时已由 vocabularyService
//   提取增强并持久化全部显示内容），按 readAt 日期分组
//   纯只读，不调 AI、不写库，不影响其他功能模块
//
// SWR 模式：订阅 articles 缓存事件，用户读完新文章后本页自动刷新
import { logger } from '../../../shared/utils/logger'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { vocabularySummaryService } from '../services/vocabularySummaryService'
import { useCacheInvalidated } from '@/shared/hooks/useCacheInvalidated'
import { useTranslation } from '@/shared/i18n/useTranslation'
import { chunkRows } from '@/shared/utils/chunkRows'
import { useResponsiveColumns } from '@/shared/hooks/useResponsiveColumns'
import VirtualList from '@/shared/components/VirtualList'
import type { VocabularyGroup, VocabularyWithSource } from '../types'
import VocabularyFlipCard from '../components/VocabularyFlipCard'

// 虚拟滚动：把「日期分组标题」与「一行词汇卡片」扁平化为同一类块，交给 VirtualList 统一窗口化
type VocabularyBlock =
  | { kind: 'header'; key: string; dateLabel: string; count: number }
  | { kind: 'row'; key: string; items: VocabularyWithSource[] }

// 虚拟滚动：列数 → 行内栅格 class（静态字符串保证 Tailwind 扫描到类名）
const VOCAB_ROW_GRID_CLASS: Record<number, string> = {
  1: 'grid grid-cols-1 gap-3',
  2: 'grid grid-cols-2 gap-3',
  3: 'grid grid-cols-3 gap-3',
}
// 高度估算：标题行 20px（首组）/ 32px（含 12px 组间距）；卡片行 h-56 = 224px，行距另计
const VOCAB_HEADER_HEIGHT = 20
const VOCAB_HEADER_HEIGHT_WITH_GAP = 32
const VOCAB_ROW_HEIGHT = 224
const VOCAB_ROW_GAP = 12

function estimateBlockHeight(block: VocabularyBlock, index: number): number {
  if (block.kind === 'row') return VOCAB_ROW_HEIGHT
  return index > 0 ? VOCAB_HEADER_HEIGHT_WITH_GAP : VOCAB_HEADER_HEIGHT
}

const getBlockKey = (block: VocabularyBlock) => block.key

// 分组 → 块列表：每组一个标题块 + 若干词汇行块
function buildVocabularyBlocks(
  groups: VocabularyGroup[],
  columns: number,
): VocabularyBlock[] {
  const blocks: VocabularyBlock[] = []
  for (const group of groups) {
    blocks.push({
      kind: 'header',
      key: `${group.date}-header`,
      dateLabel: group.dateLabel,
      count: group.vocabularies.length,
    })
    chunkRows(group.vocabularies, columns).forEach((items, rowIndex) => {
      blocks.push({ kind: 'row', key: `${group.date}-row-${rowIndex}`, items })
    })
  }
  return blocks
}

export default function VocabularyPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [groups, setGroups] = useState<VocabularyGroup[]>([])
  const [loading, setLoading] = useState(true)

  // 组件挂载状态标志：防止卸载后异步任务调用 setState
  const mountedRef = useRef(true)

  const loadVocabularies = useCallback(async () => {
    try {
      const result = await vocabularySummaryService.getVocabulariesGroupedByDate(t)
      if (!mountedRef.current) return
      setGroups(result)
    } catch (err) {
      logger.warn('[VocabularyPage] 加载词汇失败', err)
    } finally {
      if (mountedRef.current) setLoading(false)
    }
  }, [t])

  // 首次挂载加载
  useEffect(() => {
    mountedRef.current = true
    void loadVocabularies()
    return () => {
      mountedRef.current = false
    }
  }, [loadVocabularies])

  // 订阅 articles 缓存事件：用户读完新文章后自动刷新词汇列表
  useCacheInvalidated('articles', () => {
    void loadVocabularies()
  })

  const totalWords = groups.reduce((sum, g) => sum + g.vocabularies.length, 0)

  // 长列表窗口化：列数随断点变化，分组标题与词汇行扁平化为块列表
  const columns = useResponsiveColumns()
  const blocks = useMemo(() => buildVocabularyBlocks(groups, columns), [groups, columns])

  return (
    <div className="space-y-6">
      {/* 页面标题 */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
          {t('vocabulary.title')}
        </h1>
        <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
          {t('vocabulary.subtitle')}
        </p>
      </div>

      {/* 统计条 */}
      {groups.length > 0 && (
        <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400">
          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">
            {t('vocabulary.total_count', { count: totalWords })}
          </span>
          <span className="text-xs">{t('vocabulary.days_reading', { count: groups.length })}</span>
        </div>
      )}

      {/* 空状态 */}
      {!loading && groups.length === 0 ? (
        <div className="rounded-lg border border-dashed border-gray-300 bg-white p-8 text-center shadow-sm dark:border-gray-600 dark:bg-gray-800">
          <div className="mb-3 text-4xl">📖</div>
          <p className="mb-1 text-sm font-medium text-gray-900 dark:text-gray-100">
            {t('vocabulary.empty_title')}
          </p>
          <p className="mb-4 text-xs text-gray-500 dark:text-gray-400">
            {t('vocabulary.empty_desc')}
          </p>
          <button
            type="button"
            onClick={() => navigate('/reading')}
            className="inline-flex items-center gap-1.5 rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-emerald-700"
          >
            {t('vocabulary.go_reading')}
          </button>
        </div>
      ) : (
        <>
          {/* 分组列表：窗口化虚拟滚动，仅渲染视口内的标题行与卡片行 */}
          <VirtualList
            rows={blocks}
            getKey={getBlockKey}
            estimateRowHeight={estimateBlockHeight}
            rowGap={VOCAB_ROW_GAP}
            renderRow={(block, index) =>
              block.kind === 'header' ? (
                <div
                  className={`flex items-baseline gap-2${index > 0 ? ' pt-3' : ''}`}
                >
                  {/* 日期分组标题 */}
                  <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                    {block.dateLabel}
                  </h2>
                  <span className="text-xs text-gray-400 dark:text-gray-500">
                    {t('vocabulary.count_label', { count: block.count })}
                  </span>
                </div>
              ) : (
                // 卡片行：移动端 1 列，平板 2 列，桌面 3 列
                <div className={VOCAB_ROW_GRID_CLASS[columns]}>
                  {block.items.map((v, idx) => (
                    <VocabularyFlipCard
                      key={`${v.articleId}-${v.word}-${idx}`}
                      vocabulary={v}
                    />
                  ))}
                </div>
              )
            }
          />

          {/* 加载中骨架（首次加载） */}
          {loading && groups.length === 0 && (
            <div className="space-y-4">
              {Array.from({ length: 2 }).map((_, gi) => (
                <div key={gi}>
                  <div className="mb-2 h-4 w-24 animate-pulse rounded bg-gray-200 dark:bg-gray-700" />
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    {Array.from({ length: 3 }).map((_, ci) => (
                      <div
                        key={ci}
                        className="h-56 animate-pulse rounded-lg bg-gray-100 dark:bg-gray-700"
                      />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}
