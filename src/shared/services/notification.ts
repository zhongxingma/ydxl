// 浏览器通知服务
// 封装 Notification API，提供权限管理、通知发送与每日定时提醒
// 不支持通知的浏览器中所有方法优雅降级（console.warn 或空操作）
// 注意：每日提醒仅在前台（页面已打开）时有效

// 通知权限状态：default（未询问）/ granted（已授权）/ denied（已拒绝）
export type NotificationPermission = 'default' | 'granted' | 'denied'

/**
 * 检查浏览器是否支持通知 API
 * @returns 支持返回 true，否则返回 false
 */
export function isNotificationSupported(): boolean {
  return typeof window !== 'undefined' && 'Notification' in window
}

/**
 * 获取当前通知权限；不支持时返回 'denied'
 * @returns 当前通知权限状态（default / granted / denied）
 */
export function getNotificationPermission(): NotificationPermission {
  if (!isNotificationSupported()) return 'denied'
  return Notification.permission as NotificationPermission
}

/**
 * 请求通知权限；不支持时返回 'denied'
 * @returns 授权结果（default / granted / denied）
 */
export async function requestNotificationPermission(): Promise<NotificationPermission> {
  if (!isNotificationSupported()) {
    console.warn('[Notification] 当前浏览器不支持通知 API')
    return 'denied'
  }
  try {
    const permission = await Notification.requestPermission()
    return permission as NotificationPermission
  } catch (err) {
    console.warn('[Notification] 请求通知权限失败', err)
    return 'denied'
  }
}

/**
 * 发送通知；权限不足或失败时降级为 console.warn
 * @param title 通知标题
 * @param options 通知选项（body、icon 等）
 */
export async function sendNotification(
  title: string,
  options?: NotificationOptions,
): Promise<void> {
  if (!isNotificationSupported()) {
    console.warn('[Notification] 当前浏览器不支持通知 API，无法发送：', title)
    return
  }
  if (Notification.permission !== 'granted') {
    console.warn('[Notification] 通知权限未授权，无法发送：', title)
    return
  }
  try {
    new Notification(title, options)
  } catch (err) {
    console.warn('[Notification] 发送通知失败：', title, err)
  }
}

/**
 * 设置每日定时提醒（仅在页面处于前台时有效）
 * @param time 触发时间，格式 "HH:MM"（24 小时制，本地时间）
 * @param callback 到达指定时间时的回调
 * @returns 取消函数，调用后停止定时检查
 */
export function setupDailyReminder(time: string, callback: () => void): () => void {
  // 校验时间格式
  if (!/^\d{2}:\d{2}$/.test(time)) {
    console.warn('[Notification] 时间格式错误，应为 "HH:MM"：', time)
    return () => {}
  }

  // 每分钟检查一次当前时间是否匹配
  const timerId = setInterval(() => {
    const now = new Date().toTimeString().slice(0, 5)
    if (now === time) {
      try {
        callback()
      } catch (err) {
        console.warn('[Notification] 每日提醒回调执行失败', err)
      }
    }
  }, 60 * 1000)

  // 返回取消函数
  return () => clearInterval(timerId)
}
