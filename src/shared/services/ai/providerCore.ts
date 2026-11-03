// AI Provider 核心层
//
// 提供所有供应商共享的配置与传输能力：
// - 构造函数与配置字段（apiKey / model / proxyBaseUrl / keyResolver）
// - 端点解析（直连 vs 代理模式）
// - 调用入口（callChat / callChatCached / callChatStream，实现在 requestRunner.ts）
// - withAIError 异常包装
//
// 业务任务方法按领域拆分到：
//   - providerContentTasks.ts：内容类任务入口（文章 / 题目 / 语法填空 / 翻译 / 词汇 / 短语），
//     具体流程在 contentArticleTasks.ts / contentQuestionTasks.ts / contentTextTasks.ts
//   - providerWordTasks.ts：单词提示 / 拼读 / 助记 / 例句 / emoji / 补全 / 连通性测试
import { logger } from '../../utils/logger'
import {
  AIError,
  AI_PROVIDER_META,
  type AIProviderName,
  type ChatMessage,
} from './types'
import * as tokenStats from './tokenStats'
import { computeCacheKey, getCached, setCached } from './responseCache'
import {
  ProviderRequestRunner,
  type ChatRequestOptions,
  type ChatStreamRequestOptions,
} from './requestRunner'

// Base Provider 配置
export interface BaseProviderConfig {
  apiKey?: string
  model?: string
  proxyBaseUrl?: string
  // 运行时密钥解析器：apiKey 未显式配置时，在每次请求前异步解析（如 secureStorage 中
  // 用户在「个人中心 → AI 设置」保存的密钥）。返回空串表示无可用密钥。
  // 设计动机：secureStorage 为异步 API，业务单例工厂无法同步读取，
  // 旧实现导致用户在个人中心保存的自定义模型密钥在刷新页面后丢失（业务调用报
  // 「未配置 apiKey」）；keyResolver 将解析延迟到请求时点，兼容异步存储。
  keyResolver?: () => Promise<string>
}

// Provider 核心抽象类：仅负责配置、能力探测与传输层委托
// 具体业务任务由 ContentTaskProvider / WordTaskProvider 分层实现
export abstract class ProviderCore {
  protected readonly apiKey?: string
  protected readonly model: string
  protected readonly proxyBaseUrl?: string
  // 运行时密钥解析器（见 BaseProviderConfig.keyResolver 注释）
  private readonly keyResolver?: () => Promise<string>

  // 当前供应商元数据（由子类 providerName() 派生，构造时解析一次）
  // 用于 JSON 模式能力探测与按供应商本地化错误消息
  private meta: typeof AI_PROVIDER_META[AIProviderName] | null = null

  // 传输层执行器：并发节流、重试、fetch/SSE 与错误映射（见 requestRunner.ts）
  private readonly requestRunner: ProviderRequestRunner

  // 请求去重：相同 cacheKey 的并发请求共享同一 Promise，避免重复调用 API
  // 仅对可缓存场景生效（callChatCached 入口检查），非缓存场景不去重
  private readonly inflightRequests = new Map<string, Promise<string>>()

  constructor(config: BaseProviderConfig = {}) {
    this.apiKey = config.apiKey
    this.model = config.model ?? this.defaultModel()
    this.proxyBaseUrl = config.proxyBaseUrl
    this.keyResolver = config.keyResolver
    // 传输层通过回调读取实例状态与子类差异化实现（延迟到请求时调用，构造阶段不触发）
    this.requestRunner = new ProviderRequestRunner({
      providerName: () => this.providerName(),
      getModel: () => this.model,
      getProxyBaseUrl: () => this.proxyBaseUrl,
      getApiKey: () => this.apiKey,
      getEffectiveApiKey: () => this.getEffectiveApiKey(),
      resolveEndpoint: () => this.resolveEndpoint(),
      defaultEndpoint: () => this.defaultEndpoint(),
      getFetchTimeoutMs: () => this.getFetchTimeoutMs(),
      buildRequestBody: (messages, options) => this.buildRequestBody(messages, options),
      parseContent: (data) => this.parseContent(data),
      supportsJsonMode: () => this.supportsJsonMode(),
      jsonModeSupportsArray: () => this.jsonModeSupportsArray(),
      usagePlatformLabel: () => this.usagePlatformLabel(),
    })
    // 未提供 apiKey 且无代理地址时仅警告，调用时再抛错
    if (!this.apiKey && !this.proxyBaseUrl && !config.keyResolver) {
      logger.warn(
        `[${this.constructor.name}] 未配置 apiKey 且未设置代理地址，AI 调用将在执行时抛出 AIError。`
      )
    }
  }

  /**
   * 解析本次请求的有效密钥：显式 apiKey（env / 连接测试传入）> keyResolver
   * （secureStorage 中用户保存的密钥，实时读取保证个人中心修改后即时生效）
   * keyResolver 抛错时按无密钥处理（不影响既有降级逻辑）
   * @returns 有效密钥或 undefined
   */
  private async getEffectiveApiKey(): Promise<string | undefined> {
    if (this.apiKey) return this.apiKey
    if (!this.keyResolver) return undefined
    try {
      const resolved = await this.keyResolver()
      return resolved || undefined
    } catch (err) {
      if (import.meta.env.DEV)
        logger.warn('[base-provider] 运行时密钥解析失败，按未配置处理', err)
      return undefined
    }
  }

  /**
   * 导出当前基础配置（供包装类将凭证透传到自身的 super 构造）
   */
  getBaseConfig(): BaseProviderConfig {
    return {
      apiKey: this.apiKey,
      model: this.model,
      proxyBaseUrl: this.proxyBaseUrl,
      keyResolver: this.keyResolver,
    }
  }

  // ===== 子类必须实现的差异化方法 =====

  /**
   * 返回当前 Provider 名称（用于代理模式请求体的 provider 字段）
   * @returns Provider 名称字符串
   */
  abstract providerName(): string

  /**
   * 返回直连模式默认端点
   * @returns 默认端点 URL
   */
  abstract defaultEndpoint(): string

  // 获取当前供应商元数据（未知 providerName 时返回 null，如自定义子类）
  // 延迟解析：providerName 为抽象方法，构造函数阶段不可安全调用
  private getMeta(): typeof AI_PROVIDER_META[AIProviderName] | null {
    if (this.meta === null) {
      const name = this.providerName() as AIProviderName
      this.meta = AI_PROVIDER_META[name] ?? null
    }
    return this.meta
  }

  // 当前供应商是否支持 JSON Output 模式（response_format: json_object）
  // 不支持时 callChat 静默降级：仅依赖 prompt 约束输出格式（Qwen 兼容模式等场景）
  protected supportsJsonMode(): boolean {
    return this.getMeta()?.supportsJsonMode ?? true
  }

  // 数组类结果场景（题目/词汇/短语/emoji）是否可与 json_object 模式共存
  // DeepSeek 官方模型理解力强：prompt 要求顶层数组时仍会输出 [...]（合理弱化 schema 约束）；
  // 但第三方 OpenAI 兼容端点（SiliconFlow/OpenRouter 等）严格服从「顶层必须是 object」语义，
  // 会退化为返回单个对象（丢失数组括号，仅含第 1 条数据）或任意包装对象，导致数组解析失败。
  // 实测 SiliconFlow deepseek-ai/DeepSeek-V4-Flash：带 json_object 返回单个题目对象
  // （解析报「无法从对象包装中提取唯一数组字段」）；去掉后返回标准 5 题数组。
  // 此类供应商在 expectArray 场景跳过 response_format，仅靠 prompt 约束 +
  // parseJsonResponse 多级容错（剥代码块/提取平衡 JSON 块）保证解析
  protected jsonModeSupportsArray(): boolean {
    return true
  }

  // AI 来源徽章展示的平台标签（如 'DeepSeek' / 'SiliconFlow' / 'OpenRouter'）
  // 默认取供应商元数据 label；CustomProvider 覆盖为按端点 URL 推断实际平台
  // （自定义模型可能接入任意聚合平台，只显示模型 ID 无法判断调用的是哪个平台）
  protected usagePlatformLabel(): string {
    const meta = AI_PROVIDER_META[this.providerName() as AIProviderName]
    return meta?.label ?? this.providerName()
  }

  // 返回默认模型名（当 config.model 未指定时使用）
  protected abstract defaultModel(): string

  /**
   * 构造上游请求体（直连模式下即为最终请求体，代理模式下作为信封 body 字段）
   * options.maxTokens: 设置 max_tokens 防止 JSON 截断（DeepSeek JSON Output 官方要求）
   * options.thinkingDisabled: 禁用思考模式以降低延迟（简单 JSON 任务无需推理）
   * options.modelOverride: 单次请求模型覆盖（用于模型分级，简单任务降级到 deepseek-v4-flash 节省成本）
   * options.reasoningEffort: 控制思考强度（'high' | 'max'），仅在 thinking 未禁用时生效
   * options.temperature: 采样温度（0-2，默认跟随供应商）。仅创作型任务（文章生成）显式提高
   *   以增加用词/句式多样性、打破模板化；结构化 JSON 任务保持默认（确定性优先）。
   * @param messages 对话消息数组
   * @param options 可选参数：maxTokens / thinkingDisabled / modelOverride / reasoningEffort / temperature
   * @returns 上游请求体对象
   */
  abstract buildRequestBody(
    messages: ChatMessage[],
    options?: {
      maxTokens?: number
      thinkingDisabled?: boolean
      modelOverride?: string
      reasoningEffort?: 'high' | 'max'
      temperature?: number
    }
  ): unknown

  /**
   * 从上游响应中提取助手消息内容（返回空字符串表示无效内容）
   * @param data 上游响应数据
   * @returns 助手消息内容字符串；无效内容时返回空字符串
   */
  abstract parseContent(data: unknown): string

  // ===== 通用传输实现（子类无需覆盖） =====

  // 解析最终请求端点：走代理则拼接 `${proxyBaseUrl}/v1/ai-proxy/<providerName>`
  // 路径前缀 /v1/ai-proxy/ 用于 API 版本化，配合 vercel.json rewrite 规则：
  //   /api/v1/ai-proxy/:provider → /api/ai-proxy（Express 路由 server/src/ai-proxy.ts）
  // 前端默认 VITE_AI_PROXY_URL=/api 时拼接结果为 /api/v1/ai-proxy/<provider>
  protected resolveEndpoint(): string {
    if (this.proxyBaseUrl) {
      return `${this.proxyBaseUrl.replace(/\/+$/, '')}/v1/ai-proxy/${this.providerName()}`
    }
    return this.defaultEndpoint()
  }

  // 前端 fetch 超时阈值（170 秒）
  // 覆盖服务端 150s 上游超时 + 网络/5xx 重试退避 + 思考时间的端到端时延
  // （从 60s 提升：语法填空等长响应在第三方平台需 75-150s，60s 会先于
  // 服务端超时导致前端误报超时；须保持 > 服务端 UPSTREAM_TIMEOUT_MS）
  // 提取为 protected 方法便于子类/测试覆盖
  protected getFetchTimeoutMs(): number {
    return 170_000
  }

  /**
   * 返回轻量模型名（用于简单任务降级，降低成本）
   * 子类若支持模型分级（如 DeepSeek 的 v4-flash）应覆盖此方法返回具体模型名；
   * 默认返回 undefined 表示不分级，使用 this.model。
   * @returns 轻量模型名或 undefined
   */
  protected getFlashModel(): string | undefined {
    return undefined
  }

  // 统一处理 Chat 请求（实现在 requestRunner.ts）
  protected async callChat(
    messages: ChatMessage[],
    options?: ChatRequestOptions,
  ): Promise<string> {
    return this.requestRunner.callChat(messages, options)
  }

  /**
   * 带缓存的 Chat 调用（用于确定性场景，避免重复请求）
   *
   * 流程：
   * 1. 计算 cacheKey（scenario + model + sha256(system+user)）
   * 2. 查缓存（内存 LRU + localStorage），命中则直接返回（记录 cacheHit=true）
   * 3. 查 inflightRequests，命中则共享同一 Promise（请求去重）
   * 4. 未命中则发起 callChat，成功后写缓存
   *
   * @param scenario 调用场景标识（用于缓存 key 与统计）
   * @param messages 对话消息数组
   * @param options 调用选项（含 ttlMs 缓存存活时间）
   * @returns AI 返回的文本内容
   */
  protected async callChatCached(
    scenario: string,
    messages: ChatMessage[],
    options: {
      jsonMode?: boolean
      maxTokens?: number
      thinkingDisabled?: boolean
      modelOverride?: string
      reasoningEffort?: 'high' | 'max'
      ttlMs: number
      expectArray?: boolean
    }
  ): Promise<string> {
    const system = messages.find((m) => m.role === 'system')?.content ?? ''
    const user = messages.find((m) => m.role === 'user')?.content ?? ''
    const effectiveModel = options.modelOverride ?? this.model

    // 1. 计算 cacheKey
    // expectArray 场景附加 'array' 变体标记：数组类调用跳过 json_object 后响应形态
    // 与旧缓存（json_object 时代的单对象/包装对象坏响应）不同，key 隔离让历史
    // 坏缓存自然过期失效，避免修复后仍命中坏响应反复解析失败
    const cacheKey = await computeCacheKey(
      scenario,
      effectiveModel,
      system,
      user,
      options.expectArray ? 'array' : undefined
    )

    // 2. 查缓存
    const cached = await getCached<string>(cacheKey)
    if (cached !== null) {
      // 缓存命中：记录统计（cacheHit=true，token 用量为 0）
      try {
        tokenStats.recordUsage(
          scenario,
          effectiveModel,
          { prompt_tokens: 0, completion_tokens: 0 },
          true
        )
      } catch (statsErr) {
        if (import.meta.env.DEV)
          logger.warn('[base-provider] 缓存命中统计失败', statsErr)
      }
      if (import.meta.env.DEV)
        logger.debug('[AI Cache Hit]', { scenario, model: effectiveModel, isMemory: cached.isMemory })
      return cached.value
    }

    // 3. 查 inflightRequests（请求去重）
    const inflight = this.inflightRequests.get(cacheKey)
    if (inflight) {
      if (import.meta.env.DEV)
        logger.debug('[AI Inflight Dedup]', { scenario, model: effectiveModel })
      return inflight
    }

    // 4. 发起新请求，包装 Promise 写入 inflightRequests
    const requestPromise = (async () => {
      const text = await this.callChat(messages, {
        jsonMode: options.jsonMode,
        maxTokens: options.maxTokens,
        thinkingDisabled: options.thinkingDisabled,
        modelOverride: options.modelOverride,
        reasoningEffort: options.reasoningEffort,
        scenario,
        expectArray: options.expectArray,
      })
      // 成功后写缓存（best-effort，失败不阻塞返回）
      try {
        await setCached(cacheKey, text, options.ttlMs, scenario)
      } catch (cacheErr) {
        if (import.meta.env.DEV)
          logger.warn('[base-provider] 缓存写入失败', cacheErr)
      }
      return text
    })()

    this.inflightRequests.set(cacheKey, requestPromise)
    try {
      return await requestPromise
    } finally {
      // 无论成功失败都删除 inflight 条目，允许后续重试
      this.inflightRequests.delete(cacheKey)
    }
  }

  // 流式 Chat 调用（实现在 requestRunner.ts）
  protected async callChatStream(
    messages: ChatMessage[],
    options: ChatStreamRequestOptions,
  ): Promise<string> {
    return this.requestRunner.callChatStream(messages, options)
  }

  // 包装异步操作，确保任何异常都转换为 AIError
  protected async withAIError<T>(fn: () => Promise<T>, fallbackMsg: string): Promise<T> {
    try {
      return await fn()
    } catch (err) {
      if (err instanceof AIError) {
        throw err
      }
      // 非 AIError 错误：附加原始错误消息，避免真实失败原因（如网络/存储异常）被
      // fallbackMsg 掩盖（排查语法填空生成失败时发现信息丢失问题）
      const detail = err instanceof Error ? err.message : String(err)
      throw new AIError(detail ? `${fallbackMsg}：${detail}` : fallbackMsg, err)
    }
  }
}
