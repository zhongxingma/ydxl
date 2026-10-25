// 远程 → 本地缓存同步工具
//
// - 增量更新：仅当远程 updated_at 更新或本地不存在时写入，保护本地较新数据
// - best-effort：本地写入失败不影响远程主流程
import type { BaseEntity } from '@/shared/types'
import type { Repository } from './repository'

/**
 * 判断是否需要将远程记录同步到本地缓存（增量更新策略）
 * - 本地不存在 → true（新记录需写入）
 * - remote.updated_at > local.updated_at → true（远程较新，需覆盖）
 * - 否则 → false（本地已为最新或更新，跳过覆盖以保护本地数据）
 */
export function shouldUpdate<T extends BaseEntity>(
  localItem: T | undefined,
  remoteItem: T,
): boolean {
  // 本地不存在 → 直接写入
  if (!localItem) return true
  // 比较 updated_at 时间戳：仅当远程严格更新时才覆盖本地
  const localUpdated = (localItem as BaseEntity).updated_at ?? 0
  const remoteUpdated = (remoteItem as BaseEntity).updated_at ?? 0
  return remoteUpdated > localUpdated
}

/**
 * 增量同步一批远程记录到本地缓存（仅覆盖较新记录）
 * best-effort：单条失败不影响其余记录
 */
export async function syncNewerItems<T extends BaseEntity>(
  local: Repository<T>,
  items: T[],
): Promise<void> {
  await Promise.allSettled(
    items.map(async (item) => {
      const localItem = await local.getById(item.id)
      if (shouldUpdate(localItem, item)) {
        await local.put(item)
      }
    }),
  )
}

/**
 * 直接写入一批远程记录到本地缓存（不做 updated_at 比较）
 * 用于服务器分页/最近记录读取后的缓存同步
 */
export async function putItems<T extends BaseEntity>(
  local: Repository<T>,
  items: T[],
): Promise<void> {
  await Promise.allSettled(items.map((item) => local.put(item)))
}
