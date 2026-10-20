// 庆祝动画组件
// - 撒花/星星动画，持续 3 秒后自动消失
// - 纯 CSS 动画实现，不依赖外部动画库
// - 由父组件通过 visible 控制显示，动画结束后回调 onComplete
import { useEffect, useRef, useState } from 'react'

export interface CelebrationProps {
  // 是否显示动画
  visible: boolean
  // 动画完成（3 秒）后回调
  onComplete?: () => void
  // 正向反馈文案，如"太棒了！"
  text?: string
}

// 纸片颜色池：红 / 黄 / 蓝 / 绿 / 紫
const CONFETTI_COLORS = [
  '#ef4444', // red-500
  '#f59e0b', // amber-500
  '#3b82f6', // blue-500
  '#10b981', // emerald-500
  '#a855f7', // purple-500
]

// 星星 emoji 池
const STAR_EMOJIS = ['⭐', '✨', '🌟']

// 关键帧与动画样式（在组件挂载时注入一次）
const KEYFRAMES_STYLE = `
@keyframes celebration-confetti-fall {
  0% {
    transform: translateY(-10vh) rotate(0deg);
    opacity: 1;
  }
  100% {
    transform: translateY(110vh) rotate(720deg);
    opacity: 0;
  }
}
@keyframes celebration-star-twinkle {
  0% {
    transform: translateY(-10vh) scale(0.4) rotate(0deg);
    opacity: 0;
  }
  20% {
    opacity: 1;
  }
  100% {
    transform: translateY(110vh) scale(1.2) rotate(360deg);
    opacity: 0;
  }
}
@keyframes celebration-text-pop {
  0% {
    transform: scale(0.5);
    opacity: 0;
  }
  20% {
    transform: scale(1.15);
    opacity: 1;
  }
  70% {
    transform: scale(1);
    opacity: 1;
  }
  100% {
    transform: scale(1);
    opacity: 0;
  }
}
`

// 单个纸片元素
interface ConfettiPiece {
  left: number // 水平起始位置（%）
  color: string
  duration: number // 动画时长（秒）
  delay: number // 延迟启动（秒）
  rotate: number // 初始旋转角度
}

// 单个星星元素
interface StarPiece {
  left: number
  emoji: string
  duration: number
  delay: number
}

// 生成 [min, max] 范围内的随机整数
function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min
}

// 生成 30-50 个随机纸片
function generateConfetti(): ConfettiPiece[] {
  const count = randomInt(30, 50)
  return Array.from({ length: count }, () => ({
    left: Math.random() * 100,
    color: CONFETTI_COLORS[randomInt(0, CONFETTI_COLORS.length - 1)],
    duration: 2 + Math.random() * 2, // 2-4 秒
    delay: Math.random() * 0.5,
    rotate: Math.random() * 360,
  }))
}

// 生成 10-15 个随机星星
function generateStars(): StarPiece[] {
  const count = randomInt(10, 15)
  return Array.from({ length: count }, () => ({
    left: Math.random() * 100,
    emoji: STAR_EMOJIS[randomInt(0, STAR_EMOJIS.length - 1)],
    duration: 2 + Math.random() * 2,
    delay: Math.random() * 0.5,
  }))
}

export default function Celebration({ visible, onComplete, text }: CelebrationProps) {
  // 每次显示时重新生成纸片与星星，保证动画有变化
  const [confetti, setConfetti] = useState<ConfettiPiece[]>([])
  const [stars, setStars] = useState<StarPiece[]>([])

  // 通过 ref 持有最新的 onComplete，避免回调变化导致定时器重置
  const onCompleteRef = useRef(onComplete)
  useEffect(() => {
    onCompleteRef.current = onComplete
  }, [onComplete])

  useEffect(() => {
    if (!visible) return
    // 重新生成本次动画的随机参数
    setConfetti(generateConfetti())
    setStars(generateStars())
    // 3 秒后通知父组件动画结束
    const timer = setTimeout(() => {
      onCompleteRef.current?.()
    }, 3000)
    return () => clearTimeout(timer)
  }, [visible])

  if (!visible) return null

  return (
    <div
      className="pointer-events-none fixed inset-0 z-50 overflow-hidden"
      aria-hidden="true"
    >
      <style>{KEYFRAMES_STYLE}</style>

      {/* 彩色纸片 */}
      {confetti.map((piece, idx) => (
        <div
          key={`confetti-${idx}`}
          className="absolute top-0 h-3 w-2"
          style={{
            left: `${piece.left}%`,
            backgroundColor: piece.color,
            transform: `rotate(${piece.rotate}deg)`,
            animation: `celebration-confetti-fall ${piece.duration}s linear ${piece.delay}s forwards`,
          }}
        />
      ))}

      {/* 星星 emoji */}
      {stars.map((star, idx) => (
        <div
          key={`star-${idx}`}
          className="absolute top-0 text-2xl"
          style={{
            left: `${star.left}%`,
            animation: `celebration-star-twinkle ${star.duration}s ease-in ${star.delay}s forwards`,
          }}
        >
          {star.emoji}
        </div>
      ))}

      {/* 中心正向反馈文案 */}
      {text && (
        <div className="absolute inset-0 flex items-center justify-center">
          <p
            className="text-3xl font-bold text-gray-900 drop-shadow-sm dark:text-gray-100"
            style={{
              animation: 'celebration-text-pop 3s ease-out forwards',
            }}
          >
            {text}
          </p>
        </div>
      )}
    </div>
  )
}
