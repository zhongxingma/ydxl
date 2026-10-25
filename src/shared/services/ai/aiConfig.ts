// AI 供应商运行时配置
//
// 统一读取环境变量与 localStorage，解析当前供应商、自定义模型配置与基础连接配置。
// 仅负责配置解析，不实例化 Provider（见 providerFactory.ts）。
import { type AIProviderName } from './types'
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
export const LS_KEY_AI_PROVIDER = 'ydxl-ext-ai-provider'

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
export function makeKeyResolver(name: AIProviderName): () => Promise<string> {
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
export function parseProviderName(value: string | null | undefined): AIProviderName | null {
  return value === 'deepseek' || value === 'openai' || value === 'qwen' || value === 'custom'
    ? value
    : null
}

/**
 * 判断自定义模型的 env 默认配置是否完整（端点 + 模型 ID）
 * 用于供应商自动检测：未显式指定供应商但配置了完整的自定义模型时，自动选用 custom，
 * 避免"填了 VITE_CUSTOM_* 却仍走 deepseek 导致 503"的部署陷阱
 */
export function isCustomEnvConfigured(): boolean {
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
export function getUserSelectedProvider(): AIProviderName {
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
export function buildBaseConfig(
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

// 供工厂读取代理地址与自定义模型 env 默认密钥
export const AI_ENV = env
