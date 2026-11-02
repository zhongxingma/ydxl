// 划词查词辅助服务
//
// 4 级缓存查词策略（按优先级顺序查询，任一 Tier 失败时降级到下一 Tier）：
//   1. LOCAL_DICT：内置高频词字典（20 词），零网络/存储开销，命中直接返回
//   2. wordRepository（生词本）：按 word 索引查询本地 Dexie 缓存（whereEquals），
//      已加入生词本的词直接复用其 phonetic/pos/definition/example 字段
//   3. responseCache：AI enrichment 结果的二级缓存（内存 LRU + localStorage），
//      scenario='wordLookup'，TTL 30 天；与供应商无关（model='local'）
//   4. aiProvider.enrichSingleWord：调用 AI 补全音标/词性/释义/例句，
//      成功后写入 responseCache 供下次命中（best-effort，写入失败不影响返回）
//
// 容错策略：Tier 2-4 任一失败时 try/catch 降级到下一 Tier；
//   全部失败时返回空字段（phonetic/pos/definition 为空字符串），保持 UI 兼容
//
// 后续如需更完整的查词能力，可接入专业字典 API（如有道词典 / 必应词典 / 本地 ECDICT 数据库）
// 替换 Tier 1 实现，或作为新的 Tier 0 注入
import { logger } from '../../../shared/utils/logger'
import { wordRepository } from '@/shared/services'
import { aiProvider } from '@/shared/services/ai'
import {
  computeCacheKey,
  getCached,
  setCached,
} from '@/shared/services/ai/responseCache'
import type { WordLookup } from '../types'

// 本地内置高频词字典（占位实现，仅用于演示划词交互流程）
// 后续接入正式字典 API 后可移除
const LOCAL_DICT: Record<string, WordLookup> = {
  apple: { word: 'apple', phonetic: '/ˈæpl/', pos: 'n.', definition: '苹果' },
  happy: { word: 'happy', phonetic: '/ˈhæpi/', pos: 'adj.', definition: '快乐的；幸福的' },
  river: { word: 'river', phonetic: '/ˈrɪvər/', pos: 'n.', definition: '河；江' },
  school: { word: 'school', phonetic: '/ˈskuːl/', pos: 'n.', definition: '学校' },
  friend: { word: 'friend', phonetic: '/frend/', pos: 'n.', definition: '朋友' },
  family: { word: 'family', phonetic: '/ˈfæməli/', pos: 'n.', definition: '家庭' },
  heart: { word: 'heart', phonetic: '/hɑːrt/', pos: 'n.', definition: '心；心脏' },
  water: { word: 'water', phonetic: '/ˈwɔːtər/', pos: 'n.', definition: '水' },
  star: { word: 'star', phonetic: '/stɑːr/', pos: 'n.', definition: '星；恒星' },
  book: { word: 'book', phonetic: '/bʊk/', pos: 'n.', definition: '书；本子' },
  morning: { word: 'morning', phonetic: '/ˈmɔːrnɪŋ/', pos: 'n.', definition: '早晨；上午' },
  father: { word: 'father', phonetic: '/ˈfɑːðər/', pos: 'n.', definition: '父亲' },
  mother: { word: 'mother', phonetic: '/ˈmʌðər/', pos: 'n.', definition: '母亲' },
  student: { word: 'student', phonetic: '/ˈstuːdnt/', pos: 'n.', definition: '学生' },
  teacher: { word: 'teacher', phonetic: '/ˈtiːtʃər/', pos: 'n.', definition: '老师' },
  learn: { word: 'learn', phonetic: '/lɜːrn/', pos: 'v.', definition: '学习；学会' },
  read: { word: 'read', phonetic: '/riːd/', pos: 'v.', definition: '读；阅读' },
  write: { word: 'write', phonetic: '/raɪt/', pos: 'v.', definition: '写；书写' },
  fish: { word: 'fish', phonetic: '/fɪʃ/', pos: 'n.', definition: '鱼' },
  tree: { word: 'tree', phonetic: '/triː/', pos: 'n.', definition: '树' },
}

// wordLookup 场景缓存：永久缓存
// 单词释义为稳定数据（音标/词性/释义/例句不会变化），可永久缓存
const WORD_LOOKUP_CACHE_TTL_MS = Infinity

/**
 * 计算 wordLookup 场景的 responseCache key
 * 使用 scenario='wordLookup' + model='local'（与 AI 供应商无关）+ sha256('' + word) 组合
 * model='local' 表示该缓存条目对所有 AI 供应商通用（单词释义不因供应商而异）
 *
 * @param word 已小写的单词文本
 * @returns 缓存 key 字符串（格式：wordLookup|local|<sha256>）
 */
export async function getWordLookupCacheKey(word: string): Promise<string> {
  // system='' / user=word：将单词作为 user message 内容参与哈希，保证同词同 key
  return computeCacheKey('wordLookup', 'local', '', word)
}

/**
 * 查询单词释义（4 级缓存策略）
 *
 * 查询顺序：
 *   Tier 1: LOCAL_DICT 内置字典（零开销）
 *   Tier 2: wordRepository 生词本本地索引查询（whereEquals('word', word)）
 *   Tier 3: responseCache 二级缓存（内存 LRU + localStorage）
 *   Tier 4: aiProvider.enrichSingleWord AI 补全，结果写回 responseCache
 *
 * 容错：Tier 2-4 任一失败时降级到下一 Tier；全部失败时返回空字段以保持 UI 兼容
 *
 * @param text 用户划选的文本（单词或短语）
 * @returns 查词结果；文本为空或非单个单词时返回 null
 */
export async function lookupWord(text: string): Promise<WordLookup | null> {
  // 清理首尾标点（防御性：上层 processSelection 已清理，此处兜底）
  const word = text.trim().toLowerCase().replace(/^[^\w]+|[^\w]+$/g, '')
  if (!word) return null

  // 仅处理单个单词（不含空格的纯字母串），短语暂返回 null
  if (!/^[a-z]+(?:[-'][a-z]+)?$/i.test(word)) {
    return null
  }

  // Tier 1: 命中本地字典直接返回（零开销）
  if (LOCAL_DICT[word]) {
    return LOCAL_DICT[word]
  }

  // Tier 2: 查询生词本（按 word 索引精确匹配，避免全表扫描）
  // word 已小写，命中后复用其字段；失败时降级到 Tier 3
  try {
    const hits = await wordRepository.whereEquals('word', word)
    if (hits.length > 0) {
      const hit = hits[0]
      return {
        word: hit.word,
        phonetic: hit.phonetic ?? '',
        pos: hit.pos ?? '',
        definition: hit.definition ?? '',
        example: hit.example ?? '',
      }
    }
  } catch (err) {
    if (import.meta.env.DEV)
      logger.warn('[wordLookup] Tier 2 wordbook 查询失败，降级到 Tier 3', err)
  }

  // Tier 3: 查询 responseCache（按 word 文本确定性 key，scenario='wordLookup'）
  // 命中时直接返回缓存的 WordLookup；失败时降级到 Tier 4
  try {
    const key = await getWordLookupCacheKey(word)
    const cached = await getCached<WordLookup>(key)
    if (cached) {
      return cached.value
    }
  } catch (err) {
    if (import.meta.env.DEV)
      logger.warn('[wordLookup] Tier 3 responseCache 读取失败，降级到 Tier 4', err)
  }

  // Tier 4: 调用 AI 补全音标/词性/释义/例句，并写入 responseCache 供下次命中
  // 失败时降级到空字段返回（保持 UI 兼容）
  try {
    const enriched = await aiProvider.enrichSingleWord(word)
    const lookup: WordLookup = {
      word: enriched.word,
      phonetic: enriched.phonetic ?? '',
      pos: enriched.pos ?? '',
      definition: enriched.definition ?? '',
      example: enriched.example ?? '',
    }
    // 写入 responseCache（best-effort：写入失败不影响本次返回，仅记录 dev 日志）
    try {
      const key = await getWordLookupCacheKey(word)
      await setCached(key, lookup, WORD_LOOKUP_CACHE_TTL_MS, 'wordLookup')
    } catch (cacheErr) {
      if (import.meta.env.DEV)
        logger.warn('[wordLookup] 写入 responseCache 失败', cacheErr)
    }
    return lookup
  } catch (err) {
    if (import.meta.env.DEV)
      logger.warn('[wordLookup] Tier 4 AI enrichment 失败，返回空字段', err)
  }

  // 全部 Tier 失败：返回空字段以保持 UI 兼容
  // 下游 enrichIfMissing 逻辑（addToWordbook）会识别空字段并在加入生词本时触发 AI 补全
  return {
    word,
    phonetic: '',
    pos: '',
    definition: '',
  }
}
