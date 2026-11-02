// 窗口化虚拟滚动列表（M1）
//
// 列表页统一使用 window 滚动（Layout 为 min-h-screen，无内部滚动容器），因此本组件
// 直接监听 window 的 scroll / resize 事件，只渲染视口范围内的「行」，其余行以容器
// 总高度占位，使 DOM 节点数与数据量解耦（O(视口) 而非 O(列表长度)）。
//
// 设计要点：
// - 行高优先使用实测值，未测量行回退调用方提供的估算值，因此支持可变高度卡片。
// - 已渲染行挂 ResizeObserver：卡片内部展开（如短语展开）改变高度时实时回写，避免行重叠。
// - 行键（getKey）同时作为高度缓存的键，搜索/排序后行复用可避免高度抖动。
// - 首屏与滚动使用同一套区间计算，容器在视口下方时也能正确渲染前几行。
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'

export interface VirtualListProps<T> {
  // 已切分为「行」的数据（网格场景请先用 chunkRows 按列数切分）
  rows: T[]
  // 行高估算值（支持按行差异化，如分组标题行与卡片行）
  estimateRowHeight: number | ((row: T, index: number) => number)
  // 行渲染函数
  renderRow: (row: T, index: number) => ReactNode
  // 行唯一键（用于 React key 与高度缓存）
  getKey: (row: T, index: number) => string | number
  // 视口外额外渲染的行数（减少快速滚动时的空白）
  overscan?: number
  // 行间距（px），需与行内 gap 视觉一致
  rowGap?: number
  // 容器 class（用于外边距等）
  className?: string
  // 行容器 class
  rowClassName?: string
}

// 首屏渲染行数：实际区间在渲染后立即由 layout effect 校正
const INITIAL_RENDER_ROWS = 8
// 高度变化容差（px），避免亚像素测量抖动引发重复渲染
const HEIGHT_TOLERANCE = 1

export default function VirtualList<T>({
  rows,
  estimateRowHeight,
  renderRow,
  getKey,
  overscan = 4,
  rowGap = 0,
  className,
  rowClassName,
}: VirtualListProps<T>) {
  // 列表容器（相对定位，行以绝对定位 + translateY 排布）
  const containerRef = useRef<HTMLDivElement | null>(null)
  // 行高缓存：key → 实测高度
  const heightsRef = useRef<Map<string, number>>(new Map())
  // 已挂载行节点：key → DOM（用于 ResizeObserver 解绑）
  const rowNodesRef = useRef<Map<string, HTMLDivElement>>(new Map())
  // 行尺寸监听器（懒创建，避免在渲染期实例化）
  const resizeObserverRef = useRef<ResizeObserver | null>(null)
  // 高度实测触发的重渲染计数
  const [heightVersion, setHeightVersion] = useState(0)
  // 当前渲染的行区间 [start, end)
  const [range, setRange] = useState({ start: 0, end: INITIAL_RENDER_ROWS })

  const rowKeyOf = useCallback(
    (row: T, index: number) => String(getKey(row, index)),
    [getKey],
  )

  // 写入实测高度；容差内视为未变化，返回是否发生更新
  const commitHeight = useCallback((key: string, height: number) => {
    if (height <= 0) return false
    const prev = heightsRef.current.get(key)
    if (prev != null && Math.abs(prev - height) < HEIGHT_TOLERANCE) return false
    heightsRef.current.set(key, height)
    return true
  }, [])

  // 懒创建 ResizeObserver（jsdom 等环境不存在时返回 null，退化为一次性测量）
  const ensureObserver = useCallback(() => {
    if (resizeObserverRef.current) return resizeObserverRef.current
    if (typeof ResizeObserver === 'undefined') return null
    const instance = new ResizeObserver((entries) => {
      let changed = false
      for (const entry of entries) {
        const node = entry.target as HTMLDivElement
        const key = node.dataset.rowKey
        if (key && commitHeight(key, entry.contentRect.height)) changed = true
      }
      if (changed) setHeightVersion((v) => v + 1)
    })
    resizeObserverRef.current = instance
    return instance
  }, [commitHeight])

  // 行偏移表与容器总高度：实测高度优先，其余使用估算值
  const layout = useMemo(() => {
    // 读取 heightVersion：实测行高更新后需要强制重建偏移表
    void heightVersion
    const offsets: number[] = Array.from({ length: rows.length }, () => 0)
    let total = 0
    for (let i = 0; i < rows.length; i++) {
      offsets[i] = total
      const estimate =
        typeof estimateRowHeight === 'function'
          ? estimateRowHeight(rows[i], i)
          : estimateRowHeight
      total += (heightsRef.current.get(rowKeyOf(rows[i], i)) ?? estimate) + rowGap
    }
    return { offsets, totalHeight: rows.length > 0 ? Math.max(0, total - rowGap) : 0 }
  }, [rows, rowKeyOf, estimateRowHeight, rowGap, heightVersion])

  // 依据容器在视口中的位置计算可见行区间（偏移表升序，二分定位起始行）
  const updateRange = useCallback(() => {
    const container = containerRef.current
    const count = rows.length
    if (!container || count === 0) {
      setRange((prev) => (prev.start === 0 && prev.end === 0 ? prev : { start: 0, end: 0 }))
      return
    }
    const viewportHeight = window.innerHeight || 768
    const containerTop = container.getBoundingClientRect().top
    // 视口上下边界换算到「容器坐标系」
    const visibleTop = Math.max(0, -containerTop)
    const visibleBottom = viewportHeight - containerTop

    // 最后一个 offset <= visibleTop 的行即为可见起始行
    let start = 0
    let lo = 0
    let hi = count - 1
    while (lo <= hi) {
      const mid = (lo + hi) >> 1
      if (layout.offsets[mid] <= visibleTop) {
        start = mid
        lo = mid + 1
      } else {
        hi = mid - 1
      }
    }

    // 第一个 offset >= visibleBottom 的行即为可见区的排他结束行
    let end = start + 1
    while (end < count && layout.offsets[end] < visibleBottom) end++

    const nextStart = Math.max(0, start - overscan)
    const nextEnd = Math.min(count, end + overscan)
    setRange((prev) =>
      prev.start === nextStart && prev.end === nextEnd
        ? prev
        : { start: nextStart, end: nextEnd },
    )
  }, [layout.offsets, rows.length, overscan])

  // 渲染后立即校正区间（首帧、rows 变化、行高更新都会触发）
  useLayoutEffect(() => {
    updateRange()
  }, [updateRange])

  // 滚动 / 窗口尺寸变化时重新计算区间
  useEffect(() => {
    window.addEventListener('scroll', updateRange, { passive: true })
    window.addEventListener('resize', updateRange)
    return () => {
      window.removeEventListener('scroll', updateRange)
      window.removeEventListener('resize', updateRange)
    }
  }, [updateRange])

  // 挂载/卸载行的测量与监听：
  // - 新行挂载后同步测量一次（ResizeObserver 首次回调前也能立即对齐布局）
  // - 已挂载行接入 ResizeObserver，卡片内部展开导致的高度变化可实时回写
  useLayoutEffect(() => {
    const container = containerRef.current
    if (!container) return
    const observer = ensureObserver()
    let changed = false
    const mountedKeys = new Set<string>()
    for (const child of Array.from(container.children)) {
      const node = child as HTMLDivElement
      const key = node.dataset.rowKey
      if (!key) continue
      mountedKeys.add(key)
      if (commitHeight(key, node.getBoundingClientRect().height)) changed = true
      if (observer && !rowNodesRef.current.has(key)) {
        rowNodesRef.current.set(key, node)
        observer.observe(node)
      }
    }
    // 解绑已卸载的行
    for (const [key, node] of rowNodesRef.current) {
      if (!mountedKeys.has(key)) {
        observer?.unobserve(node)
        rowNodesRef.current.delete(key)
      }
    }
    if (changed) setHeightVersion((v) => v + 1)
  }, [range, rows, ensureObserver, commitHeight])

  // 卸载时释放 ResizeObserver
  useEffect(() => {
    const mountedNodes = rowNodesRef.current
    return () => {
      resizeObserverRef.current?.disconnect()
      resizeObserverRef.current = null
      mountedNodes.clear()
    }
  }, [])

  return (
    <div
      ref={containerRef}
      className={className}
      style={{ position: 'relative', height: layout.totalHeight }}
    >
      {rows.slice(range.start, range.end).map((row, i) => {
        const index = range.start + i
        const key = rowKeyOf(row, index)
        return (
          <div
            key={key}
            data-index={index}
            data-row-key={key}
            className={rowClassName}
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: '100%',
              transform: `translateY(${layout.offsets[index]}px)`,
            }}
          >
            {renderRow(row, index)}
          </div>
        )
      })}
    </div>
  )
}
