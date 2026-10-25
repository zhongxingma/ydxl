// 生词本列表数据：查询 / 分页 / 统计 / 搜索防抖 / 缓存刷新
//
// SWR 模式：wordbookService.getWordbook 内部使用 getAllLocalFirst，
// 本地命中后立即返回，后台静默刷新；刷新完成后通过 cacheEvents 通知本 hook 重载。
import type { Dispatch, RefObject, SetStateAction } from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { Word } from '@/shared/types'
import { useCacheInvalidated } from '@/shared/hooks/useCacheInvalidated'
import type { WordbookSortBy, WordbookStats } from '../types'
import { getWordbook, getWordbookStats } from '../services/wordbookService'

const PAGE_SIZE = 20
// 搜索防抖延迟（毫秒）
const SEARCH_DEBOUNCE_MS = 300

export interface UseWordbookListResult {
  items: Word[]
  // 过滤后（未掌握 + keyword + onlyFavorite）的总数
  total: number
  hasMore: boolean
  loading: boolean
  loadingMore: boolean
  stats: WordbookStats
  searchInput: string
  setSearchInput: Dispatch<SetStateAction<string>>
  sortBy: WordbookSortBy
  setSortBy: Dispatch<SetStateAction<WordbookSortBy>>
  onlyFavorite: boolean
  setOnlyFavorite: Dispatch<SetStateAction<boolean>>
  sentinelRef: RefObject<HTMLDivElement>
  loadFirstPage: () => Promise<void>
  refreshStats: () => Promise<void>
  // 过滤后总数为 0 但统计总数 > 0：所有单词已掌握
  isAllMastered: boolean
  showInitialLoading: boolean
}

export function useWordbookList(): UseWordbookListResult {
  const [items, setItems] = useState<Word[]>([])
  // 过滤后（未掌握 + keyword + onlyFavorite）的总数
  const [total, setTotal] = useState(0)
  // 是否还有更多页可加载
  const [hasMore, setHasMore] = useState(false)
  // 首次加载中
  const [loading, setLoading] = useState(true)
  // 加载更多中
  const [loadingMore, setLoadingMore] = useState(false)
  // 统计数据（基于全部生词，含已掌握）
  const [stats, setStats] = useState<WordbookStats>({ total: 0, mastered: 0, pendingReview: 0 })

  // searchInput 为受控 input 值，keyword 为防抖后实际查询值
  const [searchInput, setSearchInput] = useState('')
  const [keyword, setKeyword] = useState('')
  const [sortBy, setSortBy] = useState<WordbookSortBy>('createdAt-desc')
  // 「仅看收藏」筛选状态
  const [onlyFavorite, setOnlyFavorite] = useState(false)

  // 防抖定时器引用
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // 底部哨兵元素引用（IntersectionObserver 监听目标）
  const sentinelRef = useRef<HTMLDivElement | null>(null)
  // 当前已加载的 offset（避免闭包陈旧值）
  const offsetRef = useRef(0)
  // 当前查询参数引用（用于 loadMore 读取最新值，避免闭包陈旧）
  const queryRef = useRef({ keyword, sortBy, onlyFavorite })
  // 是否已完成初次挂载加载（避免 mount effect 与 keyword effect 双重触发 loadFirstPage）
  const initializedRef = useRef(false)
  // 组件挂载状态标志：防止卸载后异步任务调用 setState，导致内存泄漏与 React 警告
  const mountedRef = useRef(true)

  // 刷新统计数据（基于全部生词，含已掌握）
  const refreshStats = useCallback(async () => {
    try {
      const s = await getWordbookStats()
      setStats(s)
    } catch (err) {
      console.warn('[WordbookPage] 加载统计数据失败', err)
    }
  }, [])

  // 加载第一页（重置列表）
  const loadFirstPage = useCallback(async () => {
    const query = queryRef.current
    setLoading(true)
    try {
      const res = await getWordbook({
        limit: PAGE_SIZE,
        offset: 0,
        keyword: query.keyword,
        sortBy: query.sortBy,
        onlyFavorite: query.onlyFavorite,
      })
      // 组件已卸载则放弃更新，避免对已卸载组件写入 state
      if (!mountedRef.current) return
      setItems(res.items)
      setTotal(res.total)
      offsetRef.current = res.items.length
      setHasMore(res.items.length < res.total)
    } catch (err) {
      console.warn('[WordbookPage] 加载生词列表失败', err)
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
      const res = await getWordbook({
        limit: PAGE_SIZE,
        offset: offsetRef.current,
        keyword: query.keyword,
        sortBy: query.sortBy,
        onlyFavorite: query.onlyFavorite,
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
      console.warn('[WordbookPage] 加载更多失败', err)
    } finally {
      // 组件已卸载则放弃更新
      if (mountedRef.current) setLoadingMore(false)
    }
  }, [loadingMore, hasMore])

  // 初次挂载：加载第一页 + 加载统计（仅执行一次）
  useEffect(() => {
    // 组件挂载时重置标志，供 loadFirstPage/loadMore 在异步完成后做守卫
    mountedRef.current = true
    let cancelled = false
    const init = async () => {
      if (cancelled) return
      // 同步最新查询参数后加载第一页与统计
      queryRef.current = { keyword, sortBy, onlyFavorite }
      initializedRef.current = true
      await Promise.all([loadFirstPage(), refreshStats()])
    }
    void init()
    return () => {
      // 组件卸载时翻转挂载标志，避免异步任务对已卸载组件写入 state
      mountedRef.current = false
      cancelled = true
    }
    // 仅在挂载时执行一次：keyword/sortBy/onlyFavorite 取初始值
    // 后续变化由下方 keyword effect 处理
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 订阅 words 缓存事件：wordRepository 后台刷新完成后重载第一页与统计
  useCacheInvalidated('words', () => {
    void loadFirstPage()
    void refreshStats()
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

  // keyword / sortBy / onlyFavorite 变化时重置列表并加载第一页
  useEffect(() => {
    // 初次挂载由 mount effect 处理（需等待 mount effect 设置 initializedRef 后再加载）
    if (!initializedRef.current) return
    queryRef.current = { keyword, sortBy, onlyFavorite }
    void loadFirstPage()
  }, [keyword, sortBy, onlyFavorite, loadFirstPage])

  // 无限滚动：距离视口 200px 时预加载下一页
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

  // 当过滤后总数为 0 但统计的总数 > 0 时，说明所有单词已掌握
  const isAllMastered = total === 0 && stats.total > 0

  // 加载中骨架（首次加载）
  const showInitialLoading = loading && items.length === 0

  return {
    items,
    total,
    hasMore,
    loading,
    loadingMore,
    stats,
    searchInput,
    setSearchInput,
    sortBy,
    setSortBy,
    onlyFavorite,
    setOnlyFavorite,
    sentinelRef,
    loadFirstPage,
    refreshStats,
    isAllMastered,
    showInitialLoading,
  }
}
