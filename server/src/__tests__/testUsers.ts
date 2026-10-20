// 多用户测试辅助：提供测试用户与 req.user 注入中间件
// 路由级测试（routes/pagination/routes.edge）自建 app 不经过 index.ts 的 authMiddleware，
// 通过 injectUser 模拟认证后的请求上下文（与生产环境的 req.user 形态一致）
import type { Request, Response, NextFunction } from 'express'
import { createSession, createUser, type AuthUser } from '../auth.js'

/** 固定测试用户（路由级测试注入用，不依赖数据库 users 表） */
export const TEST_USER: AuthUser = {
  id: 'test-user-1',
  username: 'testuser',
  displayName: '测试用户',
  role: 'student',
}

/** 第二个固定测试用户（数据隔离测试用） */
export const TEST_USER_2: AuthUser = {
  id: 'test-user-2',
  username: 'testuser2',
  displayName: '测试用户2',
  role: 'student',
}

/**
 * req.user 注入中间件：模拟 authMiddleware 认证成功后的请求上下文
 * 用法：app.use(injectUser()) 或 app.use(injectUser(TEST_USER_2))
 */
export function injectUser(user: AuthUser = TEST_USER) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    req.user = user
    next()
  }
}

/**
 * 在数据库中创建真实用户并签发会话（端到端认证测试用）
 * 返回 { user, token }，token 可直接作为 x-user-token 头使用
 */
export function createRealUser(overrides?: {
  username?: string
  displayName?: string
  password?: string
  role?: string
}): { user: AuthUser; token: string; password: string } {
  const password = overrides?.password ?? 'test-pass-123'
  const user = createUser({
    username: overrides?.username ?? `user-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    displayName: overrides?.displayName ?? '测试用户',
    password,
    role: overrides?.role,
  })
  const token = createSession(user.id)
  return { user, token, password }
}
