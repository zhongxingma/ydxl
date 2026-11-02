// 添加文章表单字段：标题 / 英文正文 / 中文翻译 / 文体 / 题材 / 难度 + 提示信息
//
// 纯展示组件，状态与业务逻辑由 useAddArticleForm 提供。
import AIProviderBadge from '@/shared/components/AIProviderBadge'
import { useTranslation } from '@/shared/i18n/useTranslation'
import { cn } from '@/shared/utils/cn'
import type { Difficulty, Genre, Topic } from '@/shared/types'
import {
  MIN_CONTENT_LENGTH,
  type AddArticleFormState,
} from '../hooks/useAddArticleForm'

// 文体选项
const GENRE_OPTIONS: { value: Genre; labelKey: string }[] = [
  { value: 'narrative', labelKey: 'reading.genre.narrative' },
  { value: 'expository', labelKey: 'reading.genre.expository' },
  { value: 'practical', labelKey: 'reading.genre.practical' },
]

// 题材选项
const TOPIC_OPTIONS: { value: Topic; labelKey: string }[] = [
  { value: 'campus', labelKey: 'reading.add_form.topic_campus' },
  { value: 'science', labelKey: 'reading.add_form.topic_science' },
  { value: 'culture', labelKey: 'reading.add_form.topic_culture' },
  { value: 'biography', labelKey: 'reading.add_form.topic_biography' },
  { value: 'travel', labelKey: 'reading.add_form.topic_travel' },
  { value: 'sports', labelKey: 'reading.add_form.topic_sports' },
  { value: 'technology', labelKey: 'reading.add_form.topic_technology' },
  { value: 'nature', labelKey: 'reading.add_form.topic_nature' },
]

// 难度选项
const DIFFICULTY_OPTIONS: { value: Difficulty; labelKey: string }[] = [
  { value: 'easy', labelKey: 'reading.difficulty.easy' },
  { value: 'medium', labelKey: 'reading.difficulty.medium' },
  { value: 'hard', labelKey: 'reading.difficulty.hard' },
]

// 输入框通用样式
const INPUT_CLS =
  'w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-800 placeholder:text-gray-400 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 dark:placeholder:text-gray-500'

interface AddArticleFormFieldsProps {
  form: AddArticleFormState
}

export default function AddArticleFormFields({ form }: AddArticleFormFieldsProps) {
  const { t } = useTranslation()
  const {
    title,
    setTitle,
    content,
    setContent,
    translation,
    setTranslation,
    genre,
    setGenre,
    topic,
    setTopic,
    difficulty,
    setDifficulty,
    translating,
    translationHintIndex,
    error,
    toast,
    canShowAITranslate,
    handleAITranslate,
  } = form

  return (
    <div className="space-y-4">
      {/* 标题（必填） */}
      <div>
        <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
          {t('reading.add_form.title_label')} <span className="text-red-500">*</span>
        </label>
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          maxLength={200}
          placeholder={t('reading.add_form.title_placeholder')}
          className={INPUT_CLS}
        />
      </div>

      {/* 英文正文（必填） */}
      <div>
        <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
          {t('reading.add_form.content_label')} <span className="text-red-500">*</span>
          <span className="ml-2 text-xs font-normal text-gray-500 dark:text-gray-400">
            {t('reading.add_form.content_count', {
              min: MIN_CONTENT_LENGTH,
              count: content.trim().length,
            })}
          </span>
        </label>
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          rows={10}
          placeholder={t('reading.add_form.content_placeholder')}
          className={cn(INPUT_CLS, 'resize-y')}
        />
      </div>

      {/* 中文翻译（可选） */}
      <div className="relative">
        <label className="mb-1 flex flex-wrap items-center gap-1 text-sm font-medium text-gray-700 dark:text-gray-300">
          {t('reading.add_form.translation_label')}
          <span className="text-xs font-normal text-gray-500 dark:text-gray-400">
            {t('reading.add_form.translation_optional_hint')}
          </span>
          {/* AI 来源徽章：翻译由哪个 AI 接口生成 */}
          <AIProviderBadge scenario="translation" />
        </label>
        <div className="relative">
          <textarea
            value={translation}
            onChange={(e) => setTranslation(e.target.value)}
            rows={8}
            placeholder={t('reading.add_form.translation_placeholder')}
            className={cn(INPUT_CLS, 'resize-y', translating && 'opacity-50')}
          />
          {translating && (
            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-2 rounded-md border border-indigo-200 bg-white/50 p-4 text-center dark:border-indigo-800 dark:bg-gray-800/50">
              <div className="h-5 w-5 animate-spin rounded-full border-2 border-indigo-600 border-t-transparent" />
              <p className="text-sm font-medium text-indigo-600 dark:text-indigo-400">
                {t(`reading.add_form.hint_${translationHintIndex + 1}`)}
              </p>
            </div>
          )}
        </div>
      </div>

      {/* AI 补全翻译按钮：英文正文 >= 50 且翻译为空时显示 */}
      {canShowAITranslate && (
        <button
          type="button"
          onClick={handleAITranslate}
          disabled={translating}
          className={cn(
            'inline-flex items-center gap-1 rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
            translating
              ? 'cursor-not-allowed bg-gray-200 text-gray-400 dark:bg-gray-700 dark:text-gray-500'
              : 'bg-indigo-50 text-indigo-700 hover:bg-indigo-100 dark:bg-indigo-900/30 dark:text-indigo-300 dark:hover:bg-indigo-900/50',
          )}
        >
          {translating ? (
            <>
              <div className="h-3 w-3 animate-spin rounded-full border-2 border-indigo-600 border-t-transparent" />
              <span>{t('reading.add_form.ai_translating')}</span>
            </>
          ) : (
            t('reading.add_form.ai_translate')
          )}
        </button>
      )}

      {/* 文体 / 题材 / 难度 三列布局 */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {/* 文体（可选） */}
        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
            {t('reading.field.genre')}
          </label>
          <select
            value={genre}
            onChange={(e) => setGenre(e.target.value as Genre)}
            className={INPUT_CLS}
          >
            {GENRE_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {t(opt.labelKey)}
              </option>
            ))}
          </select>
        </div>

        {/* 题材（可选） */}
        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
            {t('reading.field.topic')}
          </label>
          <select
            value={topic}
            onChange={(e) => setTopic(e.target.value as Topic)}
            className={INPUT_CLS}
          >
            {TOPIC_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {t(opt.labelKey)}
              </option>
            ))}
          </select>
        </div>

        {/* 难度（可选） */}
        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
            {t('reading.field.difficulty')}
          </label>
          <select
            value={difficulty}
            onChange={(e) => setDifficulty(e.target.value as Difficulty)}
            className={INPUT_CLS}
          >
            {DIFFICULTY_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {t(opt.labelKey)}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* 错误提示：失败时不关闭模态框，让用户重试 */}
      {error && (
        <div className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-600 dark:bg-red-900/20 dark:text-red-400">
          {error}
        </div>
      )}

      {/* 成功 toast */}
      {toast && (
        <div className="rounded-md bg-green-50 px-3 py-2 text-sm text-green-700 dark:bg-green-900/20 dark:text-green-300">
          {toast}
        </div>
      )}
    </div>
  )
}
