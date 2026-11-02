// 阅读页内容区：标题 + 四态视图切换（reading / quiz / grammar_quiz / result）+ 操作提示 Toast
//
// 从 ReadingPage 抽出，页面仅负责 hooks 编排与 props 组装。
// 各视图 props 直接复用现有组件的 ComponentProps，避免重复维护类型定义。
import type { ComponentProps } from 'react'
import type { ReadingView } from '../store'
import ReadingArticleView from './ReadingArticleView'
import ReadingQuizView from './ReadingQuizView'
import ReadingResultView from './ReadingResultView'

type ReadingArticleViewProps = ComponentProps<typeof ReadingArticleView>
type ReadingQuizViewProps = ComponentProps<typeof ReadingQuizView>
type ReadingResultViewProps = ComponentProps<typeof ReadingResultView>

interface ReadingPageViewsProps {
  // 当前视图状态
  view: ReadingView
  // 底部操作提示（阅读记录保存失败等），为空时不渲染
  toast: string | null
  // 阅读视图 props（含 article）
  reading: ReadingArticleViewProps
  // 阅读理解答题视图 props
  quiz: ReadingQuizViewProps
  // 语法填空答题视图 props
  grammar: ReadingQuizViewProps
  // 成绩单视图 props
  result: ReadingResultViewProps
}

export default function ReadingPageViews({
  view,
  toast,
  reading,
  quiz,
  grammar,
  result,
}: ReadingPageViewsProps) {
  return (
    <>
      {/* 标题 */}
      <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100 md:text-3xl">
        {reading.article.title}
      </h1>

      {/* 视图切换：reading / quiz / grammar_quiz / result */}
      {view === 'reading' ? (
        <ReadingArticleView {...reading} />
      ) : view === 'quiz' ? (
        <ReadingQuizView {...quiz} />
      ) : view === 'grammar_quiz' ? (
        <ReadingQuizView {...grammar} />
      ) : (
        <ReadingResultView {...result} />
      )}

      {/* 阅读记录保存失败提示：固定在底部居中，3 秒后自动消失 */}
      {toast && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 rounded-md bg-red-600 px-4 py-2 text-sm text-white shadow-lg dark:bg-red-700">
          {toast}
        </div>
      )}
    </>
  )
}
