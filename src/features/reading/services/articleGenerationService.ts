// 每日文章生成服务
// 优先从本地 Dexie 查询；未命中则调用 AI 生成并写回本地；AI 异常时使用兜底素材库
//
// - AI 生成后基于「标题+正文」计算 contentHash（SHA-256 前 16 位）
// - 查询历史文章是否已存在相同 contentHash，命中则重试（最多 3 次）
// - 3 次仍重复则返回最新一篇历史文章，避免用户看到重复内容
//
// 阅读查询与阅读状态写入见 ./articleReadService。
import { aiProvider } from '@/shared/services/ai'
import { articleRepository } from '@/shared/services'
import type { Article, Difficulty, Topic } from '@/shared/types'
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
