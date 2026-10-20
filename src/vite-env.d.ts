/// <reference types="vite/client" />
/// <reference types="vitest/globals" />

interface ImportMetaEnv {
  // AI 供应商选择（deepseek / openai / qwen，localStorage 用户选择优先于此默认值）
  readonly VITE_AI_PROVIDER?: string

  // DeepSeek AI 配置
  readonly VITE_DEEPSEEK_API_KEY?: string
  readonly VITE_DEEPSEEK_MODEL?: string

  // OpenAI 配置
  readonly VITE_OPENAI_API_KEY?: string
  readonly VITE_OPENAI_MODEL?: string

  // 通义千问（DashScope compatible-mode）配置
  readonly VITE_QWEN_API_KEY?: string
  readonly VITE_QWEN_MODEL?: string

  // 自定义模型（OpenAI Chat Completions 兼容端点）配置
  readonly VITE_CUSTOM_API_ENDPOINT?: string
  readonly VITE_CUSTOM_MODEL?: string
  readonly VITE_CUSTOM_API_KEY?: string

  // 本地服务器 API 配置
  readonly VITE_API_BASE_URL?: string

  // AI 代理配置
  readonly VITE_AI_PROXY_URL?: string
  readonly VITE_AI_PROXY_TOKEN?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
