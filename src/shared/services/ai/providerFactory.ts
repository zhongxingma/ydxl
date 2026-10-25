// AI 供应商工厂：按名称实例化内置 / 自定义 Provider，并组装兜底链
import { type AIProvider, type AIProviderName } from './types'
import { DeepSeekProvider } from './deepseekProvider'
import { OpenAIProvider } from './openaiProvider'
import { QwenProvider } from './qwenProvider'
import { CustomProvider } from './customProvider'
import { FallbackAIProvider, createUnavailableProvider } from './fallbackProvider'
import {
  AI_ENV,
  buildBaseConfig,
  getCustomModelConfig,
  getUserSelectedProvider,
  makeKeyResolver,
  parseProviderName,
  shouldCustomUseProxy,
} from './aiConfig'

/**
 * 构造兜底供应商实例（自定义 API 调用失败/不可用时切换的备用上游）
 * 配置来自单一配置源 config/ai-providers.json 的 fallback 字段，经 vite.config.ts 注入
 * VITE_FALLBACK_AI_PROVIDER / VITE_FALLBACK_MODEL。
 * - provider 仅支持内置供应商（deepseek/openai/qwen），不支持 custom（避免递归兜底）；
 *   未配置或值非法时回退 deepseek（与历史硬编码行为一致）
 * - model 覆盖兜底供应商模型（未配置时沿用该供应商 env 模型，其次供应商默认模型）
 */
export function buildFallbackProvider(): AIProvider {
  const fallbackRaw = parseProviderName(AI_ENV.VITE_FALLBACK_AI_PROVIDER as string | undefined)
  const name: Exclude<AIProviderName, 'custom'> =
    fallbackRaw && fallbackRaw !== 'custom' ? fallbackRaw : 'deepseek'
  const modelOverride = (AI_ENV.VITE_FALLBACK_MODEL as string | undefined)?.trim()
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

/**
 * 按供应商名称实例化 Provider（内部使用，不对外导出；外部切换用 createAIProviderByName）
 * @param providerName 可选指定供应商名称，未传则从 getUserSelectedProvider() 读取
 */
export function createAIProvider(providerName?: AIProviderName): AIProvider {
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
          proxyBaseUrl: AI_ENV.VITE_AI_PROXY_URL as string,
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
          return userKey || (AI_ENV.VITE_CUSTOM_API_KEY as string) || ''
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
              return userKey || (AI_ENV.VITE_CUSTOM_API_KEY as string) || ''
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
