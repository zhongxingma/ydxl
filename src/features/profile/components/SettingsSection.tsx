// "我的"页面设置区域包装组件：统一卡片样式与标题
import type { ReactNode } from 'react'

interface SettingsSectionProps {
  // 区域标题
  title: string
  // 区域描述（可选）
  description?: string
  // 区域图标（可选）
  icon?: ReactNode
  // 区域内容
  children: ReactNode
}

export default function SettingsSection({
  title,
  description,
  icon,
  children,
}: SettingsSectionProps) {
  return (
    <section className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-800 sm:p-5">
      <div className="mb-4 flex items-center gap-2">
        {icon && <span className="text-gray-500 dark:text-gray-400">{icon}</span>}
        <div>
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">{title}</h2>
          {description && (
            <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">{description}</p>
          )}
        </div>
      </div>
      <div className="space-y-4">{children}</div>
    </section>
  )
}
