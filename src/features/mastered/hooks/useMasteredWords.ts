// 已掌握单词列表逻辑：分页加载、搜索防抖、排序、无限滚动与缓存失效重载
//
// 与视图解耦：页面仅负责渲染，本 hook 负责状态与副作用。
// SWR 模式：masteredService.getMasteredWords 内部使用 getAllLocalFirst，
// 本地命中后立即返回，后台静默刷新；刷新完成后通过 cacheEvents 通知本 hook 重载。
import { useCallback, useEffect, useRef, useState } from 'react'
import type { Word } from '@/shared/types'
import { useCacheInvalidated } from '@/shared/hooks/useCacheInvalidated'
import { getMasteredWords } from '../services/masteredService'
import type { MasteredSortBy } from '../types'

// 每页大小（无限滚动：每页 20 条）
const PAGE_SIZE = 20
// 搜索防抖延迟（毫秒）
const SEARCH_DEBOUNCE_MS = 300

export function useMasteredWords() {
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

  return {
    items,
    total,
    hasMore,
    loading,
    loadingMore,
    searchInput,
    setSearchInput,
    sortBy,
    setSortBy,
    sentinelRef,
  }
}
