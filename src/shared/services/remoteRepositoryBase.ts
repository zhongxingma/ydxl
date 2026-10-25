// 远程 Repository 基类：基于 REST API 的 CRUD（服务器为主策略）
//
// 仅负责单表 HTTP 调用，不涉及 Dexie 缓存；带缓存的组合见 ./cachedRemoteRepository。
import type { BaseEntity } from '@/shared/types'
import { localApi } from './localApi'

// 分页响应格式（server/src/routes.ts GET 列表端点统一返回）
export interface PaginatedResponse<T> {
  items: T[]
  total: number
  limit: number
  offset: number
}

// 基于 REST API 的远程 CRUD（服务器为主策略）
export class RemoteRepository<T extends BaseEntity> {
  constructor(private readonly basePath: string) {}

  /**
   * 获取全部记录（使用最大分页 limit=1000 以获取尽可能多的数据）
   * @returns 全部记录数组
   * @throws 网络错误或服务器返回非 2xx 状态码时抛出 Error
   */
  async getAll(): Promise<T[]> {
    const res = await localApi.get<PaginatedResponse<T>>(`/${this.basePath}?limit=1000`)
    return res.items
  }

  /**
   * 分页获取记录
   * @param limit 每页记录数上限，默认 100
   * @param offset 偏移量，默认 0
   * @returns 分页响应（含 items、total、limit、offset）
   * @throws 网络错误或服务器返回非 2xx 状态码时抛出 Error
   */
  async getPage(limit = 100, offset = 0): Promise<PaginatedResponse<T>> {
    return localApi.get<PaginatedResponse<T>>(
      `/${this.basePath}?limit=${limit}&offset=${offset}`,
    )
  }

  /**
   * 按主键获取单条记录
   * @param id 记录主键
   * @returns 匹配的记录；不存在时返回 undefined
   * @throws 网络 error 或非 404 的服务器错误时抛出 Error
   */
  async getById(id: string): Promise<T | undefined> {
    return localApi.getById<T>(`/${this.basePath}`, id)
  }

  /**
   * 新增记录：自动写入 updated_at 为当前时间戳
   * @param entity 实体数据（updated_at 可选，由方法自动填充）
   * @returns 服务器创建的完整记录
   * @throws 网络错误或服务器返回非 2xx 状态码时抛出 Error
   */
  async add(entity: Omit<T, 'updated_at'> & { updated_at?: number }): Promise<T> {
    const body = { ...entity, updated_at: Date.now() }
    return localApi.post<T>(`/${this.basePath}`, body)
  }

  /**
   * 部分更新记录：自动刷新 updated_at 为当前时间戳
   * @param id 记录主键
   * @param patch 需更新的字段（updated_at 由方法自动填充）
   * @returns 服务器更新后的完整记录
   * @throws 网络错误或服务器返回非 2xx 状态码时抛出 Error
   */
  async update(id: string, patch: Partial<Omit<T, 'updated_at'>>): Promise<T> {
    const body = { ...patch, updated_at: Date.now() }
    return localApi.put<T>(`/${this.basePath}`, id, body)
  }

  /**
   * 按主键删除单条记录
   * @param id 记录主键
   * @throws 网络错误或服务器返回非 2xx 状态码时抛出 Error
   */
  async delete(id: string): Promise<void> {
    return localApi.del(`/${this.basePath}`, id)
  }

  /**
   * 批量删除：REST API 无批量端点，逐条删除
   * @param ids 待删除记录的主键数组
   */
  async bulkDelete(ids: string[]): Promise<void> {
    await Promise.all(
      ids.map((id) =>
        this.delete(id).catch((err) => {
          if (import.meta.env.DEV)
            console.warn('[RemoteRepository] bulkDelete item failed', err)
        }),
      ),
    )
  }

  /**
   * 批量新增记录（仅 words 表实现，调用 POST /:basePath/bulk 端点）
   * - 使用事务 + INSERT OR IGNORE：已存在的记录跳过，不覆盖
   * - 用于批量加入生词本场景，消除 N+1 HTTP 调用
   *
   * @param items 待新增的实体数组（updated_at 由方法自动填充）
   * @returns `{ added: 新增数, skipped: 跳过数 }`
   * @throws 网络错误或服务器返回非 2xx 状态码时抛出 Error
   */
  async bulkAdd(
    items: Array<Omit<T, 'updated_at'> & { updated_at?: number }>,
  ): Promise<{ added: number; skipped: number }> {
    const body = {
      items: items.map((item) => ({ ...item, updated_at: item.updated_at ?? Date.now() })),
    }
    return localApi.post<{ added: number; skipped: number }>(
      `/${this.basePath}/bulk`,
      body,
    )
  }
}
