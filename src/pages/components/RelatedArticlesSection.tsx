// 横向滚动卡片列表，展示基于用户阅读历史推荐的未读文章
// 卡片点击调用 onArticleClick(id)
import type { Article, Difficulty, Genre, Topic } from '@/shared/types'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from '@/shared/i18n/useTranslation'

interface RelatedArticlesSectionProps {
  articles: Article[]
  onArticleClick: (id: string) => void
}

// 主题短标签文案 key 映射（展示时经 t() 翻译）
const TOPIC_KEY: Record<Topic, string> = {
  campus: 'dashboard.topic.campus',
  science: 'dashboard.topic.science',
  culture: 'dashboard.topic.culture',
  biography: 'dashboard.topic.biography',
  travel: 'dashboard.topic.travel',
  sports: 'dashboard.topic.sports',
  technology: 'dashboard.topic.technology',
  nature: 'dashboard.topic.nature',
  news: 'dashboard.topic.news',
  // 新课标三大主题
  self: 'dashboard.topic.self',
  society: 'dashboard.topic.society',
  nature_theme: 'dashboard.topic.nature_theme',
  // 生活化题材
  traditional_culture: 'dashboard.topic.traditional_culture',
  ai_life: 'dashboard.topic.ai_life',
  personal_growth: 'dashboard.topic.personal_growth',
}

// 体裁文案 key 映射（展示时经 t() 翻译）
const GENRE_KEY: Record<Genre, string> = {
  narrative: 'reading.genre.narrative',
  expository: 'reading.genre.expository',
  practical: 'reading.genre.practical',
  argumentative: 'reading.genre.argumentative',
}

// 难度徽章样式映射
const DIFFICULTY_BADGE: Record<Difficulty, { labelKey: string; className: string }> = {
  easy: {
    labelKey: 'reading.difficulty.easy',
    className: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300',
  },
  medium: {
    labelKey: 'reading.difficulty.medium',
    className: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
  },
  hard: {
    labelKey: 'reading.difficulty.hard',
    className: 'bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300',
  },
}

export default function RelatedArticlesSection({
  articles,
  onArticleClick,
}: RelatedArticlesSectionProps) {
  const navigate = useNavigate()
  const { t } = useTranslation()

  // 空状态：无推荐时引导用户去生成新文章
  if (articles.length === 0) {
    return (
      <section className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm dark:border-gray-700 dark:bg-gray-800">
        <h2 className="mb-1 text-lg font-semibold text-gray-900 dark:text-gray-100">{t('dashboard.recommended')}</h2>
        <p className="mb-4 text-sm text-gray-500 dark:text-gray-400">{t('dashboard.related_subtitle')}</p>
        <div className="flex flex-col items-center justify-center py-6 text-center">
          <div className="mb-3 text-4xl">✨</div>
          <p className="mb-4 text-sm text-gray-600 dark:text-gray-400">
            {t('dashboard.no_recommendation')}
          </p>
          <button
            type="button"
            onClick={() => navigate('/reading')}
            className="inline-flex items-center gap-1.5 rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-indigo-700"
          >
            {t('dashboard.go_generate')}
          </button>
        </div>
      </section>
    )
  }

  return (
    <section className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-800">
      <div className="mb-4">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">{t('dashboard.recommended')}</h2>
        <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">{t('dashboard.related_subtitle')}</p>
      </div>

      {/* 横向滚动卡片列表 */}
      <div className="flex gap-3 overflow-x-auto pb-2">
        {articles.map((article) => {
          const topicLabel = article.topic ? t(TOPIC_KEY[article.topic]) : null
          const genreLabel = t(GENRE_KEY[article.genre])
          const difficulty = article.difficulty
            ? DIFFICULTY_BADGE[article.difficulty]
            : null
          return (
            <button
              key={article.id}
              type="button"
              onClick={() => onArticleClick(article.id)}
              className="group flex min-w-[240px] max-w-[300px] flex-1 flex-col rounded-lg border border-gray-200 bg-white p-4 text-left shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md dark:border-gray-700 dark:bg-gray-800 dark:hover:border-gray-600"
            >
              {/* 顶部：题材标签 + 难度徽章 */}
              <div className="mb-2 flex items-center justify-between gap-2">
                <div className="flex flex-wrap gap-1">
                  {topicLabel && (
                    <span className="inline-flex items-center rounded-full bg-indigo-50 px-2 py-0.5 text-xs font-medium text-indigo-600 dark:bg-indigo-900/30 dark:text-indigo-300">
                      {topicLabel}
                    </span>
                  )}
                  <span className="inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600 dark:bg-gray-700 dark:text-gray-300">
                    {genreLabel}
                  </span>
                </div>
                {difficulty && (
                  <span
                    className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${difficulty.className}`}
                  >
                    {t(difficulty.labelKey)}
                  </span>
                )}
              </div>
              {/* 文章标题（截断 2 行） */}
              <h3 className="line-clamp-2 flex-1 text-sm font-medium text-gray-900 dark:text-gray-100">
                {article.title}
              </h3>
              {/* 相关度提示：基于 topic/genre 字段给出标签 */}
              <div className="mt-3 flex items-center gap-1 text-xs text-gray-400 dark:text-gray-500">
                <span>{t('dashboard.recommended_badge')}</span>
                {topicLabel && <span>{t('dashboard.same_topic')}</span>}
              </div>
            </button>
          )
        })}
      </div>
    </section>
  )
}
