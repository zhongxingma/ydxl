// 404 兜底页：未知路径渲染友好提示，提供返回首页引导（BUG-003 修复）
import { Link } from 'react-router-dom'
import { HomeIcon } from '@/shared/components/icons'
import { useTranslation } from '@/shared/i18n/useTranslation'

export default function NotFoundPage() {
  const { t } = useTranslation()
  return (
    <div className="flex min-h-[50vh] flex-col items-center justify-center py-12 text-center">
      {/* 大号 404 视觉锚点 */}
      <p className="bg-gradient-to-r from-indigo-600 to-purple-600 bg-clip-text text-7xl font-extrabold tracking-tight text-transparent dark:from-indigo-400 dark:to-purple-400">
        404
      </p>
      <h1 className="mt-4 text-xl font-semibold text-gray-900 dark:text-gray-100">
        {t('notfound.title')}
      </h1>
      <p className="mt-2 max-w-md text-sm text-gray-500 dark:text-gray-400">
        {t('notfound.desc')}
      </p>
      <Link
        to="/"
        className="mt-6 inline-flex items-center gap-2 rounded-md bg-indigo-600 px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-indigo-700 dark:bg-indigo-500 dark:hover:bg-indigo-600"
      >
        <HomeIcon className="h-4 w-4" />
        {t('notfound.back_home')}
      </Link>
    </div>
  )
}
