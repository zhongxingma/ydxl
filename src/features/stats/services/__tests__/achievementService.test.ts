// 成就规则判断逻辑单元测试
//
// 测试范围：
// - 当日阅读篇数触发阅读之星成就（reading-star-1 / reading-star-2）
// - 当日全对触发 perfect-king
// - 连续打卡 7 / 30 天触发 streak-7 / streak-30
// - 累计掌握 50 / 200 词触发 word-master-50 / word-master-200
// - 已解锁成就的幂等性
// - 单条规则判定异常不影响其他规则
//
// 已迁移到 vitest 风格（globals 模式）
// vitest.config.ts 中通过 define: { 'import.meta.env': '{}' } 注入空 env，
// supabase.ts 等模块访问 VITE_X 变量时返回 undefined（降级为未配置），无需 ESM loader 拦截
//
// Mock 策略：
// 1. import.meta.env 由 vitest.config.ts 的 define 替换为 {}（不读取 .env 文件）
// 2. 直接重写 achievementRepository 单例上的方法，使用内存数组作为存储，不依赖 Dexie / IndexedDB
// 3. 业务代码采用静态 import 加载（vitest 已处理 import.meta.env polyfill）

import type { AchievementContext } from '../achievementService'
import type { Achievement } from '@/shared/types'
import {
  ACHIEVEMENT_RULES,
  checkAndUnlockAchievements,
  getUnlockedAchievements,
  isAchievementUnlocked,
} from '../achievementService'
import { achievementRepository } from '@/shared/services'

// ---------- achievementRepository 内存 Mock ----------

// 内存存储：模拟 achievements 表
let mockStore: Achievement[] = []

// 保存原始方法引用，便于恢复
const originalGetAll = achievementRepository.getAll
const originalGetById = achievementRepository.getById
const originalAdd = achievementRepository.add

// 安装 mock：重写 achievementRepository 上的方法
function installMock(initial: Achievement[] = []): void {
  mockStore = [...initial]
  achievementRepository.getAll = async () => [...mockStore]
  achievementRepository.getById = async (id: string) =>
    mockStore.find((a) => a.id === id)
  achievementRepository.add = async (entity) => {
    const item = { ...entity, updated_at: Date.now() } as Achievement
    mockStore.push(item)
    return item
  }
}

// 恢复原始方法
function restoreMock(): void {
  achievementRepository.getAll = originalGetAll
  achievementRepository.getById = originalGetById
  achievementRepository.add = originalAdd
}

// 构造默认的 AchievementContext（所有指标置 0，便于按需覆盖）
function makeContext(overrides: Partial<AchievementContext> = {}): AchievementContext {
  return {
    todayReadCount: 0,
    todayReviewCount: 0,
    todayPerfectCount: 0,
    streakDays: 0,
    totalReadCount: 0,
    totalMasteredWords: 0,
    ...overrides,
  }
}

// ---------- 主测试流程 ----------

describe('achievementService', () => {
  // 1. 当日阅读 1 篇 → 解锁 reading-star-1
  it('当日阅读 1 篇 → 解锁 reading-star-1', async () => {
    installMock()
    try {
      const ctx = makeContext({ todayReadCount: 1 })
      const unlocked = await checkAndUnlockAchievements(ctx)
      const ids = unlocked.map((a) => a.id)
      expect(ids.includes('reading-star-1')).toBe(true)
      expect(unlocked.length).toBe(1)
    } finally {
      restoreMock()
    }
  })

  // 2. 当日阅读 2 篇 → 解锁 reading-star-1 + reading-star-2
  it('当日阅读 2 篇 → 解锁 reading-star-1 与 reading-star-2', async () => {
    installMock()
    try {
      const ctx = makeContext({ todayReadCount: 2 })
      const unlocked = await checkAndUnlockAchievements(ctx)
      const ids = unlocked.map((a) => a.id)
      expect(ids.includes('reading-star-1')).toBe(true)
      expect(ids.includes('reading-star-2')).toBe(true)
      expect(unlocked.length).toBe(2)
    } finally {
      restoreMock()
    }
  })

  // 3. 当日全对 1 次 → 解锁 perfect-king
  it('当日全对 1 次 → 解锁 perfect-king', async () => {
    installMock()
    try {
      const ctx = makeContext({ todayPerfectCount: 1 })
      const unlocked = await checkAndUnlockAchievements(ctx)
      const ids = unlocked.map((a) => a.id)
      expect(ids.includes('perfect-king')).toBe(true)
      expect(unlocked.length).toBe(1)
    } finally {
      restoreMock()
    }
  })

  // 4. 连续打卡 7 天 → 解锁 streak-7
  it('连续打卡 7 天 → 解锁 streak-7', async () => {
    installMock()
    try {
      const ctx = makeContext({ streakDays: 7 })
      const unlocked = await checkAndUnlockAchievements(ctx)
      const ids = unlocked.map((a) => a.id)
      expect(ids.includes('streak-7')).toBe(true)
      expect(ids.includes('streak-30')).toBe(false)
    } finally {
      restoreMock()
    }
  })

  // 5. 连续打卡 30 天 → 解锁 streak-30（同时解锁 streak-7）
  it('连续打卡 30 天 → 解锁 streak-30（同时解锁 streak-7）', async () => {
    installMock()
    try {
      const ctx = makeContext({ streakDays: 30 })
      const unlocked = await checkAndUnlockAchievements(ctx)
      const ids = unlocked.map((a) => a.id)
      expect(ids.includes('streak-30')).toBe(true)
      expect(ids.includes('streak-7')).toBe(true)
    } finally {
      restoreMock()
    }
  })

  // 6. 累计掌握 50 词 → 解锁 word-master-50
  it('累计掌握 50 词 → 解锁 word-master-50', async () => {
    installMock()
    try {
      const ctx = makeContext({ totalMasteredWords: 50 })
      const unlocked = await checkAndUnlockAchievements(ctx)
      const ids = unlocked.map((a) => a.id)
      expect(ids.includes('word-master-50')).toBe(true)
      expect(ids.includes('word-master-200')).toBe(false)
    } finally {
      restoreMock()
    }
  })

  // 7. 累计掌握 200 词 → 解锁 word-master-200（同时解锁 word-master-50）
  it('累计掌握 200 词 → 解锁 word-master-200（同时解锁 word-master-50）', async () => {
    installMock()
    try {
      const ctx = makeContext({ totalMasteredWords: 200 })
      const unlocked = await checkAndUnlockAchievements(ctx)
      const ids = unlocked.map((a) => a.id)
      expect(ids.includes('word-master-200')).toBe(true)
      expect(ids.includes('word-master-50')).toBe(true)
    } finally {
      restoreMock()
    }
  })

  // 8. 已解锁的成就不重复解锁（幂等性）
  it('已解锁的成就不重复解锁（幂等性）', async () => {
    installMock()
    try {
      const ctx = makeContext({ todayReadCount: 1 })

      // 第一次调用：应解锁 reading-star-1
      const first = await checkAndUnlockAchievements(ctx)
      expect(first.length).toBe(1)
      expect(first[0].id).toBe('reading-star-1')

      // 第二次调用同样上下文：不应再次解锁
      const second = await checkAndUnlockAchievements(ctx)
      expect(second.length).toBe(0)

      // 验证存储中确实只有 1 条记录
      const all = await getUnlockedAchievements()
      expect(all.length).toBe(1)
    } finally {
      restoreMock()
    }
  })

  // 9. 单条规则判定失败不影响其他规则
  it('单条规则判定失败不影响其他规则', async () => {
    installMock()
    // 临时让 reading-star-1 的 check 抛异常
    const ruleIndex = ACHIEVEMENT_RULES.findIndex((r) => r.id === 'reading-star-1')
    expect(ruleIndex >= 0).toBe(true)
    const originalCheck = ACHIEVEMENT_RULES[ruleIndex].check
    ACHIEVEMENT_RULES[ruleIndex].check = () => {
      throw new Error('mock check error')
    }
    try {
      // 上下文满足 reading-star-1 与 reading-star-2
      const ctx = makeContext({ todayReadCount: 2 })
      const unlocked = await checkAndUnlockAchievements(ctx)
      const ids = unlocked.map((a) => a.id)
      // reading-star-1 因判定异常应被跳过
      expect(ids.includes('reading-star-1')).toBe(false)
      // reading-star-2 应正常解锁
      expect(ids.includes('reading-star-2')).toBe(true)
    } finally {
      ACHIEVEMENT_RULES[ruleIndex].check = originalCheck
      restoreMock()
    }
  })

  // ---------- 附加测试：辅助查询方法 ----------

  // 10. isAchievementUnlocked 在已解锁/未解锁时返回值正确
  it('isAchievementUnlocked 返回值正确', async () => {
    const now = Date.now()
    const existing: Achievement = {
      id: 'reading-star-1',
      name: '阅读之星 I',
      description: '当日完成 1 篇阅读',
      icon: '⭐',
      unlockedAt: now,
      updated_at: now,
    }
    installMock([existing])
    try {
      const unlocked = await isAchievementUnlocked('reading-star-1')
      const notUnlocked = await isAchievementUnlocked('streak-7')
      expect(unlocked).toBe(true)
      expect(notUnlocked).toBe(false)
    } finally {
      restoreMock()
    }
  })

  // 11. getUnlockedAchievements 按 unlockedAt 降序返回
  it('getUnlockedAchievements 按 unlockedAt 降序返回', async () => {
    const older: Achievement = {
      id: 'reading-star-1',
      name: '阅读之星 I',
      description: '',
      icon: '⭐',
      unlockedAt: 1000,
      updated_at: 1000,
    }
    const newer: Achievement = {
      id: 'streak-7',
      name: '七日坚持',
      description: '',
      icon: '🔥',
      unlockedAt: 2000,
      updated_at: 2000,
    }
    installMock([older, newer])
    try {
      const all = await getUnlockedAchievements()
      expect(all.length).toBe(2)
      expect(all[0].id).toBe('streak-7')
      expect(all[1].id).toBe('reading-star-1')
    } finally {
      restoreMock()
    }
  })
})
