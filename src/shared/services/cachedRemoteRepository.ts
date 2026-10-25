// 带本地缓存的远程 Repository：服务器为主 + Dexie 离线只读缓存
//
// 错误处理策略：
// - 远程操作为主，失败时回退本地缓存（best-effort），仅记录 dev 日志
// - 本地缓存更新失败不影响主流程，仅记录 dev 日志
// - 关键路径错误向上抛出，由调用方处理
//
// 本地优先读取（SWR 模式）：
// - getAllLocalFirst / getByIdLocalFirst：立即返回本地 Dexie 缓存，后台异步刷新服务器数据
// - 后台刷新完成后通过 cacheEvents 事件总线通知订阅方更新 UI
// - 30 秒节流：避免重复进入页面或事件回调中重复触发后台刷新
//
// 索引查询（where/count）由 LocalIndexRepository 基类统一委托本地 Dexie；
// 远程 → 本地增量同步工具在 cacheSync.ts。
import type { BaseEntity } from '@/shared/types'
import type { Repository } from './repository'
import { cacheEvents, type CacheTableName } from './cacheEvents'
import type { PaginatedResponse, RemoteRepository } from './remoteRepositoryBase'
import { LocalIndexRepository } from './localIndexRepository'
import { putItems, shouldUpdate, syncNewerItems } from './cacheSync'

// 后台刷新节流窗口（毫秒）：同一表在此时长内不重复触发后台刷新
const BACKGROUND_REFRESH_THROTTLE_MS = 30_000

// 带本地缓存的远程 Repository（服务器为主 + Dexie 离线只读缓存）
// - 读取：先请求服务器，成功后同步到本地缓存；网络失败时回退到本地缓存
// - 写入：写入服务器，成功后同步更新本地缓存
// - count/where 等索引查询：直接使用本地 Dexie 缓存（快速，避免网络请求）
// - 本地优先读取（SWR）：getAllLocalFirst / getByIdLocalFirst 立即返回本地缓存，后台异步刷新
export class CachedRemoteRepository<T extends BaseEntity> extends LocalIndexRepository<T> {
  // 后台刷新时间戳（毫秒），用于 30 秒节流：避免重复触发后台刷新
  private lastBackgroundRefreshAt = 0

  constructor(
    private readonly remote: RemoteRepository<T>,
    local: Repository<T>,
    // 表名，用于 cacheEvents 事件总线精确通知订阅方
    private readonly tableName: CacheTableName,
  ) {
    super(local)
  }

  /**
   * 获取全部记录（服务器优先，失败时回退本地缓存）
   * @returns 全部记录数组
   */
  async getAll(): Promise<T[]> {
    try {
      const items = await this.remote.getAll()
      // 增量同步到本地缓存：仅当远程 updated_at 更新时写入，避免覆盖本地较新数据
      await syncNewerItems(this.local, items)
      return items
    } catch (err) {
      // 离线回退：从本地缓存读取
      console.warn('[CachedRemoteRepository] 服务器不可用，回退到本地缓存', err)
      return this.local.getAll()
    }
  }

  /**
   * 分页获取记录（服务器为主，离线回退到本地 getRecent）
   * @param limit 每页记录数上限，默认 100
   * @param offset 偏移量，默认 0
   * @returns 分页响应（含 items、total、limit、offset）
   */
  async getPage(limit = 100, offset = 0): Promise<PaginatedResponse<T>> {
    try {
      const res = await this.remote.getPage(limit, offset)
      // 同步到本地缓存
      await putItems(this.local, res.items)
      return res
    } catch (err) {
      console.warn('[CachedRemoteRepository] 服务器不可用，回退到本地缓存', err)
      const items = offset === 0 ? await this.local.getRecent(limit) : await this.local.getAll()
      return {
        items: offset === 0 ? items : items.slice(offset, offset + limit),
        total: await this.local.count(),
        limit,
        offset,
      }
    }
  }

  /**
   * 获取记录数（服务器优先，失败时回退本地 Dexie count）
   * @returns 记录总数
   */
  async count(): Promise<number> {
    try {
      const res = await this.remote.getPage(1, 0)
      return res.total
    } catch (err) {
      console.warn('[CachedRemoteRepository] count 服务器不可用，回退本地', err)
      return this.local.count()
    }
  }

  /**
   * 按 updated_at 倒序获取最近 N 条记录（服务器优先，失败时回退本地 Dexie 索引）
   * @param limit 返回记录数上限，默认 100
   * @returns 最近 N 条记录数组
   */
  async getRecent(limit?: number): Promise<T[]> {
    try {
      const res = await this.remote.getPage(limit ?? 100, 0)
      // 同步到本地缓存
      await putItems(this.local, res.items)
      return res.items
    } catch (err) {
      console.warn('[CachedRemoteRepository] getRecent 服务器不可用，回退本地', err)
      return this.local.getRecent(limit)
    }
  }

  /**
   * 从服务器拉取全量数据同步到本地缓存
   * - 用于页面挂载时主动刷新，确保跨终端数据一致
   * - 成功后触发 cacheEvents 事件，订阅方页面可重读本地缓存更新 UI
   * - 失败时仅 console.warn 不抛出，不影响调用方
   *
   * - local.put 调用包裹 try/catch（best-effort）：单条记录写入失败（如 StorageQuotaError）
   *   不中断整体刷新流程，仅记录 dev 日志
   * - 显式 catch 避免 StorageQuotaError 等错误污染 allSettled 结果统计，日志更清晰
   */
  async refreshFromServer(): Promise<void> {
    try {
      const items = await this.remote.getAll()
      // 增量同步：仅当远程 updated_at 严格更新或本地不存在时才写入，避免覆盖本地较新数据
      await Promise.allSettled(
        items.map(async (item) => {
          const localItem = await this.local.getById(item.id)
          if (shouldUpdate(localItem, item)) {
            // best-effort：本地缓存写入失败不影响整体刷新流程
            try {
              await this.local.put(item)
            } catch (putErr) {
              if (import.meta.env.DEV)
                console.warn(
                  '[CachedRemoteRepository] refreshFromServer local.put 失败，跳过该记录',
                  putErr,
                )
            }
          }
        }),
      )
      // 通知订阅方：本地缓存已更新，可重读以刷新 UI
      cacheEvents.emit(this.tableName)
    } catch (err) {
      console.warn('[CachedRemoteRepository] refreshFromServer 失败', err)
    }
  }

  /**
   * 本地优先读取全部记录（SWR 模式）
   * - 立即从本地 Dexie 缓存返回（无 HTTP 阻塞），UI 立即可见
   * - 本地有数据时：后台 fire-and-forget 触发 refreshFromServer（30 秒节流）
   * - 本地无数据时（首次使用/未缓存）：同步等待 remote.getAll()，避免空状态闪烁
   * - 远程失败时：返回本地数据（可能为空数组）
   *
   * @returns 全部记录数组（本地优先）
   */
  async getAllLocalFirst(): Promise<T[]> {
    const localItems = await this.local.getAll()
    if (localItems.length > 0) {
      // 本地有数据：立即返回，后台静默刷新（节流）
      void this.triggerBackgroundRefresh()
      return localItems
    }
    // 本地无数据：首次使用或缓存被清空，同步等待服务器拉取
    try {
      const items = await this.remote.getAll()
      await putItems(this.local, items)
      // 标记本次刷新时间，避免后续立即重复触发后台刷新
      this.lastBackgroundRefreshAt = Date.now()
      // 通知订阅方：本地缓存已填充
      cacheEvents.emit(this.tableName)
      return items
    } catch (err) {
      console.warn('[CachedRemoteRepository] getAllLocalFirst 首次加载失败', err)
      return []
    }
  }

  /**
   * 本地优先按主键读取单条记录（SWR 模式）
   * - 立即从本地 Dexie 缓存返回（无 HTTP 阻塞）
   * - 本地命中：返回本地数据，后台异步刷新该 id（不阻塞）
   * - 本地未命中：同步等待 remote.getById()，写入本地后返回（避免空状态闪烁）
   * - 远程失败时：返回 undefined
   *
   * @param id 记录主键
   * @returns 匹配的记录；不存在时返回 undefined
   */
  async getByIdLocalFirst(id: string): Promise<T | undefined> {
    const cached = await this.local.getById(id)
    if (cached) {
      // 本地命中：后台异步刷新该 id（best-effort，不阻塞调用方）
      // 增量更新：仅当远程 updated_at 更新时才覆盖本地缓存
      void this.remote
        .getById(id)
        .then((item) => {
          if (item && shouldUpdate(cached, item)) {
            this.local.put(item).then(() => cacheEvents.emit(this.tableName)).catch(() => {
              /* 静默：本地缓存写入失败不影响主流程 */
            })
          }
        })
        .catch((err) => {
          if (import.meta.env.DEV)
            console.warn('[CachedRemoteRepository] getByIdLocalFirst 后台刷新失败', err)
        })
      return cached
    }
    // 本地未命中：同步等待远程
    try {
      const item = await this.remote.getById(id)
      if (item) {
        // 增量更新：再次读取本地（可能被并发写入），仅当远程较新时才写入
        const localItem = await this.local.getById(id)
        if (shouldUpdate(localItem, item)) {
          await this.local.put(item).catch(() => {
            /* 静默 */
          })
          cacheEvents.emit(this.tableName)
        }
      }
      return item
    } catch (err) {
      console.warn('[CachedRemoteRepository] getByIdLocalFirst 远程失败', err)
      return undefined
    }
  }

  /**
   * 后台触发 refreshFromServer（带 30 秒节流）
   * - 节流目的：避免重复进入页面或事件回调中重复触发后台刷新
   * - 节流窗口内重复调用直接跳过，不发起 HTTP
   */
  private async triggerBackgroundRefresh(): Promise<void> {
    const now = Date.now()
    if (now - this.lastBackgroundRefreshAt < BACKGROUND_REFRESH_THROTTLE_MS) {
      // 节流窗口内：跳过
      return
    }
    this.lastBackgroundRefreshAt = now
    try {
      await this.refreshFromServer()
    } catch (err) {
      // refreshFromServer 内部已 catch，此处兜底防御
      if (import.meta.env.DEV)
        console.warn('[CachedRemoteRepository] triggerBackgroundRefresh 异常', err)
    }
  }

  /**
   * 触发后台刷新（带 30 秒节流，fire-and-forget）
   * - 用于不通过 getAllLocalFirst/getByIdLocalFirst 读取数据但仍需刷新缓存的场景
   *   （如 reviewService.getTodayReviewQueueInfo 使用 whereBelowOrEqual 本地索引查询）
   * - 节流窗口内重复调用直接跳过，不发起 HTTP
   * - 异常由内部 catch，不抛出；刷新完成后通过 cacheEvents 通知订阅方
   */
  triggerRefresh(): void {
    void this.triggerBackgroundRefresh()
  }

  /**
   * 按主键获取单条记录（服务器优先，失败时回退本地缓存）
   * @param id 记录主键
   * @returns 匹配的记录；不存在时返回 undefined
   */
  async getById(id: string): Promise<T | undefined> {
    try {
      const item = await this.remote.getById(id)
      if (item) {
        await this.local.put(item).catch((err) => {
          if (import.meta.env.DEV)
            console.warn('[CachedRemoteRepository] sync getById to local cache failed', err)
        })
      }
      return item
    } catch (err) {
      // 离线回退：从本地缓存读取
      console.warn('[CachedRemoteRepository] 服务器不可用，回退到本地缓存', err)
      return this.local.getById(id)
    }
  }

  /**
   * 新增记录：写入服务器后同步到本地缓存
   * @param entity 实体数据（updated_at 可选，由方法自动填充）
   * @returns 服务器创建的完整记录
   * @throws 服务器写入失败时抛出 Error（本地缓存写入失败仅记录日志）
   */
  async add(entity: Omit<T, 'updated_at'> & { updated_at?: number }): Promise<T> {
    const created = await this.remote.add(entity)
    // 同步到本地缓存
    await this.local.put(created).catch((err) => {
      if (import.meta.env.DEV)
        console.warn('[CachedRemoteRepository] sync add to local cache failed', err)
    })
    return created
  }

  /**
   * 部分更新记录：服务器更新后同步本地缓存
   * - 服务器 404 时回退为本地更新并返回 fallback 对象，避免阻塞调用方
   * - 服务器其他错误（500、网络错误等）重新抛出
   * @param id 记录主键
   * @param patch 需更新的字段（updated_at 由方法自动填充）
   * @returns 服务器更新后的完整记录；404 时返回基于 patch 的 fallback 对象
   * @throws 服务器返回非 404 错误（如 500、网络错误）时抛出 Error
   */
  async update(id: string, patch: Partial<Omit<T, 'updated_at'>>): Promise<T> {
    try {
      const updated = await this.remote.update(id, patch)
      // 同步更新本地缓存（best-effort）
      await this.local.update(id, patch).catch((err) => {
        if (import.meta.env.DEV)
          console.warn('[CachedRemoteRepository] sync update to local cache failed', err)
      })
      return updated
    } catch (err) {
      // 远程 update 失败：best-effort 更新本地缓存
      await this.local.update(id, patch).catch((localErr) => {
        if (import.meta.env.DEV)
          console.warn('[CachedRemoteRepository] local fallback update failed', localErr)
      })
      // 404 视为远程不存在，返回 fallback 对象避免阻塞调用方
      if (err instanceof Error && err.message.includes('404')) {
        console.warn('[CachedRemoteRepository] remote update 404, falling back to local only', err)
        return { ...patch, id, updated_at: Date.now() } as T
      }
      // 非 404 错误（如 500、网络错误）重新抛出
      throw err
    }
  }

  /**
   * 按主键删除记录：服务器删除后同步本地缓存
   * @param id 记录主键
   * @throws 服务器删除失败时抛出 Error（本地缓存删除失败仅记录日志）
   */
  async delete(id: string): Promise<void> {
    await this.remote.delete(id)
    await this.local.delete(id).catch((err) => {
      if (import.meta.env.DEV)
        console.warn('[CachedRemoteRepository] sync delete to local cache failed', err)
    })
  }

  /**
   * 批量删除记录：服务器删除后同步本地缓存
   * @param ids 待删除记录的主键数组
   * @throws 服务器批量删除失败时抛出 Error（本地缓存删除失败仅记录日志）
   */
  async bulkDelete(ids: string[]): Promise<void> {
    await this.remote.bulkDelete(ids)
    await this.local.bulkDelete(ids).catch((err) => {
      if (import.meta.env.DEV)
        console.warn('[CachedRemoteRepository] sync bulkDelete to local cache failed', err)
    })
  }

  /**
   * 批量新增记录（仅 words 表实现，调用 POST /:basePath/bulk 端点）
   * - 使用事务 + INSERT OR IGNORE：已存在的记录跳过，不覆盖已有复习进度
   * - 用于批量加入生词本场景，消除 N+1 HTTP 调用
   * - 缓存同步策略：服务器写入成功后，仅对新插入的 items 同步本地缓存（best-effort）
   *   由于 server 返回 { added, skipped } 但不返回具体插入的 items 列表，
   *   此处对全部 items 执行 local.put（已存在的覆盖为前端构造的 Word， mastery=0 等），
   *   可能导致本地缓存中已掌握单词的复习进度被覆盖。
   *   为避免此问题，此处跳过本地缓存同步，依赖下次 getAll() 从服务器刷新。
   *
   * @param items 待新增的实体数组（updated_at 由方法自动填充）
   * @returns `{ added, skipped }`
   * @throws 服务器写入失败时抛出 Error（本地缓存不更新）
   */
  async bulkAdd(
    items: Array<Omit<T, 'updated_at'> & { updated_at?: number }>,
  ): Promise<{ added: number; skipped: number }> {
    return this.remote.bulkAdd(items)
  }
}
