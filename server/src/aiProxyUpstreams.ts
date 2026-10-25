// AI 代理上游注册表与运行时解析
//
// 内置供应商上游配置从 config/ai-providers.json 单一注册表派生（见 aiConfig.ts），
// 消除端点/白名单/密钥变量名的硬编码冗余；JSON 缺失或字段缺失时 getProviderMeta
// 回退内置默认值（等价于历史硬编码），保证向后兼容。
import { getProviderMeta, loadAiProvidersConfig } from './aiConfig.js'

/**
 * 上游供应商配置：新增供应商只需在 UPSTREAMS 追加条目，
 * 路由（/v1/ai-proxy/<name> 与 /v1/ai-proxy/<name>/stream）自动注册。
 */
export interface UpstreamConfig {
  // 上游端点 URL（固定端点供应商）
  endpoint: string
  // 上游端点的环境变量名（可选，custom 部署级配置）
  // 存在时每次请求运行时读取并规范化（Base URL 自动拼接 /chat/completions），
  // 未配置时该路由返回 503 CUSTOM_NOT_CONFIGURED
  endpointEnv?: string
  // 上游鉴权密钥的环境变量名
  envKeyName: string
  // 模型白名单（防止恶意构造 body 触发计费）
  allowedModels: string[]
  // 模型白名单的环境变量名（可选，custom 部署级配置，逗号分隔）
  // 存在时运行时读取；未配置时白名单为空 = 放行任意 model（由上游 API Key 计费管控）
  allowedModelsEnv?: string
}

// 内置供应商 + 自定义模型上游配置
export const UPSTREAMS: Record<string, UpstreamConfig> = {
  deepseek: {
    endpoint: getProviderMeta('deepseek').endpoint!,
    envKeyName: getProviderMeta('deepseek').keyEnv!,
    allowedModels: getProviderMeta('deepseek').allowedModels!,
  },
  openai: {
    endpoint: getProviderMeta('openai').endpoint!,
    envKeyName: getProviderMeta('openai').keyEnv!,
    allowedModels: getProviderMeta('openai').allowedModels!,
  },
  qwen: {
    endpoint: getProviderMeta('qwen').endpoint!,
    envKeyName: getProviderMeta('qwen').keyEnv!,
    allowedModels: getProviderMeta('qwen').allowedModels!,
  },
  // 自定义模型上游（生产代理模式节点）：端点 / 模型 / 密钥变量名在 config/ai-providers.json
  // 的 custom 字段声明，server/src/index.ts 启动时派生 CUSTOM_API_ENDPOINT / CUSTOM_MODELS；
  // 密钥值写在 .env 的 CUSTOM_API_KEY（JSON 只存变量名 keyEnv，不存密钥值）
  // SSRF 防护：endpoint 只信服务端 env 固定值，前端请求体不透传任何 URL，
  // 用户在个人中心自填的端点不经此路由（由前端浏览器直连）
  custom: {
    endpoint: '',
    endpointEnv: 'CUSTOM_API_ENDPOINT',
    envKeyName: loadAiProvidersConfig().custom?.keyEnv ?? 'CUSTOM_API_KEY',
    allowedModels: [],
    allowedModelsEnv: 'CUSTOM_MODELS',
  },
}

/**
 * 规范化上游端点为完整的 chat/completions URL
 * - 已含 /chat/completions：原样返回（去除尾部斜杠）
 * - 否则视为 Base URL：拼接 /chat/completions
 * - 空值返回空串（路由层据此返回 503）
 */
function normalizeUpstreamEndpoint(raw: string): string {
  const trimmed = raw.trim().replace(/\/+$/, '')
  if (!trimmed) return ''
  if (trimmed.endsWith('/chat/completions')) {
    return trimmed
  }
  return `${trimmed}/chat/completions`
}

/**
 * 解析上游运行时配置（固定值或 env 动态读取）
 * custom 的端点/白名单在每次请求时点读取（测试与运维改 env 后无需重启即可生效）
 */
export function resolveUpstream(upstream: UpstreamConfig): {
  endpoint: string
  allowedModels: string[]
} {
  const endpoint = upstream.endpointEnv
    ? normalizeUpstreamEndpoint(process.env[upstream.endpointEnv] ?? '')
    : upstream.endpoint
  const allowedModels = upstream.allowedModelsEnv
    ? (process.env[upstream.allowedModelsEnv] ?? '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    : upstream.allowedModels
  return { endpoint, allowedModels }
}
