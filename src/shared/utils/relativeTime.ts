// 相对时间格式化工具
// 将时间戳转换为"今天 / 明天 / 后天 / N 天后 / 已逾期 N 天"等相对描述

// 一天的毫秒数
const DAY_MS = 24 * 60 * 60 * 1000

/**
 * 将时间戳格式化为相对时间描述
 *
 * - 已逾期：返回"已逾期 N 天"（N >= 1）
 * - 今天：返回"今天"
 * - 明天：返回"明天"
 * - 后天：返回"后天"
 * - 未来 3 天以上：返回"N 天后"
 *
 * 按日历天计算差值（忽略同日内的小时差异）
 *
 * @param timestamp 目标时间戳（毫秒）
 * @returns 相对时间描述文案
 */
export function formatRelativeTime(timestamp: number): string {
  const now = Date.now()

  // 已逾期
  if (timestamp < now) {
    const overdueDays = Math.floor((now - timestamp) / DAY_MS)
    if (overdueDays <= 0) return '今天'
    return `已逾期 ${overdueDays} 天`
  }

  // 按日历天计算差值
  const todayStart = new Date(now)
  todayStart.setHours(0, 0, 0, 0)
  const targetStart = new Date(timestamp)
  targetStart.setHours(0, 0, 0, 0)
  const dayDiff = Math.round((targetStart.getTime() - todayStart.getTime()) / DAY_MS)

  if (dayDiff <= 0) return '今天'
  if (dayDiff === 1) return '明天'
  if (dayDiff === 2) return '后天'
  return `${dayDiff} 天后`
}
