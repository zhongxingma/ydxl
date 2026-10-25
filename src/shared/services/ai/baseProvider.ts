// AI Provider 抽象基类
//
// 抽取 OpenAI / Qwen / DeepSeek 三个 Provider 的公共逻辑：
// - 构造函数与配置字段（apiKey / model / proxyBaseUrl）
// - 端点解析（直连 vs 代理模式）
// - callChat 通用流程（headers 设置、信封 body 包装、fetch、错误处理、内容提取）
// - withAIError 异常包装
// - AIProvider 接口的 9 个公开方法实现（复用 prompts.ts 与 callChat / withAIError）
//
// 子类只需实现差异化方法即可：
//   providerName / defaultEndpoint / defaultModel / buildRequestBody / parseContent
import {
  AIError,
  AI_PROVIDER_META,
  type AIProvider,
  type AIProviderName,
  type ArticleGenerationResult,
  type ChatMessage,
  type Genre,
  type MnemonicResult,
  type QuestionGenerationResult,
  type StreamOptions,
  type VocabularyItem,
  type WordBreakdown,
  type WordHint,
} from './types'
import type { ArticlePhrase, Difficulty, Topic } from '@/shared/types'
import {
  articlePrompt,
  articlePhrasesPrompt,
  emojiHintPrompt,
  exampleSentencePrompt,
  grammarFillPrompt,
  mnemonicPrompt,
  questionsPrompt,
  translationPrompt,
  vocabularyPrompt,
  wordBreakdownPrompt,
  wordEnrichPrompt,
  wordHintPrompt,
} from './prompts'
import * as tokenStats from './tokenStats'
import { computeCacheKey, getCached, setCached } from './responseCache'
import {
  parseExampleSentence,
  parseJsonArrayResponse,
  parseJsonResponse,
} from './jsonParsing'
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
  // 设计动机（2026-08-27）：secureStorage 为异步 API，业务单例工厂无法同步读取，
  // 旧实现导致用户在个人中心保存的自定义模型密钥在刷新页面后丢失（业务调用报
  // 「未配置 apiKey」）；keyResolver 将解析延迟到请求时点，兼容异步存储。
  keyResolver?: () => Promise<string>
}

// AI Provider 抽象基类
// 通过模板方法模式抽取公共逻辑，子类仅实现差异化方法
export abstract class BaseAIProvider implements AIProvider {
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
      console.warn(
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
        console.warn('[base-provider] 运行时密钥解析失败，按未配置处理', err)
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
  // 2026-08-29 实测 SiliconFlow deepseek-ai/DeepSeek-V4-Flash：带 json_object 返回单个题目对象
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

  // ===== 通用实现（子类无需覆盖） =====

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
  // （2026-08-29 从 60s 提升：语法填空等长响应在第三方平台需 75-150s，60s 会先于
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
          console.warn('[base-provider] 缓存命中统计失败', statsErr)
      }
      if (import.meta.env.DEV)
        console.debug('[AI Cache Hit]', { scenario, model: effectiveModel, isMemory: cached.isMemory })
      return cached.value
    }

    // 3. 查 inflightRequests（请求去重）
    const inflight = this.inflightRequests.get(cacheKey)
    if (inflight) {
      if (import.meta.env.DEV)
        console.debug('[AI Inflight Dedup]', { scenario, model: effectiveModel })
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
          console.warn('[base-provider] 缓存写入失败', cacheErr)
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
      // fallbackMsg 掩盖（2026-08-29 排查语法填空生成失败时发现信息丢失问题）
      const detail = err instanceof Error ? err.message : String(err)
      throw new AIError(detail ? `${fallbackMsg}：${detail}` : fallbackMsg, err)
    }
  }

  // ===== AIProvider 接口的 9 个公开方法 =====

  /**
   * 生成文章
   *
   * Phase 2 优化：
   * - thinkingDisabled: true：文章结构由 JSON schema 严格约束（200-300 词、文体/题材/难度指定、生词预标注），
   *   创作自由度有限，关闭思考节省 500-1500 token/次（v4-pro 输出价 6 元/M）。
   *   若文章质量下降可移除 thinkingDisabled 参数回滚到思考模式。
   * - maxTokens: 3072：典型响应 ~2000 token（文章+翻译+生词+短语），1.5x 上限 3072
   * - temperature: 0.9：文章为创作型任务，关闭思考后模型易套用训练数据的固定安全句式，
   *   导致题材/文体不同却行文雷同；显式提高采样温度（0.9）增加用词与句式多样性，
   *   配合 articlePrompt 的随机叙事视角注入共同打破「千篇一律」（2026-09-05）
   *
   * @param date 日期字符串
   * @param genre 文章体裁（可选）
   * @param topic 文章主题（可选）
   * @param difficulty 难度等级（可选）
   * @param avoidTopics 需回避的主题列表（可选）
   * @returns 文章生成结果（含标题、正文、翻译等字段）
   * @throws AIError 当生成失败或结果缺少必要字段时抛出
   */
  async generateArticle(
    date: string,
    genre?: Genre,
    topic?: Topic,
    difficulty?: Difficulty,
    avoidTopics?: string[],
    streamOptions?: StreamOptions
  ): Promise<ArticleGenerationResult> {
    return this.withAIError(async () => {
      const { system, user } = articlePrompt(date, genre, topic, difficulty, avoidTopics)
      const messages: ChatMessage[] = [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ]

      // 结果校验失败重试：轻量模型（如第三方 Flash）生成复杂 JSON 偶发缺字段/高亮词为空，
      // 单次结果不合格不应立即抛错触发 FallbackAIProvider 切换官方兜底（违背「自定义可用优先」）。
      // 此处对「JSON 解析 + 字段校验」的失败在同一供应商内重试（合计最多 3 次），
      // 仅在重试耗尽后才抛出；网络/超时/中断类错误不在此重试（callChat 内部已处理）。
      const MAX_RESULT_ATTEMPTS = 3
      let lastError: unknown
      for (let attempt = 0; attempt < MAX_RESULT_ATTEMPTS; attempt++) {
        // 生成文本：流式（失败降级非流式）或非流式
        let text: string
        if (streamOptions) {
          // Phase 3：流式输出 + 中断机制；流式失败（重试耗尽）降级到非流式
          try {
            text = await this.callChatStream(messages, {
              jsonMode: true,
              maxTokens: 3072,
              thinkingDisabled: true,
              scenario: 'article',
              signal: streamOptions.signal,
              onChunk: streamOptions.onChunk,
              temperature: 0.9,
            })
          } catch (err) {
            // 外部中断不降级，直接抛出
            if (err instanceof Error && err.name === 'AbortError') throw err
            console.warn('[generateArticle] 流式生成失败，降级到非流式模式', err)
            // 通知 UI 重置（切换到"备选方案"状态，清除残留 partial 文本）
            streamOptions.onChunk?.('', '')
            text = await this.callChat(messages, {
              jsonMode: true,
              maxTokens: 3072,
              thinkingDisabled: true,
              scenario: 'article',
              temperature: 0.9,
            })
          }
        } else {
          text = await this.callChat(messages, {
            jsonMode: true,
            maxTokens: 3072,
            thinkingDisabled: true,
            scenario: 'article',
            temperature: 0.9,
          })
        }

        // 解析 + 字段校验；失败视为「结果不合格」重试同供应商
        try {
          const result = parseJsonResponse<ArticleGenerationResult>(text)
          // 逐一校验必要字段，缺失时精确提示
          const requiredFields: { key: keyof ArticleGenerationResult; label: string }[] = [
            { key: 'title', label: 'title' },
            { key: 'content', label: 'content' },
            { key: 'translation', label: 'translation' },
            { key: 'genre', label: 'genre' },
            { key: 'wordCount', label: 'wordCount' },
            { key: 'topic', label: 'topic' },
            { key: 'difficulty', label: 'difficulty' },
            { key: 'lexileRange', label: 'lexileRange' },
            { key: 'highlightedWords', label: 'highlightedWords' },
          ]
          for (const { key, label } of requiredFields) {
            if (result[key] == null || result[key] === '') {
              throw new AIError(`文章生成结果缺少必要字段: ${label}`)
            }
          }
          // highlightedWords 强化校验：必须是非空数组
          // 第三方/开源模型偶发返回空数组（字段存在但内容缺失），空数组会让文章无高亮生词；
          // 视为不合格结果重试；重试耗尽后由上层降级到兜底素材库（自带完整 highlightedWords）
          if (!Array.isArray(result.highlightedWords) || result.highlightedWords.length === 0) {
            throw new AIError('文章生成结果缺少必要字段: highlightedWords（为空数组）')
          }
          return result
        } catch (err) {
          lastError = err
          if (attempt + 1 < MAX_RESULT_ATTEMPTS) {
            console.warn(
              `[generateArticle] 结果校验失败（第 ${attempt + 1}/${MAX_RESULT_ATTEMPTS} 次），重试同供应商`,
              err,
            )
            continue
          }
          throw err
        }
      }
      // 理论上不可达（循环末次校验失败会 throw），保留以满足 noImplicitReturns
      throw lastError
    }, '生成文章失败')
  }

  /**
   * 生成阅读理解题目
   *
   * 优化（2026-07-26 修复练习题生成失败问题）：
   * - thinkingDisabled: true：命题虽需推理干扰项迷惑性，但 DeepSeek V4-Pro 基础能力足够，
   *   关闭思考可避免思考过程消耗 500-1500 token 导致 maxTokens 预算不足。
   *   思考模式 + JSON Output 模式存在已知的内容截断与空 content 问题（DeepSeek 官方文档：
   *   https://api-docs.deepseek.com/zh-cn/guides/json_mode），禁用思考后稳定性显著提升。
   *   与 generateArticle / extractVocabulary 保持一致策略（结构化 JSON 任务一律禁用思考）。
   *   若命题质量下降可恢复 reasoningEffort: 'high' 并将 maxTokens 提至 4096+。
   * - maxTokens: 3072：典型响应 ~1500 token（3-5 题 + stem/options/explanation/locationClue），
   *   预留 1.5x 上限 3072，避免 phrases 较多时被截断导致 JSON 解析失败
   *
   * Phase 3 优化（2026-07-27）：
   * - 启用 7 天缓存：失败重试时（JSON 解析失败、网络错误后）直接命中缓存，避免重复调用 AI；
   *   同文章二次请求题目时（用户清除本地数据后重新阅读）直接返回缓存。
   *   questionService 数据库持久化已避免大部分重复，缓存仅作为兜底（命中率预计 10-20%）。
   *   注意：不使用 modelOverride，保持 v4-pro 命题质量。
   *
   * @param articleId 文章 ID
   * @param articleContent 文章正文内容
   * @returns 题目数组
   * @throws AIError 当生成失败或结果非有效非空数组时抛出
   */
  async generateQuestions(
    articleId: string,
    articleContent: string,
    genre?: Genre,
    streamOptions?: StreamOptions
  ): Promise<QuestionGenerationResult[]> {
    return this.withAIError(async () => {
      const { system, user } = questionsPrompt(articleId, articleContent, genre)
      const messages: ChatMessage[] = [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ]
      let text: string
      if (streamOptions) {
        // Phase 3：流式输出 + 中断机制；流式失败（重试耗尽）降级到非流式 + 7 天缓存
        try {
          text = await this.callChatStream(messages, {
            jsonMode: true,
            maxTokens: 3072,
            thinkingDisabled: true,
            scenario: 'questions',
            signal: streamOptions.signal,
            onChunk: streamOptions.onChunk,
            expectArray: true,
          })
        } catch (err) {
          // 外部中断不降级，直接抛出
          if (err instanceof Error && err.name === 'AbortError') throw err
          console.warn('[generateQuestions] 流式生成失败，降级到非流式模式', err)
          // 通知 UI 重置（切换到"备选方案"状态，清除残留 partial 文本）
          streamOptions.onChunk?.('', '')
          text = await this.callChatCached('questions', messages, {
            jsonMode: true,
            maxTokens: 3072,
            thinkingDisabled: true,
            ttlMs: Infinity, // 永久缓存（同文章同题目）
            expectArray: true,
          })
        }
      } else {
        // 非流式：使用 callChatCached（7 天缓存兜底失败重试）
        text = await this.callChatCached('questions', messages, {
          jsonMode: true,
          maxTokens: 3072,
          thinkingDisabled: true,
          ttlMs: Infinity, // 永久缓存（同文章同题目）
          expectArray: true,
        })
      }
      const result = parseJsonArrayResponse<QuestionGenerationResult>(text)
      if (result.length === 0) {
        throw new AIError('题目生成结果不是有效的非空数组')
      }
      return result
    }, '生成题目失败')
  }

  /**
   * 生成语法填空题
   * 从文章中选取含典型语法点的句子挖空，生成 2-3 道选择填空题
   * explanation 须深度透彻：语法知识点 + 正确项依据 + 干扰项排除 + 拓展知识
   * 复用 generateQuestions 的流式 + 降级 + 缓存模式
   *
   * @param articleId 文章 ID
   * @param articleContent 文章正文内容
   * @param streamOptions 流式选项（可选）
   * @returns 语法填空题目数组
   * @throws AIError 当生成失败或结果非有效非空数组时抛出
   */
  async generateGrammarFillQuestions(
    articleId: string,
    articleContent: string,
    streamOptions?: StreamOptions
  ): Promise<QuestionGenerationResult[]> {
    return this.withAIError(async () => {
      const { system, user } = grammarFillPrompt(articleId, articleContent)
      const messages: ChatMessage[] = [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ]
      let text: string
      if (streamOptions) {
        // 流式输出 + 中断机制；流式失败（重试耗尽）降级到非流式 + 7 天缓存
        try {
          text = await this.callChatStream(messages, {
            jsonMode: true,
            maxTokens: 4096,
            thinkingDisabled: true,
            scenario: 'grammar_fill',
            signal: streamOptions.signal,
            onChunk: streamOptions.onChunk,
            expectArray: true,
          })
        } catch (err) {
          // 外部中断不降级，直接抛出
          if (err instanceof Error && err.name === 'AbortError') throw err
          console.warn('[generateGrammarFillQuestions] 流式生成失败，降级到非流式模式', err)
          // 通知 UI 重置（切换到"备选方案"状态，清除残留 partial 文本）
          streamOptions.onChunk?.('', '')
          text = await this.callChatCached('grammar_fill', messages, {
            jsonMode: true,
            maxTokens: 4096,
            thinkingDisabled: true,
            ttlMs: Infinity, // 永久缓存
            expectArray: true,
          })
        }
      } else {
        // 非流式：使用 callChatCached（7 天缓存兜底失败重试）
        text = await this.callChatCached('grammar_fill', messages, {
          jsonMode: true,
          maxTokens: 4096,
          thinkingDisabled: true,
          ttlMs: Infinity, // 永久缓存
          expectArray: true,
        })
      }
      const result = parseJsonArrayResponse<QuestionGenerationResult>(text)
      if (result.length === 0) {
        throw new AIError('语法填空题生成结果不是有效的非空数组')
      }
      return result
    }, '生成语法填空题失败')
  }

  /**
   * 生成翻译
   * 翻译为成熟任务，使用 deepseek-v4-flash 降低成本（约为 v4-pro 的 1/3）
   * 同内容同译文，启用 30 天缓存避免重复请求
   * @param content 待翻译的文本内容
   * @returns 翻译后的文本（已 trim）
   * @throws AIError 当生成失败时抛出
   */
  async generateTranslation(content: string): Promise<string> {
    return this.withAIError(async () => {
      const { system, user } = translationPrompt(content)
      const text = await this.callChatCached(
        'translation',
        [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        {
          maxTokens: 768,
          modelOverride: this.getFlashModel(),
          ttlMs: Infinity, // 永久缓存
        }
      )
      return text.trim()
    }, '生成翻译失败')
  }

  /**
   * 提取词汇
   *
   * Phase 3 优化（2026-07-27）：
   * - 模型降级 v4-pro → v4-flash：词汇提取为机械性任务（识别中考高频词 + 附音标/词性/释义/例句），
   *   v4-flash 足够，单次成本降低 67%（v4-pro 3元/百万输入 → v4-flash 1元/百万输入）。
   * - 启用 24 小时缓存：同文章同词汇结果稳定，重复打开页面时直接命中缓存（0 token 消耗）。
   *   缓存命中率预计 30-50%（用户反复阅读同文章场景）。
   * - thinkingDisabled: true：无需深度推理，关闭思考节省 500-1500 token/次。
   * - maxTokens: 1536：典型响应 ~1000 token（8-15 词 + 例句翻译），1.5x 上限 1536。
   *
   * @param content 文本内容
   * @returns 词汇项数组
   * @throws AIError 当提取失败或结果非有效数组时抛出
   */
  async extractVocabulary(content: string): Promise<VocabularyItem[]> {
    return this.withAIError(async () => {
      const { system, user } = vocabularyPrompt(content)
      const text = await this.callChatCached(
        'vocabulary',
        [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        {
          jsonMode: true,
          maxTokens: 1536,
          thinkingDisabled: true,
          modelOverride: this.getFlashModel(), // v4-pro → v4-flash，节省 2/3 成本
          ttlMs: Infinity, // 永久缓存（同文章同词汇）
          expectArray: true,
        }
      )
      const result = parseJsonArrayResponse<VocabularyItem>(text)
      return result
    }, '词汇提取失败')
  }

  /**
   * 提取文章短语（为历史文章补全 phrases）
   *
   * 用于功能上线前生成的历史文章（article.phrases 为 undefined），
   * 从已有文章内容中提取 5-8 个重点短语，每个含 phrase/meaning/example/exampleTranslation。
   *
   * 复用 extractVocabulary 的策略：
   * - 模型使用 deepseek-v4-flash：短语提取为机械性任务，flash 足够
   * - 启用 24 小时缓存：同文章同短语结果稳定，重复打开页面直接命中缓存
   * - thinkingDisabled: true：无需深度推理，关闭思考节省 token
   * - maxTokens: 1536：典型响应 ~1000 token（5-8 短语 + 例句翻译），1.5x 上限 1536
   *
   * @param content 文章英文正文
   * @returns 短语数组
   * @throws AIError 当提取失败或结果非有效数组时抛出
   */
  async extractArticlePhrases(content: string): Promise<ArticlePhrase[]> {
    return this.withAIError(async () => {
      const { system, user } = articlePhrasesPrompt(content)
      const text = await this.callChatCached(
        'articlePhrases',
        [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        {
          jsonMode: true,
          maxTokens: 1536,
          thinkingDisabled: true,
          modelOverride: this.getFlashModel(), // v4-pro → v4-flash，节省 2/3 成本
          ttlMs: Infinity, // 永久缓存（同文章同短语）
          expectArray: true,
        }
      )
      const result = parseJsonArrayResponse<ArticlePhrase>(text)
      return result
    }, '文章短语提取失败')
  }

  /**
   * 生成单词提示
   * 图像联想 + 口诀为简单创作任务，使用 deepseek-v4-flash 降低成本
   * 同 word+definition 输入可接受相同结果，启用 7 天缓存
   * @param word 单词
   * @param definition 释义
   * @returns 单词提示（含图像联想与助记）
   * @throws AIError 当生成失败或结果缺少必要字段时抛出
   */
  async generateWordHint(word: string, definition: string): Promise<WordHint> {
    return this.withAIError(async () => {
      const { system, user } = wordHintPrompt(word, definition)
      const text = await this.callChatCached(
        'wordHint',
        [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        {
          jsonMode: true,
          maxTokens: 256,
          thinkingDisabled: true,
          modelOverride: this.getFlashModel(),
          ttlMs: Infinity, // 永久缓存
        }
      )
      const result = parseJsonResponse<WordHint>(text)
      if (!result.imageAssociation || !result.mnemonic) {
        throw new AIError('单词提示结果缺少必要字段')
      }
      return result
    }, '生成单词提示失败')
  }

  /**
   * 生成拼读分解
   * 拼读规则确定性强，使用 deepseek-v4-flash 降低成本
   * 同词同拼读，启用永久缓存（Infinity）
   * @param word 单词
   * @returns 拼读分解结果（含音素与音节数）
   * @throws AIError 当生成失败或结果缺少必要字段时抛出
   */
  async generateWordBreakdown(word: string): Promise<WordBreakdown> {
    return this.withAIError(async () => {
      const { system, user } = wordBreakdownPrompt(word)
      const text = await this.callChatCached(
        'wordBreakdown',
        [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        {
          jsonMode: true,
          maxTokens: 128,
          thinkingDisabled: true,
          modelOverride: this.getFlashModel(),
          ttlMs: Infinity, // 永久缓存（同词同拼读）
        }
      )
      const result = parseJsonResponse<WordBreakdown>(text)
      if (!Array.isArray(result.phonics) || typeof result.syllables !== 'number') {
        throw new AIError('拼读分解结果缺少必要字段')
      }
      return result
    }, '生成拼读分解失败')
  }

  /**
   * 生成助记口诀
   * 助记口诀为简单创作任务，使用 deepseek-v4-flash 降低成本
   * 同 word+definition 输入可接受相同结果，启用 7 天缓存
   * @param word 单词
   * @param definition 释义
   * @param root 词根（可选）
   * @returns 助记口诀结果
   * @throws AIError 当生成失败或结果缺少必要字段时抛出
   */
  async generateMnemonic(
    word: string,
    definition: string,
    root?: string
  ): Promise<MnemonicResult> {
    return this.withAIError(async () => {
      const { system, user } = mnemonicPrompt(word, definition, root)
      const text = await this.callChatCached(
        'mnemonic',
        [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        {
          jsonMode: true,
          maxTokens: 256,
          thinkingDisabled: true,
          modelOverride: this.getFlashModel(),
          ttlMs: Infinity, // 永久缓存
        }
      )
      const result = parseJsonResponse<MnemonicResult>(text)
      if (!result.mnemonic) {
        throw new AIError('助记口诀结果缺少必要字段')
      }
      return result
    }, '生成助记口诀失败')
  }

  /**
   * 生成例句
   * 例句生成难度可控，使用 deepseek-v4-flash 降低成本
   * 允许例句多样性，启用 24 小时短期缓存
   * @param word 单词
   * @param definition 释义
   * @returns 例句字符串
   * @throws AIError 当生成失败时抛出
   */
  async generateExampleSentence(word: string, definition: string): Promise<string> {
    return this.withAIError(async () => {
      const { system, user } = exampleSentencePrompt(word, definition)
      const text = await this.callChatCached(
        'exampleSentence',
        [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        {
          maxTokens: 256,
          modelOverride: this.getFlashModel(),
          ttlMs: Infinity, // 永久缓存
        }
      )
      return parseExampleSentence(text)
    }, '生成例句失败')
  }

  /**
   * 生成 emoji 助记
   * emoji 选择极简，使用 deepseek-v4-flash 降低成本
   * 同词同 emoji，启用永久缓存（Infinity）
   * @param word 单词
   * @param definition 释义
   * @returns emoji 字符串数组
   * @throws AIError 当生成失败或结果非有效数组时抛出
   */
  async generateEmojiHint(word: string, definition: string): Promise<string[]> {
    return this.withAIError(async () => {
      const { system, user } = emojiHintPrompt(word, definition)
      const text = await this.callChatCached(
        'emojiHint',
        [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        {
          jsonMode: true,
          // 64 → 256（2026-08-29 第三方模型 emoji 助记失败根因）：
          // 推理型第三方模型（如 OpenRouter nemotron）会先输出思考内容再给 JSON，
          // 64 tokens 极易截断（括号不闭合 → JSON 解析失败）；256 覆盖思考前缀 + 包装对象
          maxTokens: 256,
          thinkingDisabled: true,
          modelOverride: this.getFlashModel(),
          ttlMs: Infinity, // 永久缓存（同词同 emoji）
          expectArray: true,
        }
      )
      // allowPrimitives：json_object 模式下第三方模型会把 emoji 数组包成
      // {"emojis": ["☀️","🌞"]}（字符串元素），需放宽解包元素约束
      const result = parseJsonArrayResponse<string>(text, { allowPrimitives: true })
      return result
    }, '生成 emoji 助记失败')
  }

  /**
   * 连通性测试（个人中心「测试连接」按钮）
   *
   * 设计（2026-08-29 修复测试误报「AI 返回内容无法解析为 JSON」）：
   * - 极简纯文本请求，无 jsonMode、无缓存（callChat 直连，绕过 callChatCached），
   *   避免命中业务缓存造成「假成功」
   * - 连通性语义与 JSON 能力解耦：第三方模型 JSON 输出不合规不应判为连接失败
   * - maxTokens 512：推理型第三方模型会先输出思考内容，过小会截断导致空响应
   * - 成功标准：HTTP 200 且返回非空内容
   */
  async testConnection(): Promise<void> {
    return this.withAIError(async () => {
      const text = await this.callChat(
        [
          {
            role: 'user',
            content: ' connectivity check: reply with the single word OK',
          },
        ],
        {
          maxTokens: 512,
          scenario: 'connection_test',
        }
      )
      if (!text || !text.trim()) {
        throw new AIError('接口连通但返回内容为空，请检查模型是否可用')
      }
    }, '连接测试失败')
  }

  /**
   * 补全单个单词的音标/词性/释义/例句
   * 专为生词本 AI 补全设计，直接返回该单词的完整信息，不依赖文章上下文
   * 单词信息查询确定性强，使用 deepseek-v4-flash 降低成本
   * 词义稳定，启用 30 天长期缓存
   *
   * 优化（2026-07-26 修复生词 AI 补全失败问题）：
   * - maxTokens: 512 → 1024：wordEnrichPrompt 返回含 0-3 个 phrases（每项 4 字段）的完整 JSON，
   *   实测 token 需求 350-600，512 处于临界值，phrases 较多时被截断导致 JSON 解析失败。
   *   提升 1.5x 上限至 1024，覆盖最复杂响应场景
   *
   * @param word 单词
   * @returns 单词完整信息
   * @throws AIError 当补全失败时抛出
   */
  async enrichSingleWord(word: string): Promise<VocabularyItem> {
    return this.withAIError(async () => {
      const { system, user } = wordEnrichPrompt(word)
      const text = await this.callChatCached(
        'wordEnrich',
        [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        {
          jsonMode: true,
          maxTokens: 1024,
          thinkingDisabled: true,
          modelOverride: this.getFlashModel(),
          ttlMs: Infinity, // 永久缓存
        }
      )
      const result = parseJsonResponse<VocabularyItem>(text)
      // 校验返回的 word 字段（大小写不敏感）；不一致时使用输入的 word
      if (!result.word || result.word.toLowerCase() !== word.toLowerCase()) {
        result.word = word
      }
      return result
    }, '补全单词信息失败')
  }
}
