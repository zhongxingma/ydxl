// 个人中心统计数据：阅读会话 / 生词总量 / 掌握数 / 成就解锁
import { useEffect, useMemo, useState } from 'react'
import { getUnlockedAchievements } from '@/features/stats/services/achievementService'
import { readingSessionRepository, wordRepository } from '@/shared/services'
import type { Achievement } from '@/shared/types'

// ====== 统计数据聚合结构 ======
export interface ProfileStats {
  // 总阅读篇数（readingSessions 表总数）
  totalReadCount: number
  // 总学习词数（words 表总数）
  totalWords: number
  // 累计学习时长（秒）
  totalDurationSec: number
  // 总掌握单词数（mastery >= 5）
  totalMasteredWords: number
}

export interface UseProfileStatsResult {
  stats: ProfileStats | null
  achievements: Achievement[]
  loading: boolean
  durationText: string
}

// 将秒数格式化为 "X 小时 Y 分钟" / "Y 分钟" / "X 秒"
export function formatDuration(sec: number): string {
  if (sec <= 0) return '0 分钟'
  const hours = Math.floor(sec / 3600)
  const minutes = Math.floor((sec % 3600) / 60)
  const seconds = sec % 60
  if (hours > 0) {
    return `${hours} 小时 ${minutes} 分钟`
  }
  if (minutes > 0) {
    return `${minutes} 分钟`
  }
  return `${seconds} 秒`
}

export function useProfileStats(): UseProfileStatsResult {
  const [stats, setStats] = useState<ProfileStats | null>(null)
  const [achievements, setAchievements] = useState<Achievement[]>([])
  const [loading, setLoading] = useState(true)

  // 加载统计数据
  useEffect(() => {
    let cancelled = false
    const load = async () => {
      try {
        // 通过 CachedRemoteRepository 获取数据（服务器为主，Dexie 离线缓存）
        // 使用 Dexie 索引 count/where 查询替代 getAll().filter()，避免全表扫描
        const [sessions, totalWords, totalMasteredWords, unlocked] = await Promise.all([
          readingSessionRepository.getAll(),
          wordRepository.count(),
          // mastery 是索引字段，mastery > 4 即 mastery >= 5
          wordRepository.countWhereAbove('mastery', 4),
          getUnlockedAchievements(),
        ])
        if (!cancelled) {
          setStats({
            totalReadCount: sessions.length,
            totalWords,
            totalDurationSec: sessions.reduce((sum, s) => sum + (s.durationSec || 0), 0),
            totalMasteredWords,
          })
          setAchievements(unlocked)
          setLoading(false)
        }
      } catch (err) {
        console.warn('[ProfilePage] 加载统计数据失败', err)
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [])

  // 累计时长文案
  const durationText = useMemo(
    () => (stats ? formatDuration(stats.totalDurationSec) : '--'),
    [stats],
  )

  return { stats, achievements, loading, durationText }
}
