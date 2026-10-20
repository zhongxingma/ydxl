// 重点短语汇总页
//
// 按阅读时间自动整理已读文章的重点短语，以翻转卡片模式展示：
// - 正面：英文短语 + 发音按钮
// - 背面：中文释义 + 例句（含完整例句翻译）+ 来源文章（可跳转原文）
//
// 数据来源：phraseService.getPhrasesGroupedByDate()
//   从已读文章的 Article.phrases 字段提取，按 readAt 日期分组
//   纯只读，不调 AI、不写库，不影响其他功能模块
//
// SWR 模式：订阅 articles 缓存事件，用户读完新文章后本页自动刷新
import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { phraseService } from '../services/phraseService'
import { useCacheInvalidated } from '@/shared/hooks/useCacheInvalidated'
import type { PhraseGroup } from '../types'
import PhraseFlipCard from '../components/PhraseFlipCard'

export default function PhrasesPage() {
  const navigate = useNavigate()
  const [groups, setGroups] = useState<PhraseGroup[]>([])
  const [loading, setLoading] = useState(true)

  // 组件挂载状态标志：防止卸载后异步任务调用 setState
  const mountedRef = useRef(true)

  const loadPhrases = useCallback(async () => {
    try {
      const result = await phraseService.getPhrasesGroupedByDate()
      if (!mountedRef.current) return
      setGroups(result)
    } catch (err) {
      console.warn('[PhrasesPage] 加载短语失败', err)
    } finally {
      if (mountedRef.current) setLoading(false)
    }
  }, [])

  // 首次挂载加载
  useEffect(() => {
    mountedRef.current = true
    void loadPhrases()
    return () => {
      mountedRef.current = false
    }
  }, [loadPhrases])

  // 订阅 articles 缓存事件：用户读完新文章后自动刷新短语列表
  useCacheInvalidated('articles', () => {
    void loadPhrases()
  })

  const totalPhrases = groups.reduce((sum, g) => sum + g.phrases.length, 0)

  return (
    <div className="space-y-6">
      {/* 页面标题 */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
          重点短语
        </h1>
        <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
          按阅读时间整理的重点短语，点击卡片翻转查看释义
        </p>
      </div>

      {/* 统计条 */}
      {groups.length > 0 && (
        <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400">
          <span className="inline-flex items-center gap-1 rounded-full bg-indigo-50 px-2.5 py-1 text-xs font-medium text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300">
            共 {totalPhrases} 个短语
          </span>
          <span className="text-xs">来自 {groups.length} 天的阅读</span>
        </div>
      )}

      {/* 空状态 */}
      {!loading && groups.length === 0 ? (
        <div className="rounded-lg border border-dashed border-gray-300 bg-white p-8 text-center shadow-sm dark:border-gray-600 dark:bg-gray-800">
          <div className="mb-3 text-4xl">📝</div>
          <p className="mb-1 text-sm font-medium text-gray-900 dark:text-gray-100">
            暂无重点短语
          </p>
          <p className="mb-4 text-xs text-gray-500 dark:text-gray-400">
            完成阅读后，文章中的重点短语会自动收集到这里
          </p>
          <button
            type="button"
            onClick={() => navigate('/reading')}
            className="inline-flex items-center gap-1.5 rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-indigo-700"
          >
            去阅读
          </button>
        </div>
      ) : (
        <>
          {/* 分组列表 */}
          {groups.map((group) => (
            <section key={group.date}>
              {/* 日期分组标题 */}
              <div className="mb-2 flex items-baseline gap-2">
                <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                  {group.dateLabel}
                </h2>
                <span className="text-xs text-gray-400 dark:text-gray-500">
                  {group.phrases.length} 个短语
                </span>
              </div>

              {/* 卡片网格：移动端 1 列，平板 2 列，桌面 3 列 */}
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {group.phrases.map((ph, idx) => (
                  <PhraseFlipCard
                    key={`${ph.articleId}-${ph.phrase}-${idx}`}
                    phrase={ph}
                  />
                ))}
              </div>
            </section>
          ))}

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
                        className="h-44 animate-pulse rounded-lg bg-gray-100 dark:bg-gray-700"
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
