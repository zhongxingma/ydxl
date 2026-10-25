// AI 接口抽象层统一出口
// 提供多 AI 供应商实现（DeepSeek / OpenAI / 通义千问），默认实例按用户选择/环境变量创建
import { type AIProvider, type AIProviderName } from './types'
import { DeepSeekProvider } from './deepseekProvider'
import { OpenAIProvider } from './openaiProvider'
import { QwenProvider } from './qwenProvider'
import { CustomProvider } from './customProvider'
import { FallbackAIProvider, createUnavailableProvider } from './fallbackProvider'
import { secureGetItem } from '@/shared/services/secureStorage'

// 从环境变量读取配置
// - VITE_AI_PROXY_URL：生产环境代理地址（存在时优先走代理）
// - VITE_DEEPSEEK_API_KEY / VITE_OPENAI_API_KEY / VITE_QWEN_API_KEY：开发环境直连密钥
// - VITE_DEEPSEEK_MODEL / VITE_OPENAI_MODEL / VITE_QWEN_MODEL：模型名覆盖
// - VITE_CUSTOM_API_ENDPOINT / VITE_CUSTOM_MODEL / VITE_CUSTOM_API_KEY：自定义模型默认配置
//   （用户在个人中心配置后以 localStorage 为准）
// - VITE_AI_PROVIDER：默认供应商，可被 localStorage 覆盖
const env = import.meta.env

// 各供应商前端直连密钥的环境变量名映射
// 与 server/src/aiConfig.ts 中内置供应商的 keyEnv 声明对应（JSON 的 providers 段可选覆盖）：
// JSON 的 keyEnv 为服务端变量名（如 DEEPSEEK_API_KEY），对应前端直连镜像即 VITE_DEEPSEEK_API_KEY。
// 仅开发直连模式（未配置 VITE_AI_PROXY_URL）使用；生产代理模式密钥由服务端持有，前端无需密钥。
const PROVIDER_API_KEY_ENV: Record<Exclude<AIProviderName, 'custom'>, string | undefined> = {
  deepseek: env.VITE_DEEPSEEK_API_KEY,
  openai: env.VITE_OPENAI_API_KEY,
  qwen: env.VITE_QWEN_API_KEY,
}

// 各供应商模型覆盖的环境变量名映射（与 config/ai-providers.json 的 providers.*.model 声明对应）
const PROVIDER_MODEL_ENV: Record<Exclude<AIProviderName, 'custom'>, string | undefined> = {
  deepseek: env.VITE_DEEPSEEK_MODEL,
  openai: env.VITE_OPENAI_MODEL,
  qwen: env.VITE_QWEN_MODEL,
}

// ===== 自定义模型配置（localStorage 单一事实来源，env 提供默认值） =====
// 与 useProfileSettings.ts 中 LS_KEY 常量保持一致
const LS_KEY_CUSTOM_ENDPOINT = 'ydxl-ext-ai-custom-endpoint'
const LS_KEY_CUSTOM_MODEL = 'ydxl-ext-ai-custom-model'

function readLS(key: string): string {
  try {
    return typeof window !== 'undefined' ? (window.localStorage.getItem(key) ?? '') : ''
  } catch {
    return ''
  }
}

/**
 * 读取自定义模型的完整运行时配置
 * 优先级：localStorage（用户个人中心配置）> 环境变量默认值
 */
export function getCustomModelConfig(): {
  endpoint: string
  model: string
  apiKey?: string
} {
  return {
    endpoint: readLS(LS_KEY_CUSTOM_ENDPOINT) || (env.VITE_CUSTOM_API_ENDPOINT as string) || '',
    model: readLS(LS_KEY_CUSTOM_MODEL) || (env.VITE_CUSTOM_MODEL as string) || '',
    // 自定义模型密钥经 secureStorage 加密存储，此处仅返回 env 默认值；
    // UI 场景由调用方（工厂/连接测试）显式传入用户输入的 Key
    apiKey: (env.VITE_CUSTOM_API_KEY as string) || undefined,
  }
}

// localStorage key：用户在 ProfilePage 选择的 AI 供应商
// 与 useProfileSettings.ts 中的 LS_KEY_AI_PROVIDER 保持一致
const LS_KEY_AI_PROVIDER = 'ydxl-ext-ai-provider'

// secureStorage key：用户在 ProfilePage 保存的各供应商 API Key
// 与 useProfileSettings.ts 中的 LS_KEY_AI_API_KEY_* 常量保持一致
// （密钥经加密存储，异步读取；工厂通过 keyResolver 在请求时点解析，见 BaseProviderConfig）
const LS_KEY_SECURE_API_KEY: Record<AIProviderName, string> = {
  deepseek: 'ydxl-ext-ai-api-key-deepseek',
  openai: 'ydxl-ext-ai-api-key-openai',
  qwen: 'ydxl-ext-ai-api-key-qwen',
  custom: 'ydxl-ext-ai-api-key-custom',
}

/**
 * 构造运行时密钥解析器：读取 secureStorage 中用户保存的供应商密钥
 * 每次请求时实时读取（不缓存），保证个人中心修改密钥后即时生效；
 * 读取失败（存储不可用/未初始化）时返回空串，由基类按未配置密钥处理
 */
function makeKeyResolver(name: AIProviderName): () => Promise<string> {
  return async () => {
    try {
      return await secureGetItem(LS_KEY_SECURE_API_KEY[name])
    } catch {
      return ''
    }
  }
}

/**
 * 校验供应商名称合法性
 * @param value 待校验的字符串（可能来自 localStorage 或环境变量）
 * @returns 合法的 AIProviderName 或 null
 */
function parseProviderName(value: string | null | undefined): AIProviderName | null {
  return value === 'deepseek' || value === 'openai' || value === 'qwen' || value === 'custom'
    ? value
    : null
}

/**
 * 判断自定义模型的 env 默认配置是否完整（端点 + 模型 ID）
 * 用于供应商自动检测：未显式指定供应商但配置了完整的自定义模型时，自动选用 custom，
 * 避免"填了 VITE_CUSTOM_* 却仍走 deepseek 导致 503"的部署陷阱
 */
function isCustomEnvConfigured(): boolean {
  return Boolean(
    (env.VITE_CUSTOM_API_ENDPOINT as string | undefined)?.trim() &&
      (env.VITE_CUSTOM_MODEL as string | undefined)?.trim()
  )
}

/**
 * 判断 custom 供应商是否应走服务端代理节点（/v1/ai-proxy/custom）
 * 条件（全部满足）：
 * 1. 存在 VITE_AI_PROXY_URL（生产代理模式）
 * 2. 用户未在「个人中心」自填请求地址（localStorage 为空）——用户自填端点保持
 *    浏览器直连，不经服务端转发（SSRF 防护：服务端只信 env 固定端点）
 * 3. env 默认配置完整（端点 + 模型 ID，表明部署者配置了服务端 custom 上游）
 *
 * 走代理收益：第三方 API 通常不允许浏览器跨域直调（CORS），直连在生产环境大概率
 * 失败并兜底到高价的 DeepSeek；经服务端代理转发可规避 CORS，且 CUSTOM_API_KEY
 * 留在服务端不进前端 bundle。
 * 服务端未配置 CUSTOM_API_ENDPOINT 时该路由返回 503，前端自动回退 DeepSeek 兜底。
 */
export function shouldCustomUseProxy(): boolean {
  return (
    Boolean(env.VITE_AI_PROXY_URL) &&
    !readLS(LS_KEY_CUSTOM_ENDPOINT).trim() &&
    isCustomEnvConfigured()
  )
}

/**
 * 读取用户选择的 AI 供应商名称
 * 优先级：localStorage > 环境变量 VITE_AI_PROVIDER > 自定义模型 env 配置完整时 'custom' > 'deepseek'
 *
 * localStorage 不可用（SSR / 测试环境 / 隐私模式）时静默回退，不抛错。
 * 仅接受合法值（deepseek/openai/qwen/custom），其它值回退到下一优先级。
 * @returns 当前用户选择的供应商名称
 */
function getUserSelectedProvider(): AIProviderName {
  try {
    const stored =
      typeof window !== 'undefined'
        ? window.localStorage.getItem(LS_KEY_AI_PROVIDER)
        : null
    const fromLS = parseProviderName(stored)
    if (fromLS) return fromLS
  } catch {
    // localStorage 不可用（如 SSR 或测试环境），忽略
  }
  const fromEnv = parseProviderName(env.VITE_AI_PROVIDER as string | undefined)
  if (fromEnv) return fromEnv
  // 防呆回退：部署者填写了完整的自定义模型 env 配置（未显式指定供应商）时自动启用，
  // 让「在 .env 配好第三方 API 即生效」符合直觉
  if (isCustomEnvConfigured()) return 'custom'
  return 'deepseek'
}

// 按供应商名称构造基础配置（代理模式 vs 直连模式）
// 配置优先级：存在 VITE_AI_PROXY_URL 时走代理（生产环境）；
// 否则使用对应供应商的本地直连密钥（开发环境）
// 注：custom 不走此函数（无官方 env 映射，配置来自 getCustomModelConfig）
function buildBaseConfig(
  name: Exclude<AIProviderName, 'custom'>
): {
  apiKey?: string
  model?: string
  proxyBaseUrl?: string
  keyResolver?: () => Promise<string>
} {
  if (env.VITE_AI_PROXY_URL) {
    // 生产环境：走代理；鉴权由 baseProvider 注入的会话令牌（x-user-token）承担，
    // 模型覆盖按供应商读取
    return {
      proxyBaseUrl: env.VITE_AI_PROXY_URL,
      model: PROVIDER_MODEL_ENV[name],
    }
  }
  // 开发环境：直连，使用对应供应商的本地密钥与模型覆盖；
  // keyResolver 兜底读取 secureStorage 中用户保存的密钥（env 未配置时生效）
  return {
    apiKey: PROVIDER_API_KEY_ENV[name],
    model: PROVIDER_MODEL_ENV[name],
    keyResolver: makeKeyResolver(name),
  }
}

/**
 * 构造兜底供应商实例（自定义 API 调用失败/不可用时切换的备用上游）
 * 配置来自单一配置源 config/ai-providers.json 的 fallback 字段，经 vite.config.ts 注入
 * VITE_FALLBACK_AI_PROVIDER / VITE_FALLBACK_MODEL。
 * - provider 仅支持内置供应商（deepseek/openai/qwen），不支持 custom（避免递归兜底）；
 *   未配置或值非法时回退 deepseek（与历史硬编码行为一致）
 * - model 覆盖兜底供应商模型（未配置时沿用该供应商 env 模型，其次供应商默认模型）
 */
function buildFallbackProvider(): AIProvider {
  const fallbackRaw = parseProviderName(env.VITE_FALLBACK_AI_PROVIDER as string | undefined)
  const name: Exclude<AIProviderName, 'custom'> =
    fallbackRaw && fallbackRaw !== 'custom' ? fallbackRaw : 'deepseek'
  const modelOverride = (env.VITE_FALLBACK_MODEL as string | undefined)?.trim()
  const config = buildBaseConfig(name)
  if (modelOverride) {
    config.model = modelOverride
  }
  switch (name) {
    case 'openai':
      return new OpenAIProvider(config)
    case 'qwen':
      return new QwenProvider(config)
    case 'deepseek':
    default:
      return new DeepSeekProvider(config)
  }
}

// AI 供应商工厂函数（内部使用，不对外导出；外部切换用 createAIProviderByName）
// @param providerName 可选指定供应商名称，未传则从 getUserSelectedProvider() 读取
function createAIProvider(providerName?: AIProviderName): AIProvider {
  const name = providerName ?? getUserSelectedProvider()

  // 按供应商名称实例化基础 Provider（OpenAI 兼容协议家族共享 BaseAIProvider 公共逻辑）
  let base: AIProvider
  switch (name) {
    case 'openai':
      base = new OpenAIProvider(buildBaseConfig(name))
      break
    case 'qwen':
      base = new QwenProvider(buildBaseConfig(name))
      break
    case 'custom': {
      // 自定义模型：配置来自 getCustomModelConfig（localStorage > env）。
      // 路由决策（shouldCustomUseProxy）：
      // - env 默认配置 + 代理模式 → 走服务端 /v1/ai-proxy/custom 上游（规避 CORS，
      //   密钥留服务端；服务端 UPSTREAMS.custom 只转发到部署者 env 固定端点，无 SSRF）
      // - 用户在个人中心自填请求地址 → 浏览器直连（用户端点不经服务端转发）
      const custom = getCustomModelConfig()
      // 兜底实例：配置来自 config/ai-providers.json 的 fallback 字段（默认 DeepSeek）
      const fallbackProvider = buildFallbackProvider()
      if (!custom.endpoint || !custom.model) {
        // 配置不完整：主供应商不可用，仍尝试 DeepSeek 兜底（符合「自定义 API
        // 不可用时自动切换 DeepSeek」策略）；DeepSeek 密钥也未配置时，
        // FallbackAIProvider 会抛回下方配置错误（诊断价值更高）
        console.warn('[ai] 自定义模型配置不完整，将尝试 DeepSeek 兜底')
        base = new FallbackAIProvider(
          createUnavailableProvider(
            '自定义模型未配置完整，请在「个人中心 → AI 设置」填写请求地址与模型 ID',
          ),
          fallbackProvider,
        )
        break
      }
      const useProxy = shouldCustomUseProxy()
      if (useProxy) {
        // 代理模式：端点字段仅作占位（实际路由由 resolveEndpoint 拼接代理 URL），
        // 上游密钥由服务端 CUSTOM_API_KEY 持有
        const customProvider = new CustomProvider({
          endpoint: custom.endpoint,
          model: custom.model,
          proxyBaseUrl: env.VITE_AI_PROXY_URL as string,
        })
        base = new FallbackAIProvider(customProvider, fallbackProvider)
        break
      }
      // 直连模式：keyResolver 复合优先级 secureStorage 用户密钥 > env 默认密钥，
      // 与端点/模型的「个人中心 > env」优先级链保持一致；请求时点解析
      const customProvider = new CustomProvider({
        endpoint: custom.endpoint,
        model: custom.model,
        apiKey: undefined,
        keyResolver: async () => {
          const userKey = await makeKeyResolver('custom')()
          return userKey || (env.VITE_CUSTOM_API_KEY as string) || ''
        },
      })
      // 自定义 API 优先调用，失败/不可用时自动切换 DeepSeek 兜底
      base = new FallbackAIProvider(customProvider, fallbackProvider)
      break
    }
    case 'deepseek':
    default:
      base = new DeepSeekProvider(buildBaseConfig(name))
      break
  }

  return base
}

// ===== 默认 AI 供应商实例（动态委托） =====

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

/**
 * 按供应商名称创建 AI Provider 实例（运行时切换/连接测试）
 * 供 useAIConnectionTest 与 ProfilePage 连接测试使用，不依赖环境变量密钥
 * @param name 供应商名称（'deepseek' | 'openai' | 'qwen' | 'custom'）
 * @param config 配置（apiKey / model / proxyBaseUrl / endpoint 覆盖，custom 必须传 endpoint）
 * @returns AIProvider 实例
 */
export function createAIProviderByName(
  name: AIProviderName,
  config: { apiKey?: string; model?: string; endpoint?: string; proxyBaseUrl?: string }
): AIProvider {
  switch (name) {
    case 'openai':
      return new OpenAIProvider({
        apiKey: config.apiKey,
        model: config.model,
        proxyBaseUrl: config.proxyBaseUrl,
      })
    case 'qwen':
      return new QwenProvider({
        apiKey: config.apiKey,
        model: config.model,
        proxyBaseUrl: config.proxyBaseUrl,
      })
    case 'custom': {
      // 自定义模型：endpoint 必填（连接测试传入用户当前输入值），
      // 未显式传入的字段依次回退：localStorage > env 默认值（getCustomModelConfig）
      const fallback = getCustomModelConfig()
      // 密钥解析：显式传入（用户当前输入）> secureStorage（已保存）> env 默认，
      // 未显式传入时通过 keyResolver 在请求时点解析（与单例路径行为一致）
      return new CustomProvider({
        apiKey: config.apiKey,
        model: config.model || fallback.model || undefined,
        proxyBaseUrl: config.proxyBaseUrl,
        endpoint: config.endpoint || fallback.endpoint,
        keyResolver: config.apiKey
          ? undefined
          : async () => {
              const userKey = await makeKeyResolver('custom')()
              return userKey || (env.VITE_CUSTOM_API_KEY as string) || ''
            },
      })
    }
    case 'deepseek':
    default:
      return new DeepSeekProvider({
        apiKey: config.apiKey,
        model: config.model,
        proxyBaseUrl: config.proxyBaseUrl,
      })
  }
}

/**
 * 获取当前用户选择的 AI 供应商名称
 * 优先级：localStorage > 环境变量 > 默认 deepseek
 * @returns 当前供应商名称
 */
export function getCurrentAIProviderName(): AIProviderName {
  return getUserSelectedProvider()
}

/**
 * 设置当前 AI 供应商（持久化到 localStorage）
 * 供 ProfilePage 切换供应商时调用；aiProvider 为动态委托 Proxy，
 * 切换后无需刷新页面，下一次 AI 调用即路由到新供应商
 * localStorage 不可用时不抛错（SSR/测试环境兼容）
 * @param name 供应商名称
 */
export function setCurrentAIProvider(name: AIProviderName): void {
  try {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(LS_KEY_AI_PROVIDER, name)
    }
  } catch (err) {
    if (import.meta.env.DEV) console.warn('[ai] 设置当前供应商失败', err)
  }
}

/**
 * 写入自定义模型的端点与模型 ID 配置（持久化到 localStorage）
 * 供 ProfilePage 自定义模型表单保存时调用；密钥由 useProfileSettings 经 secureStorage 单独存储
 * @param config 端点与模型 ID（空串表示清除该项）
 */
export function setCustomModelConfig(config: { endpoint?: string; model?: string }): void {
  try {
    if (typeof window === 'undefined') return
    if (config.endpoint !== undefined) {
      window.localStorage.setItem(LS_KEY_CUSTOM_ENDPOINT, config.endpoint)
    }
    if (config.model !== undefined) {
      window.localStorage.setItem(LS_KEY_CUSTOM_MODEL, config.model)
    }
  } catch (err) {
    if (import.meta.env.DEV) console.warn('[ai] 写入自定义模型配置失败', err)
  }
}

// 统一导出错误类与所有类型
export { AIError } from './types'
// AI 调用来源追踪（各模块展示「来自哪个 AI 接口」）
export {
  recordAIUsage,
  getAIUsage,
  subscribeAIUsage,
  clearAIUsage,
  type AIUsageRecord,
} from './aiUsageTracker'
export {
  AI_STATUS,
  DEEPSEEK_STATUS,
  isRetryableStatus,
  isNonRetryableClientError,
  getAIErrorMessage,
  getDeepSeekErrorMessage,
} from './errors'
// 导出 Provider 类供 useAIConnectionTest 与工厂切换使用
export { DeepSeekProvider } from './deepseekProvider'
export { OpenAIProvider } from './openaiProvider'
export { QwenProvider } from './qwenProvider'
export { CustomProvider, normalizeCustomEndpoint } from './customProvider'
export { FallbackAIProvider, createUnavailableProvider } from './fallbackProvider'
export {
  AI_PROVIDER_META,
  type AIProviderMeta,
  type AIProviderName,
  type AIProvider,
  type ArticleGenerationResult,
  type ChatMessage,
  type Genre,
  type MnemonicResult,
  type QuestionGenerationResult,
  type StreamOptions,
  type VocabularyImportance,
  type VocabularyItem,
  type WordBreakdown,
  type WordHint,
} from './types'
