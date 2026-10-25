// 默认 AI 供应商实例（动态委托 Proxy）
//
// 每次属性访问时解析当前供应商并委托，实现个人中心切换免刷新即时生效；
// 配置错误延迟到方法调用时以 rejected Promise 暴露，避免模块加载期白屏。
import { type AIProvider, type AIProviderName } from './types'
import { getCustomModelConfig, getUserSelectedProvider } from './aiConfig'
import { createAIProvider } from './providerFactory'

// 活跃 Provider 缓存：按「供应商名称 + custom 配置指纹」缓存实例，任一变化时重建
// 供应商名称来自 getUserSelectedProvider（localStorage > env > 自动检测），
// 个人中心切换供应商 / 修改自定义端点与模型后无需刷新页面，下一次方法调用即路由到新配置
// （密钥变化无需重建：keyResolver 在每次请求时点实时解析 secureStorage）
let activeProvider: AIProvider | null = null
let activeProviderKey: string | null = null

function getProviderCacheKey(name: AIProviderName): string {
  // custom 的端点/模型固化在 CustomProvider 实例中，配置变化必须重建实例
  if (name === 'custom') {
    const { endpoint, model } = getCustomModelConfig()
    return `custom:${endpoint}:${model}`
  }
  return name
}

function getActiveProvider(): AIProvider {
  const name = getUserSelectedProvider()
  const key = getProviderCacheKey(name)
  if (activeProvider === null || activeProviderKey !== key) {
    activeProvider = createAIProvider(name)
    activeProviderKey = key
  }
  return activeProvider
}

// 默认 AI 供应商实例：Proxy 每次属性访问时解析当前供应商并委托
//
// 设计动机（2026-08-27 修复第三方 API 全业务流程异常）：
// 旧实现为模块加载时固化的单例（export const aiProvider = createAIProvider()），
// 存在两个缺陷：
// 1. 个人中心切换供应商后需刷新页面才生效（业务模块持有旧实例引用）
// 2. localStorage/env 指向 custom 但配置不完整时，模块加载即抛错导致整个应用白屏
//
// Proxy 动态委托解决以上两点：切换即时生效；配置错误延迟到首次调用时才暴露，
// 由调用方（articleService/questionService 等）的 catch 逻辑降级处理。
//
// set trap 兼容测试 monkey-patch：显式赋值到 target 的属性优先于动态解析
// （e2e-flow / crossModuleFlow 等测试依赖 aiProvider.xxx = mockFn 覆盖行为）
export const aiProvider: AIProvider = new Proxy({} as AIProvider, {
  get(target, prop) {
    // 测试 monkey-patch 优先：target 上被显式赋值的属性直接返回（绑定 target）
    if (prop in target) {
      const patched = (target as unknown as Record<string | symbol, unknown>)[prop]
      return typeof patched === 'function'
        ? (patched as (...args: unknown[]) => unknown).bind(target)
        : patched
    }
    let provider: AIProvider
    try {
      provider = getActiveProvider()
    } catch (err) {
      // 供应商配置错误（如 custom 端点/模型缺失）延迟到方法调用时抛出：
      // 以 rejected Promise 暴露，避免属性访问阶段同步抛错绕过调用方的
      // .catch() / try-catch 降级逻辑（与 AIError 的异步语义保持一致）
      return async () => {
        throw err as Error
      }
    }
    const value = Reflect.get(provider, prop) as unknown
    return typeof value === 'function'
      ? (value as (...args: unknown[]) => unknown).bind(provider)
      : value
  },
  set(target, prop, value) {
    ;(target as unknown as Record<string | symbol, unknown>)[prop] = value
    return true
  },
})
