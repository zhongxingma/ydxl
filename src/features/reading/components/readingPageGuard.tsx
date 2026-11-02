// 阅读页状态守卫：loading / error / 文章数据不完整时返回兜底视图，正常时返回 null
//
// 从 ReadingPage 抽出，页面只需一次调用即可覆盖三种异常状态；
// 独立文件避免与组件文件混导出（react-refresh/only-export-components）。
import { logger } from '../../../shared/utils/logger'
import type { ReactElement, ReactNode } from 'react'
import type { Article } from '@/shared/types'
import type { TranslateFn } from '@/shared/i18n/useTranslation'
import { ReadingErrorState, ReadingLoadingSkeleton } from './ReadingPageFallback'

interface ReadingPageGuardOptions {
  status: 'loading' | 'success' | 'error'
  // 加载阶段文案（由页面按 LoadStage 映射）
  stageText: string
  errorMsg: string | null
  article: Article | null
  reload: () => void
  // 覆盖层（难度选择弹窗等），在兜底视图上方渲染
  overlay?: ReactNode
  // 翻译函数（由调用方组件通过 useTranslation 提供）
  t: TranslateFn
}

export function renderReadingPageGuard({
  status,
  stageText,
  errorMsg,
  article,
  reload,
  overlay,
  t,
}: ReadingPageGuardOptions): ReactElement | null {
  if (status === 'loading') {
    return (
      <>
        {overlay}
        <ReadingLoadingSkeleton stageText={stageText} />
      </>
    )
  }
  if (status === 'error' || !article) {
    return (
      <>
        {overlay}
        <ReadingErrorState message={errorMsg || t('reading.error.load_failed')} onReload={reload} />
      </>
    )
  }
  // 防御性校验：文章核心字段缺失时显示错误 UI，避免渲染时 splitIntoParagraphs(undefined) 抛错
  // 此前"页面渲染异常"崩溃的根因：本地缓存或服务器返回的文章缺少 content 字段
  if (!article.content || typeof article.content !== 'string') {
    logger.error('[ReadingPage] 文章数据不完整：缺少 content 字段', article.id)
    return (
      <>
        {overlay}
        <ReadingErrorState message={t('reading.error.data_incomplete')} onReload={reload} />
      </>
    )
  }
  return null
}
