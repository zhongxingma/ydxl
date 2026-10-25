// CachedRemoteRepository 测试共享 mock 构造器
import { vi } from 'vitest'
import type { BaseEntity } from '@/shared/types'

// 测试用实体类型：仅包含 name 字段（BaseEntity 已提供 id 与 updated_at）
export interface TestEntity extends BaseEntity {
  name: string
}

// Mock RemoteRepository：按需 mock 方法
export function createMockRemote() {
  return {
    update: vi.fn(),
    getAll: vi.fn(),
    getById: vi.fn(),
    add: vi.fn(),
  }
}

// Mock Repository：按需 mock 方法
export function createMockLocal() {
  return {
    update: vi.fn(),
    getAll: vi.fn(),
    getById: vi.fn(),
    put: vi.fn(),
  }
}
