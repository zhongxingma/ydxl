// 订阅缓存失效事件的 React Hook
// 当 CachedRemoteRepository 后台刷新完成并发出 cacheEvents.emit(table) 时，
// 订阅方页面可重读本地缓存以更新 UI（实现 SWR 模式下的"数据新鲜度自动同步"）
//
// 使用示例：
//   useCacheInvalidated('articles', () => { void reload() })
//   useCacheInvalidated('words', () => { void loadFirstPage() }, !loading)
import { useEffect, useRef } from 'react'
import { cacheEvents, type CacheTableName } from '@/shared/services/cacheEvents'

/**
 * 订阅指定表的缓存失效事件
 * - 在组件挂载时注册订阅，卸载时自动取消
 * - 使用 ref 保存最新 callback，确保事件触发时调用最新闭包（避免 stale closure）
 * - 仅在 table/enabled 变化时重新订阅，避免频繁订阅/取消
 *
 * @param table 订阅的表名
 * @param callback 收到事件时的回调（通常为重读本地缓存的函数）
 * @param enabled 是否启用订阅；为 false 时不订阅（默认 true）
 */
export function useCacheInvalidated(
  table: CacheTableName,
  callback: () => void,
  enabled: boolean = true,
): void {
  // 用 ref 保存最新 callback，事件触发时调用 ref.current 而非闭包捕获的旧值
  // 这样 callback 闭包随渲染更新时，订阅方仍能调用最新版本，避免 stale closure
  const callbackRef = useRef(callback)
  callbackRef.current = callback

  useEffect(() => {
    if (!enabled) return
    // 包一层 handler，从 ref 取最新 callback
    const handler = () => callbackRef.current()
    // 注册订阅，返回取消函数
    const off = cacheEvents.on(table, handler)
    return off
    // table 与 enabled 通常稳定；callback 通过 ref 透传，无需放入依赖
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [table, enabled])
}
