// 每日文章服务
// 优先从本地 Dexie 查询；未命中则调用 AI 生成并写回本地；AI 异常时使用兜底素材库
//
// - AI 生成后基于「标题+正文」计算 contentHash（SHA-256 前 16 位）
// - 查询历史文章是否已存在相同 contentHash，命中则重试（最多 3 次）
// - 3 次仍重复则返回最新一篇历史文章，避免用户看到重复内容
import { aiProvider } from '@/shared/services/ai'
import { articleRepository } from '@/shared/services'
import type { Article, ArticlePhrase, Difficulty, Topic } from '@/shared/types'
import { computeContentHash } from '@/shared/utils/contentHash'
import {
  pickRandomFallbackArticle,
  getAllFallbackArticles,
  type FallbackArticle,
} from '../data/fallback-articles'
import { buildVocabularyFromHighlighted } from './vocabularyService'

// getDailyArticle 选项：可指定题材与难度
export interface GetDailyArticleOptions {
  topic?: Topic
  difficulty?: Difficulty
  // true 时跳过本地缓存，强制生成新文章（用于完成阅读后再次进入获取新文章）
  forceNew?: boolean
}

// 仅包含首页「最近阅读」区块展示所需的字段，排除 content/translation 等大字段
export interface RecentlyReadArticle {
  id: string
  title: string
  readAt: number
  topic?: Topic
  difficulty?: Difficulty
  wordCount: number
}

/**
 * 文章未找到错误
 * 用于 getArticleById 在文章不存在（服务器 404 或本地缓存未命中）时抛出，
 * 便于 UI 层捕获后展示友好提示（如「文章不存在或已被删除」）
 */
export class ArticleNotFoundError extends Error {
  constructor(articleId: string) {
    super(`文章 ${articleId} 不存在`)
    this.name = 'ArticleNotFoundError'
    // 修复 TS 编译为 ES5 时 Error 子类原型链丢失的问题
    Object.setPrototypeOf(this, ArticleNotFoundError.prototype)
  }
}

// 去重最大重试次数
const MAX_DEDUP_RETRIES = 3

/**
 * 标题规范化：小写并去除所有非字母数字字符
 * 用于标题维度的去重比对——AI 生成的同主题文章标题常仅大小写或标点不同
 * （如 "A Rainy Day" vs "a rainy day!"），规范化后相同即视为重复文章
 */
export function normalizeTitleForDedupe(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9]/g, '')
}

// generateArticle 内部参数
interface GenerateParams {
  date: string
  topic?: Topic
  difficulty?: Difficulty
  // true 时使用复合 id（`${date}-${Date.now()}`），避免覆盖原 date 文章
  forceNew?: boolean
}

/**
 * 查询历史文章中是否已存在重复文章（contentHash 精确匹配 + 标题规范化匹配）
 *
 * 去重维度（与本地所有文章比对）：
 * 1. contentHash 精确匹配：标题+正文 SHA-256 指纹完全一致
 * 2. 标题规范化匹配：小写去标点后标题相同即视为重复——AI 生成同主题文章时
 *    标题常仅大小写或标点不同，仅靠 contentHash 会漏判（2026-08-30 增强）
 *
 * 优化：contentHash 优先查询本地 Dexie 缓存（whereEquals 走本地索引），命中时直接返回；
 * 未命中或本地查询失败时降级到 getAllLocalFirst() 拉取全量数据（同步写回本地缓存），
 * 在同一次全量比对中同时完成标题规范化匹配。
 * 全部失败时返回 undefined（best-effort 去重，离线或服务器异常时不阻塞文章生成）
 *
 * @param hash 文章内容的 SHA-256 指纹
 * @param title 文章标题（用于规范化比对，空标题跳过标题维度）
 * @returns 命中的重复文章或 undefined
 */
async function findDuplicateArticle(hash: string, title: string): Promise<Article | undefined> {
  // 快速路径：查询本地缓存索引（whereEquals 走 Dexie 本地索引，不发起 HTTP）
  // 本地查询失败时降级到 getAll（不中断流程）
  try {
    const cached = await articleRepository.whereEquals('contentHash', hash)
    if (cached.length > 0) {
      return cached[0]
    }
  } catch (localErr) {
    // 本地索引查询失败（如 Dexie 未初始化），降级到服务器全量查询
    if (import.meta.env.DEV)
      console.warn('[articleService] 本地 contentHash 索引查询失败，降级到 getAll', localErr)
  }
  // 慢速路径：本地未命中或失败，拉取服务器全量数据（同步写回本地缓存）
  // 注：此路径在全量数据较大时会有性能开销，但确保去重准确性
  // 使用 getAllLocalFirst：本地有缓存时立即返回（避免阻塞 AI 生成流程），后台静默刷新
  try {
    const all = await articleRepository.getAllLocalFirst()
    // 标题规范化比对（空标题跳过，避免空标题文章互相误判）
    const normalizedTitle = normalizeTitleForDedupe(title)
    if (normalizedTitle) {
      const byTitle = all.find(
        (a) => a.title && normalizeTitleForDedupe(a.title) === normalizedTitle,
      )
      if (byTitle) return byTitle
    }
    return all.find((a) => a.contentHash === hash)
  } catch (err) {
    // 服务器查询也失败时跳过去重检查，不阻塞生成流程
    if (import.meta.env.DEV)
      console.warn('[articleService] 按 contentHash 查询失败，跳过去重', err)
    return undefined
  }
}

/**
 * 兜底素材库挑选结果：
 * - fresh / random：返回一篇兜底文章（由调用方保存）
 *   - fresh：与本地已有文章比对后选出的未保存篇目
 *   - random：本地文章查询失败时的降级随机选择（与旧行为一致）
 * - reuse：本地已保存且未读的兜底文章，直接复用避免重复保存
 * - exhausted：兜底文章全部已保存且已读，调用方回退最新历史文章
 */
type FallbackPickResult =
  | { kind: 'fresh' | 'random'; fallback: FallbackArticle }
  | { kind: 'reuse'; article: Article }
  | { kind: 'exhausted' }

/**
 * 从兜底素材库挑选一篇不与本地已有文章重复的文章
 * 与本地所有文章按 contentHash 全量比对（2026-08-30 新增：
 * 旧逻辑随机抽取直接保存，AI 多次失败时可能反复保存/展示同一篇兜底文章）
 *
 * 策略：
 * 1. 本地文章查询失败 → 降级纯随机（best-effort，不阻塞阅读）
 * 2. 存在未保存过的兜底篇目 → 随机返回其中一篇（kind: fresh）
 * 3. 全部兜底篇目均已保存且存在未读的 → 直接复用该本地文章（kind: reuse，不重复保存）
 * 4. 全部兜底篇目均已保存且已读 → exhausted（调用方回退最新历史文章）
 */
async function pickFallbackArticle(): Promise<FallbackPickResult> {
  let localArticles: Article[]
  try {
    localArticles = await articleRepository.getAllLocalFirst()
  } catch (err) {
    console.warn('[articleService] 查询本地文章失败，兜底素材库跳过去重', err)
    return { kind: 'random', fallback: pickRandomFallbackArticle() }
  }
  // 计算全部兜底文章的 contentHash（与 saveArticle 相同规则：标题+正文）
  const fallbackHashes = new Map<string, FallbackArticle>()
  for (const f of getAllFallbackArticles()) {
    fallbackHashes.set(await computeContentHash(f.title, f.content), f)
  }
  const localHashes = new Set(
    localArticles.map((a) => a.contentHash).filter((h): h is string => Boolean(h)),
  )
  // 未保存过的兜底篇目
  const freshHashes = Array.from(fallbackHashes.keys()).filter((h) => !localHashes.has(h))
  if (freshHashes.length > 0) {
    const pickedHash = freshHashes[Math.floor(Math.random() * freshHashes.length)]!
    return { kind: 'fresh', fallback: fallbackHashes.get(pickedHash)! }
  }
  // 全部兜底篇目均已保存：优先复用未读的本地兜底文章
  const unreadLocal = localArticles.filter(
    (a) => a.contentHash != null && fallbackHashes.has(a.contentHash) && a.readAt == null,
  )
  if (unreadLocal.length > 0) {
    return { kind: 'reuse', article: unreadLocal[0] }
  }
  return { kind: 'exhausted' }
}

/**
 * 获取最新一篇历史文章（按 createdAt 倒序）
 * 无历史文章时抛错，由上层降级到兜底素材库
 */
async function getLatestArticle(): Promise<Article> {
  // 使用 getAllLocalFirst：本地有缓存时立即返回（兜底场景不阻塞），后台静默刷新
  const all = await articleRepository.getAllLocalFirst()
  if (all.length === 0) {
    throw new Error('无历史文章可回退')
  }
  return all.sort((a, b) => b.createdAt - a.createdAt)[0]
}

/**
 * 保存文章到 articleRepository
 * 若文章缺少 contentHash 则重新计算并写入
 *
 * @param article 文章对象
 * @returns 写入后的 Article 实体（含 contentHash）
 * @throws 当 articleRepository.add 写入失败时抛出
 */
export async function saveArticle(article: Article): Promise<Article> {
  // 确保 contentHash 存在
  if (!article.contentHash) {
    const contentHash = await computeContentHash(article.title, article.content)
    return await articleRepository.add({ ...article, contentHash })
  }
  return await articleRepository.add(article)
}

/**
 * 按 createdAt 倒序取最近 limit 篇文章的 topic，过滤掉空值
 * 查询失败时返回空数组（best-effort，不阻塞生成流程）
 *
 * @param limit 返回条数上限，默认 10
 * @returns 主题字符串数组，查询失败时返回空数组
 */
export async function getRecentTopics(limit: number = 10): Promise<string[]> {
  try {
    // 使用 getAllLocalFirst：本地有缓存时立即返回，后台静默刷新
    const articles = await articleRepository.getAllLocalFirst()
    return articles
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, limit)
      .map((a) => a.topic)
      .filter((t): t is Topic => typeof t === 'string' && t.length > 0)
  } catch (err) {
    // 查询失败时跳过主题注入，不阻塞生成流程
    if (import.meta.env.DEV)
      console.warn('[articleService] 查询最近主题失败，跳过主题注入', err)
    return []
  }
}

/**
 * 生成文章（含 contentHash + 标题双重去重 + 历史主题注入）
 *   Phase 3 优化（2026-07-27）：10 → 5，节省约 50 token/次（每个 topic 约 10 token）
 * - 调用 AI 生成文章，计算 contentHash
 * - 与本地所有历史文章比对：contentHash 精确匹配 + 标题规范化匹配
 * - 命中重复则重试，最多 MAX_DEDUP_RETRIES 次
 * - 3 次仍重复则返回最新一篇历史文章，避免用户看到重复内容
 * - forceNew 为 true 时使用复合 id（`${date}-${Date.now()}`），避免覆盖原 date 文章
 *
 * @param params 生成参数：date 文章主键日期、topic 题材、difficulty 难度、forceNew 强制新文章
 * @returns 生成的 Article 对象；3 次去重仍重复时返回最新历史文章
 * @throws 当 AI 调用失败且无历史文章可回退时抛出
 */
export async function generateArticle(params: GenerateParams): Promise<Article> {
  // Phase 3 优化：10 → 5，节省约 50 token/次
  const avoidTopics = await getRecentTopics(5)
  for (let attempt = 0; attempt < MAX_DEDUP_RETRIES; attempt++) {
    const result = await aiProvider.generateArticle(
      params.date,
      undefined,
      params.topic,
      params.difficulty,
      avoidTopics,
    )
    const contentHash = await computeContentHash(result.title, result.content)
    const existing = await findDuplicateArticle(contentHash, result.title)
    if (!existing) {
      // 不重复，构造 Article 并保存
      const now = Date.now()
      // forceNew 为 true 时使用复合 id，避免覆盖原 date 文章
      const articleId = params.forceNew ? `${params.date}-${now}` : params.date
      const article: Article = {
        id: articleId,
        title: result.title,
        content: result.content,
        translation: result.translation,
        genre: result.genre,
        wordCount: result.wordCount,
        createdAt: now,
        updated_at: now,
        // 将 AI 返回的题材/难度/蓝思值/高亮生词/重点短语一并写入
        // 重点词汇同步写入基础版（由高亮生词转换，与重点短语同一时机持久化），
        // 保证读完文章后词汇汇总页立即有数据；阅读页首次打开时再由 AI 增强升级
        topic: result.topic,
        difficulty: result.difficulty,
        lexileRange: result.lexileRange,
        highlightedWords: result.highlightedWords,
        phrases: result.phrases,
        vocabulary: buildVocabularyFromHighlighted(result.highlightedWords),
        contentHash,
        readAt: null,
      }
      return await saveArticle(article)
    }
    // 命中重复，重试（avoidTopics 已在循环外查询并注入）
  }
  // 3 次仍重复，返回最新一篇历史文章
  console.warn('[articleService] 连续 3 次生成重复文章，回退到最新历史文章')
  return await getLatestArticle()
}

/**
 * 获取指定日期的阅读文章
 * 1. 优先从本地 articleRepository 查询（命中则直接返回）
 *    - options.forceNew 为 true 时跳过缓存，强制生成新文章
 * 2. 未命中则调用 generateArticle 生成（含 contentHash 去重）并写入本地
 *    - 支持传入 topic/difficulty 选项，由 AI 按指定题材与难度生成
 *    - forceNew 为 true 时生成文章使用复合 id（`${date}-${Date.now()}`），避免覆盖原 date 文章
 *    - 连续 3 次生成重复时自动回退到最新历史文章
 * 3. AI 异常或写入失败时从兜底素材库挑选一篇（与本地所有文章按 contentHash 去重：
 *    优先未保存篇目；全部已保存时复用未读的本地兜底文章；全部已读时回退最新历史文章）
 *
 * @param date 日期字符串 YYYY-MM-DD，作为文章主键
 * @param options 可选参数：题材 topic / 难度 difficulty / forceNew 强制生成新文章
 * @returns 文章对象；命中缓存/AI 生成/兜底素材库均会返回
 */
export async function getDailyArticle(
  date: string,
  options?: GetDailyArticleOptions,
): Promise<Article> {
  // 1. 本地命中（forceNew 为 true 时跳过缓存，强制生成新文章）
  //    使用 getByIdLocalFirst：本地缓存命中时立即返回（不阻塞 UI），后台静默刷新该条
  let cached: Article | undefined
  if (!options?.forceNew) {
    cached = await articleRepository.getByIdLocalFirst(date)
    // 缓存命中且未读：直接返回；已读则触发重新生成
    if (cached && cached.readAt == null) {
      return cached
    }
  }

  // 防覆盖守卫（2026-08-29 修复「文章与练习题/词汇不对应」）：
  // 同 id 文章已存在（已读）时，即使调用方未传 forceNew 也必须使用复合 id。
  // 否则新文章会经 saveArticle → local.put 覆盖同 id 旧文，而本地练习题
  // （questionRepository 按 articleId 存）与词汇缓存（ydxl-vocab-*）仍指向旧文内容，
  // 导致用户看到「练习题/单词来自别的文章」。
  const useCompositeId = Boolean(options?.forceNew || cached)

  // 2. 尝试 AI 生成（按 options 传入 topic/difficulty，含去重）
  try {
    return await generateArticle({
      date,
      topic: options?.topic,
      difficulty: options?.difficulty,
      forceNew: useCompositeId,
    })
  } catch (err) {
    // 不抛出错误，记录日志后降级到兜底素材库
    console.warn('[articleService] AI 生成文章失败，降级使用兜底素材库', err)
  }

  // 3. 兜底素材库（同样遵守防覆盖守卫：同 id 已存在时使用复合 id；
  //    且与本地所有文章按 contentHash 去重，避免重复保存/展示同一篇兜底文章）
  const fallbackPick = await pickFallbackArticle()
  if (fallbackPick.kind === 'reuse') {
    // 兜底篇目全部已保存且存在未读的 → 直接复用本地文章，不重复保存
    return fallbackPick.article
  }
  if (fallbackPick.kind === 'exhausted') {
    // 兜底篇目全部已保存且已读 → 回退最新历史文章（与 AI 去重重试耗尽行为一致）
    console.warn('[articleService] 兜底素材库全部已读，回退到最新历史文章')
    return await getLatestArticle()
  }
  const fallback = fallbackPick.fallback
  const now = Date.now()
  const fallbackArticle: Article = {
    id: useCompositeId ? `${date}-${now}` : date,
    title: fallback.title,
    content: fallback.content,
    translation: fallback.translation,
    genre: fallback.genre,
    wordCount: fallback.wordCount,
    createdAt: now,
    updated_at: now,
    // 兜底素材库同样包含 topic/difficulty/lexileRange/highlightedWords/phrases 字段
    // 重点词汇同步写入基础版（由高亮生词转换，与重点短语同一时机持久化）
    topic: fallback.topic,
    difficulty: fallback.difficulty,
    lexileRange: fallback.lexileRange,
    highlightedWords: fallback.highlightedWords,
    phrases: fallback.phrases,
    vocabulary: buildVocabularyFromHighlighted(fallback.highlightedWords),
  }
  // 兜底文章也写入本地，避免下次仍走兜底（标记 createdAt 为今日）
  // 返回 saveArticle 的结果（含计算后的 contentHash），避免返回缺少指纹的本地变量
  try {
    return await saveArticle(fallbackArticle)
  } catch (err) {
    // 写入失败也不影响返回，仅记录日志
    console.warn('[articleService] 兜底文章写入本地失败', err)
  }
  return fallbackArticle
}

/**
 * 标记文章为已读（更新 readAt 时间戳）
 * best-effort：标记失败不影响阅读主流程
 *
 * @param articleId 文章主键
 * @returns 是否成功写入（失败时调用方可提示用户）
 */
export async function markAsRead(articleId: string): Promise<boolean> {
  try {
    // 依赖 CachedRemoteRepository.update 的 404 兜底逻辑：
    // 远程 404 时已降级写入本地缓存并返回 fallback 对象，不抛错
    // 此处 catch 仅处理 500/网络错误等非 404 异常
    await articleRepository.update(articleId, { readAt: Date.now() })
    return true
  } catch (err) {
    // 服务器异常时标记失败不影响主流程（best-effort）
    console.warn('[articleService] markAsRead 失败', err)
    return false
  }
}

/**
 * 记录用户开始阅读文章（更新 startedAt 时间戳）
 * best-effort：标记失败不影响阅读主流程
 * 与 markAsRead 区别：markAsRead 标记阅读完成，recordReadingStart 标记开始阅读
 *
 * @param articleId 文章主键
 * @returns 是否成功写入
 */
export async function recordReadingStart(articleId: string): Promise<boolean> {
  try {
    // 依赖 CachedRemoteRepository.update 的 404 兜底逻辑：
    // 远程 404 时已降级写入本地缓存并返回 fallback 对象，不抛错
    // 此处 catch 仅处理 500/网络错误等非 404 异常
    await articleRepository.update(articleId, { startedAt: Date.now() })
    return true
  } catch (err) {
    // 服务器异常时标记失败不影响主流程（best-effort）
    console.warn('[articleService] recordReadingStart 失败', err)
    return false
  }
}

/**
 * 获取阅读历史文章（已读完或已开始阅读的）
 * 过滤条件：readAt != null || startedAt != null
 * 排序规则：按 readAt ?? startedAt ?? createdAt 倒序
 * 分页：slice(offset, offset + limit)
 *
 * @param limit 返回条数上限，默认 50
 * @param offset 起始偏移量，默认 0
 * @returns 历史文章数组；查询失败时返回空数组
 */
export async function getReadHistory(limit: number = 50, offset: number = 0): Promise<Article[]> {
  // 使用 getAllLocalFirst：本地有缓存时立即返回，后台静默刷新
  const all = await articleRepository.getAllLocalFirst()
  return all
    .filter((a) => a.readAt != null || a.startedAt != null)
    .sort((a, b) => {
      const aTime = a.readAt ?? a.startedAt ?? a.createdAt
      const bTime = b.readAt ?? b.startedAt ?? b.createdAt
      return bTime - aTime
    })
    .slice(offset, offset + limit)
}

/**
 * 用于首页「最近阅读」快捷区块展示。
 * 查询条件：readAt != null（仅已读完的文章）
 * 排序规则：按 readAt 降序（最近阅读的在前）
 * 返回精简字段：id, title, readAt, topic, difficulty, wordCount
 * 排除 content/translation/highlightedWords 等大字段，减少传输与渲染开销
 *
 * @param limit 返回条数上限
 * @returns 精简字段文章数组，按 readAt 降序；查询失败时返回空数组
 * @throws 内部捕获异常，不会向外抛出（best-effort，不阻塞首页加载）
 */
export async function getRecentlyReadArticles(
  limit: number,
): Promise<RecentlyReadArticle[]> {
  try {
    // 使用 getAllLocalFirst：本地有缓存时立即返回，后台静默刷新
    const all = await articleRepository.getAllLocalFirst()
    return all
      .filter((a): a is Article & { readAt: number } => a.readAt != null)
      .sort((a, b) => b.readAt - a.readAt)
      .slice(0, limit)
      .map((a) => ({
        id: a.id,
        title: a.title,
        readAt: a.readAt,
        topic: a.topic,
        difficulty: a.difficulty,
        wordCount: a.wordCount,
      }))
  } catch (err) {
    // 查询失败时返回空数组，不阻塞首页加载
    if (import.meta.env.DEV)
      console.warn('[articleService] getRecentlyReadArticles 查询失败', err)
    return []
  }
}

/**
 * 查询今日已读文章数
 * 过滤条件：readAt 不为 null 且在今日 0:00:00-23:59:59 之间
 * 使用 articleRepository.getAllLocalFirst() 过滤（本地优先，数据量不大可接受）
 *
 * @returns 今日已读文章数；查询失败时返回 0
 */
export async function getTodayReadCount(): Promise<number> {
  try {
    // 使用 getAllLocalFirst：本地有缓存时立即返回，后台静默刷新
    const all = await articleRepository.getAllLocalFirst()
    const todayStart = new Date()
    todayStart.setHours(0, 0, 0, 0)
    const todayEnd = new Date()
    todayEnd.setHours(23, 59, 59, 999)
    const startMs = todayStart.getTime()
    const endMs = todayEnd.getTime()
    return all.filter((a) => a.readAt != null && a.readAt >= startMs && a.readAt <= endMs).length
  } catch (err) {
    console.warn('[articleService] getTodayReadCount 查询失败', err)
    return 0
  }
}

/**
 * 根据 id 获取文章（本地优先，离线可用）
 *
 * 实现说明：
 * - 调用 articleRepository.getByIdLocalFirst(id)（SWR 模式）：
 *   - 本地缓存命中时立即返回，后台异步刷新该条记录
 *   - 本地未命中时同步等待远程拉取，写入本地后返回
 * - 服务器 404 时 localApi.getById 内部已转换为 undefined 返回；
 *   getByIdLocalFirst 在本地未命中且远程返回 undefined 时返回 undefined
 * - 本方法将 undefined 统一转换为 ArticleNotFoundError 抛出，便于 UI 层友好提示
 * - 其他非 404 错误（如 500、网络错误且本地缓存查询也失败）向上抛出，不静默吞错
 *
 * @param id 文章 id
 * @returns 完整 Article 对象（含 content/translation/highlightedWords/phrases 等字段）
 * @throws {ArticleNotFoundError} 当文章不存在（服务器 404 或本地缓存未命中）时抛出
 * @throws {Error} 当服务器不可用且本地缓存查询失败等非 404 异常时抛出
 */
export async function getArticleById(id: string): Promise<Article> {
  let article: Article | undefined
  try {
    article = await articleRepository.getByIdLocalFirst(id)
  } catch (err) {
    // 服务器 404 错误（CachedRemoteRepository 回退本地时一般不会抛 404，
    // 此处兜底处理 localApi 层未被转换的 404 异常）
    if (err instanceof Error && err.message.includes('404')) {
      throw new ArticleNotFoundError(id)
    }
    // 非 404 错误（500/网络错误等）向上抛出，不静默吞错
    throw err
  }
  if (!article) {
    throw new ArticleNotFoundError(id)
  }
  return article
}

/**
 * 确保文章有重点短语：已有则直接返回，缺失则调用 AI 提取并写回
 *
 * 用于历史文章（功能上线前生成，article.phrases 为 undefined）的短语补全。
 * 提取后写回 articleRepository 持久化，下次打开不再调用 AI。
 *
 * @param article 文章实体
 * @returns 短语数组（可能为空，表示提取失败或文章无合适短语）
 */
export async function ensureArticlePhrases(article: Article): Promise<ArticlePhrase[]> {
  // 已有短语直接返回
  if (article.phrases && article.phrases.length > 0) {
    return article.phrases
  }
  try {
    const phrases = await aiProvider.extractArticlePhrases(article.content)
    // 写回 articleRepository 持久化（best-effort，失败不阻塞）
    if (phrases.length > 0) {
      try {
        await articleRepository.update(article.id, { phrases })
      } catch (writeErr) {
        console.warn('[articleService] 短语写回失败，仅返回不持久化', writeErr)
      }
    }
    return phrases
  } catch (err) {
    console.warn('[articleService] 文章短语提取失败，静默降级', err)
    return []
  }
}

export const articleService = {
  getDailyArticle,
  generateArticle,
  saveArticle,
  markAsRead,
  recordReadingStart,
  getReadHistory,
  getRecentlyReadArticles,
  getTodayReadCount,
  getArticleById,
  ensureArticlePhrases,
}
