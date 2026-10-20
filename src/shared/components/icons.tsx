// 内联 SVG 图标组件（避免引入额外依赖）
// 所有图标均接受 className 用于尺寸与颜色控制
import type { SVGProps } from 'react'

type IconProps = SVGProps<SVGSVGElement>

const baseProps: IconProps = {
  fill: 'none',
  viewBox: '0 0 24 24',
  strokeWidth: 1.5,
  stroke: 'currentColor',
  'aria-hidden': true,
}

// 布局/仪表盘图标
export function Layout(props: IconProps) {
  return (
    <svg {...baseProps} {...props}>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M3.75 6A2.25 2.25 0 0 1 6 3.75h2.25A2.25 2.25 0 0 1 10.5 6v2.25a2.25 2.25 0 0 1-2.25 2.25H6a2.25 2.25 0 0 1-2.25-2.25V6Zm9.75 0A2.25 2.25 0 0 1 15 3.75h2.25A2.25 2.25 0 0 1 19.5 6v2.25a2.25 2.25 0 0 1-2.25 2.25H15A2.25 2.25 0 0 1 12.75 8.25V6Zm-9.75 9.75A2.25 2.25 0 0 1 6 13.5h2.25a2.25 2.25 0 0 1 2.25 2.25V18A2.25 2.25 0 0 1 8.25 20.25H6A2.25 2.25 0 0 1 3.75 18v-2.25Zm9.75 0A2.25 2.25 0 0 1 15 13.5h2.25a2.25 2.25 0 0 1 2.25 2.25V18a2.25 2.25 0 0 1-2.25 2.25H15A2.25 2.25 0 0 1 12.75 18v-2.25Z"
      />
    </svg>
  )
}

// 打开的书 - 阅读
export function BookOpen(props: IconProps) {
  return (
    <svg {...baseProps} {...props}>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M12 6.042A8.967 8.967 0 0 0 6 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 0 1 6 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 0 1 6-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0 0 18 18a8.967 8.967 0 0 0-6 2.292m0-14.25v14.25"
      />
    </svg>
  )
}

// 书签 - 生词本
export function Bookmark(props: IconProps) {
  return (
    <svg {...baseProps} {...props}>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M17.593 3.322c1.1.128 1.907 1.077 1.907 2.185V21L12 17.25 4.5 21V5.507c0-1.108.806-2.057 1.907-2.185a48.507 48.507 0 0 1 11.186 0Z"
      />
    </svg>
  )
}

// 刷新 - 复习
export function RefreshCw(props: IconProps) {
  return (
    <svg {...baseProps} {...props}>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182m0-4.991v4.99"
      />
    </svg>
  )
}

// 柱状图 - 统计
export function BarChart3(props: IconProps) {
  return (
    <svg {...baseProps} {...props}>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 0 1 3 19.875v-6.75Zm9.75-9.75C12.75 2.754 13.254 2.25 13.875 2.25h2.25c.621 0 1.125.504 1.125 1.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V3.375Zm9.75 6.75c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v7.875c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125v-7.875Z"
      />
    </svg>
  )
}

// 太阳 - 切换到日间
export function Sun(props: IconProps) {
  return (
    <svg {...baseProps} {...props}>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M12 3v2.25m6.364.386-1.591 1.591M21 12h-2.25m-.386 6.364-1.591-1.591M12 18.75V21m-4.773-4.227-1.591 1.591M5.25 12H3m4.227-4.773L5.636 5.636M15.75 12a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0Z"
      />
    </svg>
  )
}

// 月亮 - 切换到夜间
export function Moon(props: IconProps) {
  return (
    <svg {...baseProps} {...props}>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M21.752 15.002A9.718 9.718 0 0 1 18 15.75c-5.385 0-9.75-4.365-9.75-9.75 0-1.33.266-2.597.748-3.752A9.753 9.753 0 0 0 3 11.25C3 16.635 7.365 21 12.75 21a9.753 9.753 0 0 0 9.002-5.998Z"
      />
    </svg>
  )
}

// 火焰 - 连续学习天数
export function FlameIcon(props: IconProps) {
  return (
    <svg {...baseProps} {...props}>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M15.362 5.214A8.252 8.252 0 0 1 12 21 8.25 8.25 0 0 1 6.038 7.047c.078.78.28 1.535.598 2.244a8.234 8.234 0 0 0 1.624 2.298 6.026 6.026 0 0 1-1.06-3.476c0-1.564.598-3.07 1.674-4.21A8.228 8.228 0 0 1 12 2.25a8.27 8.27 0 0 0-1.5 4.736c0 .748.1 1.473.288 2.161a6.02 6.02 0 0 0 2.063-2.933Z"
      />
    </svg>
  )
}

// 勋章 - 成就/掌握单词
export function BadgeIcon(props: IconProps) {
  return (
    <svg {...baseProps} {...props}>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M9 12.75 11.25 15 15 9.75M21 12c0 1.268-.63 2.39-1.593 3.068a3.745 3.745 0 0 0-1.043 3.296 3.745 3.745 0 0 1-3.296 1.043A3.745 3.745 0 0 0 12 21c-1.268 0-2.39-.63-3.068-1.593a3.746 3.746 0 0 0-3.296-1.043 3.745 3.745 0 0 1-1.043-3.296A3.745 3.745 0 0 0 3 12c0-1.268.63-2.39 1.593-3.068a3.745 3.745 0 0 0 1.043-3.296 3.745 3.745 0 0 1 3.296-1.043A3.745 3.745 0 0 0 12 3c1.268 0 2.39.63 3.068 1.593a3.746 3.746 0 0 0 3.296 1.043 3.746 3.746 0 0 1 1.043 3.296A3.745 3.745 0 0 0 21 12Z"
      />
    </svg>
  )
}

// 时钟 - 学习时长/最近复习
export function ClockIcon(props: IconProps) {
  return (
    <svg {...baseProps} {...props}>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M12 6v6h4.5m4.5 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z"
      />
    </svg>
  )
}

// 目标 - 准确率/学习目标
export function TargetIcon(props: IconProps) {
  return (
    <svg {...baseProps} {...props}>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M12 21a9 9 0 1 1 0-18 9 9 0 0 1 0 18Zm0-4.5a4.5 4.5 0 1 0 0-9 4.5 4.5 0 0 0 0 9Zm0-3a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Z"
      />
    </svg>
  )
}

// 喇叭 - 朗读
export function SpeakerIcon(props: IconProps) {
  return (
    <svg {...baseProps} {...props}>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M19.114 5.636a9 9 0 0 1 0 12.728M16.463 8.288a5.25 5.25 0 0 1 0 7.424M6.75 8.25l4.72-4.72a.75.75 0 0 1 1.28.53v15.88a.75.75 0 0 1-1.28.53l-4.72-4.72H4.51c-.88 0-1.704-.506-1.938-1.354A9.009 9.009 0 0 1 2.25 12c0-.83.112-1.633.322-2.396C2.806 8.756 3.63 8.25 4.51 8.25H6.75Z"
      />
    </svg>
  )
}

// 铃铛 - 学习提醒
export function BellIcon(props: IconProps) {
  return (
    <svg {...baseProps} {...props}>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M14.857 17.082a23.848 23.848 0 0 0 5.454-1.31A8.967 8.967 0 0 1 18 9.75V9A6 6 0 0 0 6 9v.75a8.967 8.967 0 0 1-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 0 1-5.714 0m5.714 0a3 3 0 1 1-5.714 0"
      />
    </svg>
  )
}

// 标签 - 词性标签/AI 芯片
export function ChipIcon(props: IconProps) {
  return (
    <svg {...baseProps} {...props}>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M8.25 3v1.5M4.5 8.25H3m4.5 7.5H3m4.5 1.5V21M12 3v1.5m0 12V21m4.5-18v1.5M21 8.25h-1.5m1.5 7.5h-1.5m-7.5-7.5h4.5a1.5 1.5 0 0 1 1.5 1.5v4.5a1.5 1.5 0 0 1-1.5 1.5h-4.5a1.5 1.5 0 0 1-1.5-1.5v-4.5a1.5 1.5 0 0 1 1.5-1.5Z"
      />
    </svg>
  )
}

// 地球 - 语言/国际化
export function GlobeIcon(props: IconProps) {
  return (
    <svg {...baseProps} {...props}>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M12 21a9 9 0 1 1 0-18 9 9 0 0 1 0 18Zm0 0c2.485 0 4.5-4.03 4.5-9S14.485 3 12 3m0 18c-2.485 0-4.5-4.03-4.5-9S9.515 3 12 3m-9 9h18"
      />
    </svg>
  )
}

// 书本/单词 - 阅读/词汇（与 BookOpen 同一图标，提供语义化别名）
export { BookOpen as BookIcon, BookOpen as WordIcon }

// 房屋 - 返回首页（404 页等场景）
export function HomeIcon(props: IconProps) {
  return (
    <svg {...baseProps} {...props}>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M2.25 12l8.954-8.955c.44-.439 1.152-.439 1.591 0L21.75 12M4.5 9.75v10.125c0 .621.504 1.125 1.125 1.125H9.75v-4.875c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21h4.125c.621 0 1.125-.504 1.125-1.125V9.75"
      />
    </svg>
  )
}

// 堆叠层 - 重点短语汇总
export function LayersIcon(props: IconProps) {
  return (
    <svg {...baseProps} {...props}>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M20.25 6.375c0 2.278-3.694 4.125-8.25 4.125S3.75 8.653 3.75 6.375m16.5 0c0-2.278-3.694-4.125-8.25-4.125S3.75 4.097 3.75 6.375m16.5 0v11.25c0 2.278-3.694 4.125-8.25 4.125s-8.25-1.847-8.25-4.125V6.375m16.5 0v3.75c0 2.278-3.694 4.125-8.25 4.125s-8.25-1.847-8.25-4.125v-3.75"
      />
    </svg>
  )
}

// 书本文字行 - 重点词汇汇总（书本 + 文字行，区别于 BookOpen 阅读图标）
export function BookTextIcon(props: IconProps) {
  return (
    <svg {...baseProps} {...props}>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M12 6.042A8.967 8.967 0 0 0 6 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 0 1 6 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 0 1 6-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0 0 18 18a8.967 8.967 0 0 0-6 2.292m0-14.25v14.25"
      />
    </svg>
  )
}
