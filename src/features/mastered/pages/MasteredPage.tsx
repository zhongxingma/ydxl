// 已掌握单词/短语页面：卡片化网格布局 + 无限滚动分页 + 搜索/排序
// Task 5.4: 列表展示（单词、音标、释义、例句、例句翻译、相关短语）
// Task 5.5: 空状态展示"还没有已掌握的单词，继续加油 💪"
// 样式参考 wordbook 模块的 TailwindCSS 风格
import { useCallback, useEffect, useRef, useState } from 'react'
import type { Word } from '@/shared/types'
import { useCacheInvalidated } from '@/shared/hooks/useCacheInvalidated'
import { cn } from '@/shared/utils/cn'
import { speak, isSpeechSupported } from '@/shared/utils/speech'
import { getMasteredWords } from '../services/masteredService'
import type { MasteredSortBy } from '../types'

// 每页大小（无限滚动：每页 20 条）
const PAGE_SIZE = 20
// 搜索防抖延迟（毫秒）
const SEARCH_DEBOUNCE_MS = 300

// 排序方式选项：字母顺序 / 最近掌握时间 / 添加时间
const SORT_BY_OPTIONS: { value: MasteredSortBy; label: string }[] = [
  { value: 'masteredAt-desc', label: '最近掌握时间' },
  { value: 'createdAt-desc', label: '添加时间' },
  { value: 'alphabet', label: '字母顺序' },
]

export default function MasteredPage() {
  // 分页列表状态
  const [items, setItems] = useState<Word[]>([])
  // 过滤后（已掌握 + keyword）的总数
  const [total, setTotal] = useState(0)
  // 是否还有更多页可加载
  const [hasMore, setHasMore] = useState(false)
  // 首次加载中
  const [loading, setLoading] = useState(true)
  // 加载更多中
  const [loadingMore, setLoadingMore] = useState(false)

  // 搜索与排序状态
  // searchInput 为受控 input 值，keyword 为防抖后实际查询值
  const [searchInput, setSearchInput] = useState('')
  const [keyword, setKeyword] = useState('')
  const [sortBy, setSortBy] = useState<MasteredSortBy>('masteredAt-desc')

  // 防抖定时器引用
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // 底部哨兵元素引用（IntersectionObserver 监听目标）
  const sentinelRef = useRef<HTMLDivElement | null>(null)
  // 当前已加载的 offset（避免闭包陈旧值）
  const offsetRef = useRef(0)
  // 当前查询参数引用（用于 loadMore 读取最新值，避免闭包陈旧）
  const queryRef = useRef({ keyword, sortBy })
  // 是否已完成初次挂载加载（避免 mount effect 与 keyword effect 双重触发 loadFirstPage）
  const initializedRef = useRef(false)
  // 组件挂载状态标志：防止卸载后异步任务调用 setState，导致内存泄漏与 React 警告
  const mountedRef = useRef(true)

  // 加载第一页（重置列表）
  const loadFirstPage = useCallback(async () => {
    const query = queryRef.current
    setLoading(true)
    try {
      const res = await getMasteredWords({
        limit: PAGE_SIZE,
        offset: 0,
        keyword: query.keyword,
        sortBy: query.sortBy,
      })
      // 组件已卸载则放弃更新，避免对已卸载组件写入 state
      if (!mountedRef.current) return
      setItems(res.items)
      setTotal(res.total)
      offsetRef.current = res.items.length
      setHasMore(res.items.length < res.total)
    } catch (err) {
      console.warn('[MasteredPage] 加载已掌握单词列表失败', err)
      // 组件已卸载则放弃更新
      if (!mountedRef.current) return
      setItems([])
      setTotal(0)
      setHasMore(false)
    } finally {
      // 组件已卸载则放弃更新
      if (mountedRef.current) setLoading(false)
    }
  }, [])

  // 加载下一页（无限滚动触发）
  const loadMore = useCallback(async () => {
    if (loadingMore || !hasMore) return
    const query = queryRef.current
    setLoadingMore(true)
    try {
      const res = await getMasteredWords({
        limit: PAGE_SIZE,
        offset: offsetRef.current,
        keyword: query.keyword,
        sortBy: query.sortBy,
      })
      // 组件已卸载则放弃更新，避免对已卸载组件写入 state
      if (!mountedRef.current) return
      // 追加到已加载列表（按 id 去重，避免边界重复）
      setItems((prev) => {
        const existingIds = new Set(prev.map((w) => w.id))
        const merged = [...prev, ...res.items.filter((w) => !existingIds.has(w.id))]
        return merged
      })
      offsetRef.current += res.items.length
      setHasMore(offsetRef.current < res.total)
    } catch (err) {
      console.warn('[MasteredPage] 加载更多失败', err)
    } finally {
      // 组件已卸载则放弃更新
      if (mountedRef.current) setLoadingMore(false)
    }
  }, [loadingMore, hasMore])

  // 初次挂载：加载第一页（仅执行一次）
  // SWR 模式：masteredService.getMasteredWords 内部使用 getAllLocalFirst，
  //          本地命中后立即返回，后台静默刷新；刷新完成后通过 cacheEvents 通知本页面重载
  useEffect(() => {
    // 组件挂载时重置标志，供 loadFirstPage/loadMore 在异步完成后做守卫
    mountedRef.current = true
    let cancelled = false
    const init = async () => {
      if (cancelled) return
      // 同步最新查询参数后加载第一页
      queryRef.current = { keyword, sortBy }
      initializedRef.current = true
      await loadFirstPage()
    }
    void init()
    return () => {
      // 组件卸载时翻转挂载标志，避免异步任务对已卸载组件写入 state
      mountedRef.current = false
      cancelled = true
    }
    // 仅在挂载时执行一次：keyword/sortBy 取初始值
    // 后续变化由下方 keyword effect 处理
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 订阅 words 缓存事件：wordRepository 后台刷新完成后重载第一页
  // SWR 模式下后台刷新可能更新本地缓存（如跨终端同步），需重读以刷新 UI
  useCacheInvalidated('words', () => {
    void loadFirstPage()
  })

  // 搜索防抖：searchInput 变化后 300ms 更新 keyword（触发 loadFirstPage）
  useEffect(() => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current)
    }
    debounceTimerRef.current = setTimeout(() => {
      setKeyword(searchInput)
    }, SEARCH_DEBOUNCE_MS)
    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current)
      }
    }
  }, [searchInput])

  // keyword / sortBy 变化时重置列表并加载第一页
  useEffect(() => {
    // 初次挂载由 mount effect 处理（需等待 mount effect 设置 initializedRef 后再加载）
    if (!initializedRef.current) return
    queryRef.current = { keyword, sortBy }
    void loadFirstPage()
  }, [keyword, sortBy, loadFirstPage])

  // 无限滚动：IntersectionObserver 监听底部哨兵元素
  useEffect(() => {
    const sentinel = sentinelRef.current
    if (!sentinel) return
    // 不支持 IntersectionObserver 时降级为不自动加载（保留手动能力）
    if (typeof IntersectionObserver === 'undefined') return

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            void loadMore()
          }
        }
      },
      // 距离视口 200px 时预加载，提升体验
      { rootMargin: '200px' },
    )
    observer.observe(sentinel)
    // cleanup：卸载时断开观察，避免内存泄漏与对已卸载组件 setState
    return () => {
      observer.disconnect()
    }
  }, [loadMore])

  // 首次加载中骨架
  const showInitialLoading = loading && items.length === 0

  return (
    <div className="space-y-4 pb-8">
      {/* 页面标题 */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">已掌握</h1>
        {/* 总数概览 */}
        {!showInitialLoading && total > 0 && (
          <span className="text-sm text-gray-500 dark:text-gray-400">
            共 {total} 个
          </span>
        )}
      </div>

      {/* 顶部工具栏：搜索 + 排序 */}
      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
        {/* 搜索框 */}
        <div className="relative flex-1">
          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={1.5}
              stroke="currentColor"
              className="h-4 w-4"
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z"
              />
            </svg>
          </span>
          <input
            type="text"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="搜索单词…"
            className="w-full rounded-md border border-gray-300 bg-white py-2 pl-9 pr-3 text-sm text-gray-800 placeholder:text-gray-400 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 dark:placeholder:text-gray-500"
            aria-label="搜索单词"
          />
        </div>

        {/* 排序选择 */}
        <select
          value={sortBy}
          onChange={(e) => setSortBy(e.target.value as MasteredSortBy)}
          className="rounded-md border border-gray-300 bg-white py-2 pl-3 pr-8 text-sm text-gray-800 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
          aria-label="排序方式"
        >
          {SORT_BY_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>

      {/* 首次加载中 */}
      {showInitialLoading ? (
        <div className="py-16 text-center text-gray-500 dark:text-gray-400">加载中…</div>
      ) : total === 0 ? (
        // 空状态（Task 5.5）
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-indigo-300 bg-indigo-50/50 py-16 px-4 text-center dark:border-indigo-700 dark:bg-indigo-900/10">
          <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-indigo-100 text-3xl dark:bg-indigo-900/40">
            💪
          </div>
          <p className="text-base font-medium text-indigo-700 dark:text-indigo-300">
            还没有已掌握的单词，继续加油 💪
          </p>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            通过复习让单词达到掌握即可在此查看
          </p>
        </div>
      ) : (
        <>
          {/* 已掌握单词卡片网格：响应式 1/2/3 列 */}
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
            {items.map((word) => (
              <MasteredWordCard key={word.id} word={word} />
            ))}
          </div>

          {/* 无限滚动底部哨兵 + 加载状态 */}
          <div
            ref={sentinelRef}
            className="flex h-12 items-center justify-center text-sm text-gray-400 dark:text-gray-500"
            aria-hidden={loadingMore ? undefined : true}
          >
            {loadingMore
              ? '加载更多…'
              : hasMore
                ? '滚动加载更多'
                : '没有更多了'}
          </div>
        </>
      )}
    </div>
  )
}

// 单个已掌握单词卡片：展示单词、音标、释义、例句、例句翻译、相关短语
interface MasteredWordCardProps {
  word: Word
}

function MasteredWordCard({ word }: MasteredWordCardProps) {
  // 相关短语展开/收起状态
  const [phrasesExpanded, setPhrasesExpanded] = useState(false)

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4 transition-colors hover:border-gray-300 dark:border-gray-700 dark:bg-gray-800 dark:hover:border-gray-600">
      {/* 头部：单词 + 发音按钮 + 音标 + 已掌握徽章 */}
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <h3 className="text-xl font-semibold text-gray-900 dark:text-gray-100">
          {word.word}
        </h3>
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
        {/* 已掌握徽章 */}
        <span className="inline-flex items-center rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700 dark:bg-green-900/40 dark:text-green-300">
          ✓ 已掌握
        </span>
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
            onClick={() => setPhrasesExpanded((v) => !v)}
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
    </div>
  )
}
