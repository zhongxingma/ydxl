// 阅读计时器 hook：累计阅读时长
// - 每秒刷新显示值（基于 store 的 startTime）
// - 监听 visibilitychange：页面隐藏时暂停计时，可见时恢复
// 计时器的真值保存在 store（startTime/pausedDuration），本 hook 仅负责
// 周期性拉取 getElapsedSec() 同步到本地 state 以驱动 UI 刷新
import { useEffect, useState } from 'react'
import { useReadingStore } from '../store'

export interface UseReadingTimerResult {
  // 当前累计已用秒数（每秒刷新）
  elapsedSec: number
}

/** 计时显示：将秒数格式化为 mm:ss */
export function formatDuration(sec: number): string {
  const m = Math.floor(sec / 60)
  const s = sec % 60
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

export function useReadingTimer(): UseReadingTimerResult {
  const startTime = useReadingStore((s) => s.startTime)
  const getElapsedSec = useReadingStore((s) => s.getElapsedSec)
  const pauseTimer = useReadingStore((s) => s.pauseTimer)
  const resumeTimer = useReadingStore((s) => s.resumeTimer)

  const [elapsedSec, setElapsedSec] = useState(0)

  // 计时器：每秒刷新显示值
  useEffect(() => {
    if (startTime === 0) return
    const timer = window.setInterval(() => {
      setElapsedSec(getElapsedSec())
    }, 1000)
    return () => window.clearInterval(timer)
  }, [startTime, getElapsedSec])

  // visibilitychange：页面隐藏时暂停计时，可见时恢复
  useEffect(() => {
    const handleVisibility = () => {
      if (document.hidden) {
        pauseTimer()
      } else {
        resumeTimer()
      }
    }
    document.addEventListener('visibilitychange', handleVisibility)
    return () => {
      document.removeEventListener('visibilitychange', handleVisibility)
    }
  }, [pauseTimer, resumeTimer])

  return { elapsedSec }
}
