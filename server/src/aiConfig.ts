// AI 供应商配置加载器（服务端）
//
// 读取项目根 config/ai-providers.json —— custom 端点/模型与兜底供应商的单一注册表，
// 供 server/src/index.ts（派生 CUSTOM_* 环境变量）与 server/src/ai-proxy.ts（UPSTREAMS 注册表）共用。
// 内置供应商（deepseek/openai/qwen）的默认元数据由本文件 DEFAULT_PROVIDERS 提供，
// JSON 中的 providers 段为可选覆盖层（未声明时直接使用内置默认值）。
//
// 设计原则（与前端 vite.config.ts 的注入逻辑对齐，二者读取同一 JSON）：
// - custom 的 endpoint / model / keyEnv 与 fallback 的 provider / model 在 JSON 声明；
//   内置供应商的默认/轻量模型由前端 AI_PROVIDER_META 与各 Provider 常量维护，服务端代理无需感知
// - 密钥只存「变量名」（keyEnv，如 "DEEPSEEK_API_KEY"），**绝不在此文件填写密钥值**；
//   实际密钥值写在服务端 .env（不进前端 bundle，也不随本文件进入版本库风险面）
// - JSON 缺失或字段缺失 → 回退内置 DEFAULT_PROVIDERS（等价于历史硬编码值，保证向后兼容）
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))

// 单个供应商元数据（字段均可选，缺失时回退 DEFAULT_PROVIDERS 对应值）
export interface ProviderMeta {
  // 上游端点（固定端点供应商）
  endpoint?: string
  // 密钥所在的**环境变量名**（仅变量名，非密钥值），如 "DEEPSEEK_API_KEY"
  keyEnv?: string
  // 服务端模型白名单（防恶意构造 body 触发计费）
  allowedModels?: string[]
}

// ai-providers.json 完整结构
export interface AiProvidersConfig {
  // 内置供应商注册表（deepseek / openai / qwen ...）
  providers?: Record<string, ProviderMeta>
  // 自定义模型（OpenAI 兼容端点）：端点 + 模型 + 密钥变量名
  custom?: { endpoint?: string; model?: string; keyEnv?: string }
  // 兜底供应商（自定义 API 失败时切换的备用上游）
  fallback?: { provider?: string; model?: string }
}

// 内置供应商默认元数据：JSON 未提供 providers 段或字段缺失时使用；
// JSON 的 providers.<name> 可逐字段覆盖此处默认值
export const DEFAULT_PROVIDERS: Record<string, ProviderMeta> = {
  deepseek: {
    endpoint: 'https://api.deepseek.com/chat/completions',
    keyEnv: 'DEEPSEEK_API_KEY',
    allowedModels: ['deepseek-v4-pro', 'deepseek-v4-flash'],
  },
  openai: {
    endpoint: 'https://api.openai.com/v1/chat/completions',
    keyEnv: 'OPENAI_API_KEY',
    allowedModels: ['gpt-5.2', 'gpt-5.2-mini'],
  },
  qwen: {
    endpoint: 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions',
    keyEnv: 'QWEN_API_KEY',
    allowedModels: ['qwen3-max', 'qwen3-turbo'],
  },
}

// 模块级缓存：JSON 在进程生命周期内不变，避免重复读盘
let cachedConfig: AiProvidersConfig | null = null

/**
 * 读取 config/ai-providers.json（带缓存）
 * 文件缺失 / 解析失败时返回空对象，由调用方回退默认值（不抛错，保证服务可启动）
 * 路径：相对本文件（server/src 或 server/dist）向上两级到项目根 config/
 */
export function loadAiProvidersConfig(): AiProvidersConfig {
  if (cachedConfig) return cachedConfig
  try {
    cachedConfig = JSON.parse(
      readFileSync(resolve(__dirname, '../../config/ai-providers.json'), 'utf-8')
    ) as AiProvidersConfig
  } catch {
    cachedConfig = {}
  }
  return cachedConfig
}

/**
 * 获取内置供应商元数据：JSON 声明优先，逐字段回退 DEFAULT_PROVIDERS
 * 用于 ai-proxy.ts 派生 UPSTREAMS（endpoint / keyEnv / allowedModels）
 * @param name 供应商名（deepseek / openai / qwen ...）
 * @returns 合并后的元数据（DEFAULT 兜底保证 endpoint/keyEnv/allowedModels 有值）
 */
export function getProviderMeta(name: string): ProviderMeta {
  const fromJson = loadAiProvidersConfig().providers?.[name]
  return { ...DEFAULT_PROVIDERS[name], ...fromJson }
}
