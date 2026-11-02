// 语法填空交互式生成选择页：阅读理解答完但语法填空未就绪时由用户决定生成或跳过
import { useTranslation } from '@/shared/i18n/useTranslation'

interface GrammarInterstitialProps {
  grammarGenError: string | null
  generatingGrammar: boolean
  onGenerate: () => void
  onSkip: () => void
}

export default function GrammarInterstitial({
  grammarGenError,
  generatingGrammar,
  onGenerate,
  onSkip,
}: GrammarInterstitialProps) {
  const { t } = useTranslation()
  return (
    <div className="rounded-lg border border-emerald-200 bg-emerald-50/60 p-4 shadow-sm dark:border-emerald-700/60 dark:bg-emerald-900/20">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-emerald-100 dark:bg-emerald-900/40">
          <svg
            className="h-5 w-5 text-emerald-600 dark:text-emerald-300"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.8}
            aria-hidden
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M12 6.042A8.967 8.967 0 0 0 6 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 0 1 6 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 0 1 6-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0 0 18 18a8.967 8.967 0 0 0-6 2.292m0-14.25v14.25"
            />
          </svg>
        </div>
        <div className="flex-1">
          <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
            {t('reading.grammar.title')}
          </h3>
          <p className="mt-1 text-xs leading-relaxed text-gray-600 dark:text-gray-400">
            {t('reading.grammar.desc')}
            {grammarGenError && (
              <span className="mt-1 block text-amber-600 dark:text-amber-400">
                {t('reading.grammar.last_failed', { error: grammarGenError })}
              </span>
            )}
          </p>
        </div>
      </div>
      <div className="mt-4 flex flex-wrap gap-3">
        <button
          type="button"
          onClick={onGenerate}
          disabled={generatingGrammar}
          className="inline-flex items-center gap-2 rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-emerald-700 disabled:opacity-60 dark:bg-emerald-500 dark:hover:bg-emerald-600"
        >
          {generatingGrammar ? (
            <>
              <svg
                className="h-4 w-4 animate-spin"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
                aria-hidden
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182m0-4.991v4.99"
                />
              </svg>
              {t('reading.grammar.generating')}
            </>
          ) : (
            t('reading.grammar.generate')
          )}
        </button>
        <button
          type="button"
          onClick={onSkip}
          disabled={generatingGrammar}
          className="rounded-md border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 disabled:opacity-60 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700"
        >
          {t('reading.grammar.skip')}
        </button>
      </div>
    </div>
  )
}
