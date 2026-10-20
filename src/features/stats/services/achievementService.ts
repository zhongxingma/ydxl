// 成就徽章服务
// 职责：
// 1. 定义成就规则（id / 名称 / 描述 / icon / 判定函数）
// 2. 提供 checkAndUnlockAchievements：基于上下文检查并解锁新成就，返回本次新解锁列表
// 3. 提供 getUnlockedAchievements / isAchievementUnlocked 查询能力
//
// 设计说明：
// - 规则与判定逻辑集中在本文件，便于扩展
// - checkAndUnlockAchievements 幂等：已解锁的规则不会重复解锁
// - 解锁写入失败不抛出，仅记录日志，避免影响主流程
import { achievementRepository } from '@/shared/services'
import type { Achievement } from '@/shared/types'

// 成就上下文：由 statsService.buildAchievementContext 构造
export interface AchievementContext {
  // 当日阅读篇数
  todayReadCount: number
  // 当日复习单词数
  todayReviewCount: number
  // 当日全对次数（单篇全对）
  todayPerfectCount: number
  // 连续打卡天数
  streakDays: number
  // 总阅读篇数
  totalReadCount: number
  // 总掌握单词数
  totalMasteredWords: number
}

// 成就规则定义
export interface AchievementRule {
  id: string
  name: string
  description: string
  icon: string // emoji 字符
  // 判定函数：返回 true 表示满足解锁条件
  check: (context: AchievementContext) => Promise<boolean> | boolean
}

// 成就规则集合：按"易→难"排序，便于 UI 顺序展示
// 1. 阅读之星 I：当日阅读 ≥ 1 篇
// 2. 阅读之星 II：当日阅读 ≥ 2 篇
// 3. 全对王者：当日单篇全对 ≥ 1 次
// 4. 七日坚持：连续打卡 7 天
// 5. 三十日坚守：连续打卡 30 天
// 6. 单词达人：累计掌握 50 词
// 7. 单词大师：累计掌握 200 词
export const ACHIEVEMENT_RULES: AchievementRule[] = [
  {
    id: 'reading-star-1',
    name: '阅读之星 I',
    description: '当日完成 1 篇阅读',
    icon: '⭐',
    check: (ctx) => ctx.todayReadCount >= 1,
  },
  {
    id: 'reading-star-2',
    name: '阅读之星 II',
    description: '当日完成 2 篇阅读',
    icon: '🌟',
    check: (ctx) => ctx.todayReadCount >= 2,
  },
  {
    id: 'perfect-king',
    name: '全对王者',
    description: '当日单篇全对 1 次',
    icon: '🏆',
    check: (ctx) => ctx.todayPerfectCount >= 1,
  },
  {
    id: 'streak-7',
    name: '七日坚持',
    description: '连续打卡 7 天',
    icon: '🔥',
    check: (ctx) => ctx.streakDays >= 7,
  },
  {
    id: 'streak-30',
    name: '三十日坚守',
    description: '连续打卡 30 天',
    icon: '💎',
    check: (ctx) => ctx.streakDays >= 30,
  },
  {
    id: 'word-master-50',
    name: '单词达人',
    description: '累计掌握 50 词',
    icon: '📚',
    check: (ctx) => ctx.totalMasteredWords >= 50,
  },
  {
    id: 'word-master-200',
    name: '单词大师',
    description: '累计掌握 200 词',
    icon: '🎓',
    check: (ctx) => ctx.totalMasteredWords >= 200,
  },
]

/**
 * 检查并解锁成就
 * 1. 读取已解锁成就列表
 * 2. 对每条规则：若未解锁且 check 通过，则解锁
 * 3. 解锁时写入 achievementRepository
 * 4. 返回本次新解锁的列表
 *
 * @param context 成就上下文（由 statsService.buildAchievementContext 构造）
 * @returns 本次新解锁的成就列表（按解锁时间升序）
 */
export async function checkAndUnlockAchievements(
  context: AchievementContext
): Promise<Achievement[]> {
  const unlockedList = await achievementRepository.getAll()
  const unlockedIds = new Set(unlockedList.map((a) => a.id))

  const newlyUnlocked: Achievement[] = []
  for (const rule of ACHIEVEMENT_RULES) {
    // 已解锁则跳过
    if (unlockedIds.has(rule.id)) continue

    let passed = false
    try {
      passed = await rule.check(context)
    } catch (err) {
      // 单条规则判定失败不影响其他规则
      console.warn(`[achievementService] 规则 ${rule.id} 判定异常`, err)
      continue
    }
    if (!passed) continue

    const now = Date.now()
    const achievement: Achievement = {
      id: rule.id,
      name: rule.name,
      description: rule.description,
      icon: rule.icon,
      unlockedAt: now,
      updated_at: now,
    }

    try {
      await achievementRepository.add(achievement)
      newlyUnlocked.push(achievement)
    } catch (err) {
      // 写入失败不抛出，仅记录日志，避免影响主流程
      console.warn(`[achievementService] 成就 ${rule.id} 写入失败`, err)
    }
  }

  return newlyUnlocked
}

/**
 * 读取已解锁成就列表，按 unlockedAt 降序（最新解锁在前）
 */
export async function getUnlockedAchievements(): Promise<Achievement[]> {
  const all = await achievementRepository.getAll()
  return all.sort((a, b) => b.unlockedAt - a.unlockedAt)
}

/**
 * 判断指定成就是否已解锁
 */
export async function isAchievementUnlocked(id: string): Promise<boolean> {
  const achievement = await achievementRepository.getById(id)
  return !!achievement
}

export const achievementService = {
  checkAndUnlockAchievements,
  getUnlockedAchievements,
  isAchievementUnlocked,
}
