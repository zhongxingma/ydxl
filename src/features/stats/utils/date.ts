// 学习统计模块日期工具函数

// 将 Date 格式化为 YYYY-MM-DD（基于本地时区）
function formatDate(date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

// 返回今天的日期字符串 YYYY-MM-DD
export function getTodayStr(): string {
  return formatDate(new Date())
}

// 返回 n 天前的日期字符串 YYYY-MM-DD
export function getDateNDaysAgo(n: number): string {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return formatDate(d)
}

// 返回最近 7 天（week）或 30 天（month）的日期数组，从早到晚排序
export function getDateRange(mode: 'week' | 'month'): string[] {
  const days = mode === 'week' ? 7 : 30
  const result: string[] = []
  for (let i = days - 1; i >= 0; i--) {
    result.push(getDateNDaysAgo(i))
  }
  return result
}

// 获取指定日期的前一天（处理跨月/跨年）
export function getPreviousDay(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number)
  const date = new Date(y, m - 1, d)
  date.setDate(date.getDate() - 1)
  return formatDate(date)
}

// 将日期字符串裁剪为 MM-DD 用于图表横轴展示
export function formatShortDate(dateStr: string): string {
  return dateStr.slice(5)
}
