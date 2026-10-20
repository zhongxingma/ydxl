import type { Table, UpdateSpec } from 'dexie'
import type { BaseEntity } from '@/shared/types'
import { StorageQuotaError, cleanupDerivedData } from './storageManager'

/**
 * 判断错误是否为 QuotaExceededError（存储空间不足）
 * Dexie 在 IndexedDB 配额超限时抛出的错误 name 为 'QuotaExceededError'，
 * 也可能是 DOMException with name 'QuotaExceededError'。
 *
 * 导出供测试使用。
 *
 * @param err 捕获的错误
 * @returns true 表示该错误为存储空间不足错误
 */
export function isQuotaExceededError(err: unknown): boolean {
  if (!(err instanceof Error)) return false
  return err.name === 'QuotaExceededError'
}

// 泛型 Repository：封装 Dexie 表的通用 CRUD 操作
// 自动维护 updated_at 字段为当前时间戳，用于后续同步冲突解决（Last-Write-Wins）
export class Repository<T extends BaseEntity> {
  constructor(protected readonly table: Table<T, string>) {}

  /**
   * 获取全部记录
   * @returns 全部记录数组
   */
  async getAll(): Promise<T[]> {
    return this.table.toArray()
  }

  /**
   * 获取记录数（使用 Dexie count，避免加载全部数据到内存）
   * @returns 记录总数
   */
  async count(): Promise<number> {
    return this.table.count()
  }

  /**
   * 按 updated_at 倒序获取最近 N 条记录（使用索引，避免全表扫描）
   * @param limit 返回记录数上限，默认 100
   * @returns 最近 N 条记录数组
   */
  async getRecent(limit = 100): Promise<T[]> {
    return this.table.orderBy('updated_at').reverse().limit(limit).toArray()
  }

  /**
   * 按索引字段精确匹配查询（field 必须是已索引字段）
   * @param field 索引字段名
   * @param value 匹配值
   * @returns 匹配的记录数组
   */
  async whereEquals<K extends keyof T>(field: K, value: T[K]): Promise<T[]> {
    return this.table.where(field as string).equals(value as never).toArray()
  }

  /**
   * 按索引字段精确匹配查询，并附加内存过滤（field 必须是已索引字段）
   * @param field 索引字段名
   * @param value 匹配值
   * @param filter 内存过滤函数，仅保留返回 true 的记录
   * @returns 匹配且通过过滤的记录数组
   */
  async whereEqualsFiltered<K extends keyof T>(
    field: K,
    value: T[K],
    filter: (item: T) => boolean,
  ): Promise<T[]> {
    return this.table.where(field as string).equals(value as never).filter(filter).toArray()
  }

  /**
   * 按索引字段范围查询（含两端）
   * @param field 索引字段名
   * @param lower 范围下界（含）
   * @param upper 范围上界（含）
   * @returns 范围内的记录数组
   */
  async whereBetween<K extends keyof T>(field: K, lower: T[K], upper: T[K]): Promise<T[]> {
    return this.table.where(field as string).between(lower, upper, true, true).toArray()
  }

  /**
   * 按索引字段大于某值查询
   * @param field 索引字段名
   * @param value 比较值
   * @returns 大于该值的记录数组
   */
  async whereAbove<K extends keyof T>(field: K, value: T[K]): Promise<T[]> {
    return this.table.where(field as string).above(value as never).toArray()
  }

  /**
   * 按索引字段大于等于某值查询
   * @param field 索引字段名
   * @param value 比较值
   * @returns 大于等于该值的记录数组
   */
  async whereAboveOrEqual<K extends keyof T>(field: K, value: T[K]): Promise<T[]> {
    return this.table.where(field as string).aboveOrEqual(value as never).toArray()
  }

  /**
   * 按索引字段大于等于某值查询，并附加内存过滤
   * @param field 索引字段名
   * @param value 比较值
   * @param filter 内存过滤函数，仅保留返回 true 的记录
   * @returns 大于等于该值且通过过滤的记录数组
   */
  async whereAboveOrEqualFiltered<K extends keyof T>(
    field: K,
    value: T[K],
    filter: (item: T) => boolean,
  ): Promise<T[]> {
    return this.table
      .where(field as string)
      .aboveOrEqual(value as never)
      .filter(filter)
      .toArray()
  }

  /**
   * 按索引字段小于等于某值查询
   * @param field 索引字段名
   * @param value 比较值
   * @returns 小于等于该值的记录数组
   */
  async whereBelowOrEqual<K extends keyof T>(field: K, value: T[K]): Promise<T[]> {
    return this.table.where(field as string).belowOrEqual(value as never).toArray()
  }

  /**
   * 按索引字段大于某值的记录数（使用 Dexie count，避免加载数据到内存）
   * @param field 索引字段名
   * @param value 比较值
   * @returns 大于该值的记录数
   */
  async countWhereAbove<K extends keyof T>(field: K, value: T[K]): Promise<number> {
    return this.table.where(field as string).above(value as never).count()
  }

  /**
   * 按索引字段小于等于某值的记录数
   * @param field 索引字段名
   * @param value 比较值
   * @returns 小于等于该值的记录数
   */
  async countWhereBelowOrEqual<K extends keyof T>(field: K, value: T[K]): Promise<number> {
    return this.table.where(field as string).belowOrEqual(value as never).count()
  }

  /**
   * 按主键获取单条记录
   * @param id 记录主键
   * @returns 匹配的记录；不存在时返回 undefined
   */
  async getById(id: string): Promise<T | undefined> {
    return this.table.get(id)
  }

  /**
   * 新增记录：自动写入 updated_at 为当前时间戳
   * @param entity 实体数据（updated_at 可选，由方法自动填充）
   * @returns 新增记录的主键
   */
  async add(entity: Omit<T, 'updated_at'> & { updated_at?: number }): Promise<string> {
    const entityWithTimestamp = { ...entity, updated_at: Date.now() } as T
    return this.table.add(entityWithTimestamp)
  }

  /**
   * 部分更新记录：自动刷新 updated_at 为当前时间戳
   * Dexie 的 UpdateSpec<T> 是基于 KeyPaths 的复杂映射类型，对泛型 T 无法静态推断，
   * 故通过 unknown 中转进行类型断言
   * @param id 记录主键
   * @param patch 需更新的字段（updated_at 由方法自动填充）
   * @returns 实际更新的记录数（0 表示未找到对应记录）
   */
  async update(id: string, patch: Partial<Omit<T, 'updated_at'>>): Promise<number> {
    const changes = { ...patch, updated_at: Date.now() } as unknown as UpdateSpec<T>
    return this.table.update(id, changes)
  }

  /**
   * 按主键删除单条记录
   * @param id 记录主键
   */
  async delete(id: string): Promise<void> {
    await this.table.delete(id)
  }

  /**
   * 批量删除记录
   * @param ids 待删除记录的主键数组
   */
  async bulkDelete(ids: string[]): Promise<void> {
    await this.table.bulkDelete(ids)
  }

  /**
   * upsert：存在则更新整条记录，不存在则新增
   * 用于将远程数据同步到本地缓存（Dexie 离线只读缓存）
   *
   * - 捕获 QuotaExceededError（存储空间不足），触发 cleanupDerivedData 紧急清理后重试一次
   * - 重试仍失败抛出 StorageQuotaError，由上层采用 best-effort 策略降级
   * - 非 QuotaExceededError 原样抛出
   *
   * @param entity 完整实体数据
   * @returns 写入记录的主键
   * @throws StorageQuotaError 清理后仍无法写入时抛出
   */
  async put(entity: T): Promise<string> {
    try {
      return await this.table.put(entity)
    } catch (err) {
      // 仅对 QuotaExceededError 触发紧急清理 + 重试
      if (!isQuotaExceededError(err)) {
        throw err
      }
      // 紧急清理派生数据（best-effort，清理失败不阻塞重试）
      // 循环依赖说明：storageManager ← repositories ← repository ← storageManager
      // ES module live binding 机制下安全：cleanupDerivedData 仅在函数体内调用（非模块加载时）
      try {
        await cleanupDerivedData()
      } catch (cleanupErr) {
        console.warn('[Repository] cleanupDerivedData 紧急清理失败', cleanupErr)
      }
      // 重试一次
      try {
        return await this.table.put(entity)
      } catch (retryErr) {
        if (isQuotaExceededError(retryErr)) {
          throw new StorageQuotaError(
            `存储空间不足，清理后仍无法写入: ${entity.id ?? 'unknown'}`,
          )
        }
        throw retryErr
      }
    }
  }
}
