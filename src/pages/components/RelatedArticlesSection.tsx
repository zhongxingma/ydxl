// 横向滚动卡片列表，展示基于用户阅读历史推荐的未读文章
// 卡片点击调用 onArticleClick(id)
import type { Article, Difficulty, Genre, Topic } from '@/shared/types'
import { useNavigate } from 'react-router-dom'

interface RelatedArticlesSectionProps {
  articles: Article[]
  onArticleClick: (id: string) => void
}

// 主题中文映射
const TOPIC_LABEL: Record<Topic, string> = {
  campus: '校园',
  science: '科普',
  culture: '文化',
  biography: '人物',
  travel: '旅行',
  sports: '体育',
  technology: '科技',
  nature: '自然',
  news: '新闻',
  // 新课标三大主题
  self: '自我',
  society: '社会',
  nature_theme: '自然',
  // 生活化题材
  traditional_culture: '传统文化',
  ai_life: 'AI 与生活',
  personal_growth: '个人成长',
}

// 体裁中文映射
const GENRE_LABEL: Record<Genre, string> = {
  narrative: '记叙文',
  expository: '说明文',
  practical: '应用文',
  argumentative: '议论文',
}

// 难度徽章样式映射
const DIFFICULTY_BADGE: Record<Difficulty, { label: string; className: string }> = {
  easy: {
    label: '简单',
    className: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300',
  },
  medium: {
    label: '中等',
    className: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
  },
  hard: {
    label: '困难',
    className: 'bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300',
  },
}

export default function RelatedArticlesSection({
  articles,
  onArticleClick,
}: RelatedArticlesSectionProps) {
  const navigate = useNavigate()

  // 空状态：无推荐时引导用户去生成新文章
  if (articles.length === 0) {
    return (
      <section className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm dark:border-gray-700 dark:bg-gray-800">
        <h2 className="mb-1 text-lg font-semibold text-gray-900 dark:text-gray-100">相关推荐</h2>
        <p className="mb-4 text-sm text-gray-500 dark:text-gray-400">基于你的阅读历史推荐</p>
        <div className="flex flex-col items-center justify-center py-6 text-center">
          <div className="mb-3 text-4xl">✨</div>
          <p className="mb-4 text-sm text-gray-600 dark:text-gray-400">
            暂无推荐，去生成新文章
          </p>
          <button
            type="button"
            onClick={() => navigate('/reading')}
            className="inline-flex items-center gap-1.5 rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-indigo-700"
          >
            去生成
          </button>
        </div>
      </section>
    )
  }

  return (
    <section className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-800">
      <div className="mb-4">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">相关推荐</h2>
        <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">基于你的阅读历史推荐</p>
      </div>

      {/* 横向滚动卡片列表 */}
      <div className="flex gap-3 overflow-x-auto pb-2">
        {articles.map((article) => {
          const topicLabel = article.topic ? TOPIC_LABEL[article.topic] : null
          const genreLabel = GENRE_LABEL[article.genre]
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
                    {difficulty.label}
                  </span>
                )}
              </div>
              {/* 文章标题（截断 2 行） */}
              <h3 className="line-clamp-2 flex-1 text-sm font-medium text-gray-900 dark:text-gray-100">
                {article.title}
              </h3>
              {/* 相关度提示：基于 topic/genre 字段给出标签 */}
              <div className="mt-3 flex items-center gap-1 text-xs text-gray-400 dark:text-gray-500">
                <span>推荐</span>
                {topicLabel && <span>· 同题材</span>}
              </div>
            </button>
          )
        })}
      </div>
    </section>
  )
}
