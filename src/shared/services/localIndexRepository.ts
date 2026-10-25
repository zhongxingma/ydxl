// 本地索引查询基类：将 where/count 等 Dexie 索引查询统一委托给本地 Repository
//
// 由 CachedRemoteRepository 继承，避免把大量索引查询样板方法堆在缓存仓储实现中。
// 所有查询直接使用本地 Dexie 缓存（快速，避免网络请求）。
import type { BaseEntity } from '@/shared/types'
import type { Repository } from './repository'

export class LocalIndexRepository<T extends BaseEntity> {
  constructor(protected readonly local: Repository<T>) {}

  /**
   * 按索引字段精确匹配查询（使用本地 Dexie 索引，避免全表扫描）
   * @param field 索引字段名
   * @param value 匹配值
   * @returns 匹配的记录数组
   */
  async whereEquals<K extends keyof T>(field: K, value: T[K]): Promise<T[]> {
    return this.local.whereEquals(field, value)
  }

  /**
   * 按索引字段精确匹配查询并附加过滤（使用本地 Dexie 索引）
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
    return this.local.whereEqualsFiltered(field, value, filter)
  }

  /**
   * 按索引字段范围查询（使用本地 Dexie 索引）
   * @param field 索引字段名
   * @param lower 范围下界（含）
   * @param upper 范围上界（含）
   * @returns 范围内的记录数组
   */
  async whereBetween<K extends keyof T>(field: K, lower: T[K], upper: T[K]): Promise<T[]> {
    return this.local.whereBetween(field, lower, upper)
  }

  /**
   * 按索引字段大于某值查询（使用本地 Dexie 索引）
   * @param field 索引字段名
   * @param value 比较值
   * @returns 大于该值的记录数组
   */
  async whereAbove<K extends keyof T>(field: K, value: T[K]): Promise<T[]> {
    return this.local.whereAbove(field, value)
  }

  /**
   * 按索引字段大于等于某值查询（使用本地 Dexie 索引）
   * @param field 索引字段名
   * @param value 比较值
   * @returns 大于等于该值的记录数组
   */
  async whereAboveOrEqual<K extends keyof T>(field: K, value: T[K]): Promise<T[]> {
    return this.local.whereAboveOrEqual(field, value)
  }

  /**
   * 按索引字段大于等于某值查询并附加过滤（使用本地 Dexie 索引）
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
    return this.local.whereAboveOrEqualFiltered(field, value, filter)
  }

  /**
   * 按索引字段小于等于某值查询（使用本地 Dexie 索引）
   * @param field 索引字段名
   * @param value 比较值
   * @returns 小于等于该值的记录数组
   */
  async whereBelowOrEqual<K extends keyof T>(field: K, value: T[K]): Promise<T[]> {
    return this.local.whereBelowOrEqual(field, value)
  }

  /**
   * 按索引字段大于某值的记录数（使用本地 Dexie count，避免加载数据到内存）
   * @param field 索引字段名
   * @param value 比较值
   * @returns 大于该值的记录数
   */
  async countWhereAbove<K extends keyof T>(field: K, value: T[K]): Promise<number> {
    return this.local.countWhereAbove(field, value)
  }

  /**
   * 按索引字段小于等于某值的记录数（使用本地 Dexie count）
   * @param field 索引字段名
   * @param value 比较值
   * @returns 小于等于该值的记录数
   */
  async countWhereBelowOrEqual<K extends keyof T>(field: K, value: T[K]): Promise<number> {
    return this.local.countWhereBelowOrEqual(field, value)
  }
}
