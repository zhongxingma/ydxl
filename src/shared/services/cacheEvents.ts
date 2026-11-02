// 缓存失效事件总线
// 后台刷新成功后由 CachedRemoteRepository 发出，供页面订阅触发 UI 更新
//
// 设计目的：
// - 解耦 Repository（不依赖 React）与页面层（订阅事件刷新 UI）
// - 精确通知：按表名订阅，避免无关页面被触发
// - listener 异常隔离：单个 listener 抛错不影响其他订阅者
//
// 使用方式：
//   // 订阅
//   const off = cacheEvents.on('articles', () => { refetch() })
//   // 取消订阅
//   off()
//   // 触发（由 CachedRemoteRepository 后台刷新完成后调用）
//   cacheEvents.emit('articles')

// 受管理的表名集合（与 server 端 7 张表对应）
import { logger } from '../utils/logger'
export type CacheTableName =
  | 'articles'
  | 'questions'
  | 'words'
  | 'reviews'
  | 'stats'
  | 'readingSessions'
  | 'achievements'

// 订阅回调签名：无参，触发时由订阅方自行重读本地缓存
type CacheListener = () => void

class CacheEventBus {
  private listeners = new Map<CacheTableName, Set<CacheListener>>()

  /**
   * 订阅指定表的缓存失效事件
   * @param table 表名
   * @param listener 回调函数（在 emit 时被调用）
   * @returns 取消订阅函数；调用后移除该 listener
   */
  on(table: CacheTableName, listener: CacheListener): () => void {
    let set = this.listeners.get(table)
    if (!set) {
      set = new Set()
      this.listeners.set(table, set)
    }
    set.add(listener)
    return () => {
      const s = this.listeners.get(table)
      if (s) {
        s.delete(listener)
        // Set 为空时清理，避免内存泄漏
        if (s.size === 0) {
          this.listeners.delete(table)
        }
      }
    }
  }

  /**
   * 触发指定表的缓存失效事件
   * - 单个 listener 抛错时仅 console.warn，不影响其他订阅者
   * @param table 表名
   */
  emit(table: CacheTableName): void {
    const set = this.listeners.get(table)
    if (!set || set.size === 0) return
    // 复制一份再遍历，避免回调中取消订阅导致迭代异常
    for (const listener of Array.from(set)) {
      try {
        listener()
      } catch (err) {
        // 隔离错误：单个 listener 异常不影响其他订阅者
        if (import.meta.env.DEV) {
          logger.warn(`[cacheEvents] listener for "${table}" threw`, err)
        }
      }
    }
  }

  /**
   * 清空全部订阅（仅供测试使用）
   */
  clear(): void {
    this.listeners.clear()
  }
}

// 单例事件总线，全局共享
export const cacheEvents = new CacheEventBus()
