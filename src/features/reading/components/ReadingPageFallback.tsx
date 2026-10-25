// 阅读页加载 / 错误兜底视图（骨架屏与重试入口）

// 加载骨架屏：标题、标签、正文行占位 + 阶段提示文案
export function ReadingLoadingSkeleton({ stageText }: { stageText: string }) {
  return (
    <div className="space-y-4">
      <div className="h-8 w-2/3 animate-pulse rounded bg-gray-200 dark:bg-gray-700" />
      <div className="flex gap-2">
        <div className="h-5 w-16 animate-pulse rounded bg-gray-200 dark:bg-gray-700" />
        <div className="h-5 w-20 animate-pulse rounded bg-gray-200 dark:bg-gray-700" />
      </div>
      <div className="space-y-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="space-y-2">
            <div className="h-4 w-full animate-pulse rounded bg-gray-200 dark:bg-gray-700" />
            <div className="h-4 w-5/6 animate-pulse rounded bg-gray-200 dark:bg-gray-700" />
            <div className="h-3 w-2/3 animate-pulse rounded bg-gray-100 dark:bg-gray-800" />
          </div>
        ))}
      </div>
      <div className="text-center text-sm text-gray-500 dark:text-gray-400">
        {stageText}
      </div>
    </div>
  )
}

// 错误兜底：展示错误消息 + 重新加载按钮
export function ReadingErrorState({
  message,
  onReload,
}: {
  message: string
  onReload: () => void
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-4 py-16">
      <p className="text-sm text-gray-600 dark:text-gray-400">{message}</p>
      <button
        type="button"
        onClick={onReload}
        className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 dark:bg-indigo-500 dark:hover:bg-indigo-600"
      >
        重新加载
      </button>
    </div>
  )
}
