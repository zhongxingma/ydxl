// 复习列表视图：展示今日待复习队列
// 状态：loading / error / empty / ready
// - loading：骨架文案
// - error：失败重试入口
// - empty：空状态引导（去阅读 / 查看生词本）
// - ready：统计卡片 + 待复习单词列表（按顽固度与逾期排序）
import { Link } from 'react-router-dom'
import type { Word } from '@/shared/types'
import { isOverdue } from '../services/reviewService'
import type { TodayReviewQueueInfo } from '../services/reviewService'
import StabilityBar from '@/shared/components/StabilityBar'
import OverdueBadge from './OverdueBadge'
import { formatRelativeTime } from '@/shared/utils/relativeTime'

// 加载状态
export type LoadStatus = 'loading' | 'ready' | 'empty' | 'error'

interface ReviewListViewProps {
  queueInfo: TodayReviewQueueInfo | null
  status: LoadStatus
  errorMsg: string | null
  // 本次会话已复习单词数：> 0 表示用户刚完成过复习，队列清空时应展示"今日复习已完成"
  sessionReviewedCount: number
  onWordClick: (word: Word) => void
  onReload: () => void
}

export default function ReviewListView({
  queueInfo,
  status,
  errorMsg,
  sessionReviewedCount,
  onWordClick,
  onReload,
}: ReviewListViewProps) {
  // 加载中
  if (status === 'loading') {
    return (
      <div className="py-16 text-center text-gray-500 dark:text-gray-400">
        正在加载复习内容...
      </div>
    )
  }

  // 错误状态
  if (status === 'error') {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">单词复习</h1>
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-gray-300 py-16 px-4 text-center dark:border-gray-600">
          <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100">加载失败</h2>
          <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">{errorMsg}</p>
          <button
            type="button"
            onClick={onReload}
            className="mt-6 inline-flex items-center gap-1.5 rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-indigo-700 dark:bg-indigo-500 dark:hover:bg-indigo-600"
          >
            重新加载
          </button>
        </div>
      </div>
    )
  }

  // 空状态
  if (status === 'empty' || !queueInfo || queueInfo.words.length === 0) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">单词复习</h1>
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-gray-300 py-16 px-4 text-center dark:border-gray-600">
          <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-green-100 text-green-500 dark:bg-green-900/30 dark:text-green-300">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="h-8 w-8" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
            </svg>
          </div>
          <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100">
            {sessionReviewedCount > 0
              ? '今日复习已完成 🎉'
              : queueInfo && queueInfo.reachedLimit
                ? '已达每日复习上限'
                : '今天没有待复习的单词'}
          </h2>
          <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
            {sessionReviewedCount > 0
              ? '你已经完成今日所有复习，太棒了！'
              : queueInfo && queueInfo.reachedLimit
                ? '超出上限的单词将延后到明天复习。'
                : '继续保持！去阅读文章积累新单词吧。'}
          </p>
          <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
            <button
              type="button"
              onClick={onReload}
              className="inline-flex items-center gap-1.5 rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-indigo-700 dark:bg-indigo-500 dark:hover:bg-indigo-600"
            >
              刷新列表
            </button>
            <Link
              to="/reading"
              className="inline-flex items-center gap-1.5 rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700"
            >
              去阅读
            </Link>
            <Link
              to="/wordbook"
              className="inline-flex items-center gap-1.5 rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700"
            >
              查看生词本
            </Link>
          </div>
        </div>
      </div>
    )
  }

  const { words, total, limit, reachedLimit } = queueInfo

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">单词复习</h1>

      {/* 统计卡片 */}
      <div className="rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="text-sm text-gray-700 dark:text-gray-300">
            今日待复习{' '}
            <span className="text-lg font-semibold text-indigo-600 dark:text-indigo-400">
              {total}
            </span>
            {' / '}上限{' '}
            <span className="font-medium text-gray-700 dark:text-gray-300">{limit}</span>
          </div>
          {reachedLimit && (
            <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2.5 py-0.5 text-xs font-medium text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="h-3.5 w-3.5" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z" />
              </svg>
              已达每日复习上限
            </span>
          )}
        </div>
        <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
          列表按"顽固词优先 + 逾期越久越优先"排序，点击单词进入五步复习。
        </p>
      </div>

      {/* 待复习单词列表 */}
      <ul className="space-y-2">
        {words.map((word) => {
          const stubborn = (word.stubbornCount ?? 0) >= 3
          const overdue = isOverdue(word)
          return (
            <li key={word.id}>
              <button
                type="button"
                onClick={() => onWordClick(word)}
                className="w-full rounded-lg border border-gray-200 bg-white p-4 text-left transition-colors hover:border-indigo-400 hover:bg-indigo-50/30 focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:border-gray-700 dark:bg-gray-800 dark:hover:border-indigo-500 dark:hover:bg-indigo-900/20"
              >
                {/* 头部：单词 + 音标 + 徽章 */}
                <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                  <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                    {word.word}
                  </h3>
                  {word.phonetic && (
                    <span className="text-sm text-gray-500 dark:text-gray-400">
                      {word.phonetic}
                    </span>
                  )}
                  <div className="ml-auto flex flex-wrap items-center gap-1.5">
                    <OverdueBadge show={overdue} />
                    {stubborn && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-purple-50 px-2 py-0.5 text-xs font-medium text-purple-700 dark:bg-purple-900/30 dark:text-purple-300">
                        顽固
                      </span>
                    )}
                  </div>
                </div>

                {/* 释义 */}
                {word.definition && (
                  <p className="mt-1 line-clamp-2 text-sm text-gray-700 dark:text-gray-300">
                    {word.pos && (
                      <span className="mr-1 text-gray-500 dark:text-gray-400">{word.pos}.</span>
                    )}
                    {word.definition}
                  </p>
                )}

                {/* 稳固度进度条 */}
                <div className="mt-2">
                  <StabilityBar score={word.stabilityScore ?? 0} showLabel={false} />
                </div>

                {/* 下次复习时间 */}
                <p className="mt-1.5 text-xs text-gray-500 dark:text-gray-400">
                  下次复习：{formatRelativeTime(word.nextReview)}
                </p>
              </button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
