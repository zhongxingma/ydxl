// 阅读页生命周期副作用：首次/切换文章加载、完成标记、缓存刷新、toast 自动消失与难度选择
//
// 从 ReadingPage 抽离，页面仅保留状态组装与视图渲染。
import { logger } from '../../../shared/utils/logger'
import { useCallback, useEffect, useRef, type MutableRefObject } from 'react'
import type { Article, Difficulty, Topic } from '@/shared/types'
import { useCacheInvalidated } from '@/shared/hooks/useCacheInvalidated'
import { articleService } from '../services/articleService'
import type { ReadingView } from '../store'
import type { LoadStatus } from './useArticleLoader'

interface UseReadingLifecycleOptions {
  articleId: string | null
  article: Article | null
  status: LoadStatus
  view: ReadingView
  toast: string | null
  setToast: (msg: string | null) => void
  loadArticleById: (id: string) => Promise<void>
  loadToday: (difficulty?: Difficulty, topic?: Topic) => Promise<void>
  resetStore: () => void
  setArticle: (article: Article) => void
  setShowDifficultyModal: (open: boolean) => void
  navigate: (path: string) => void
  // 组件挂载状态（供其他 hooks 共用）
  mountedRef: MutableRefObject<boolean>
  // 已标记已读的文章 id，避免重复调用 markAsRead
  markedReadRef: MutableRefObject<string | null>
  // 进行中的 AI 请求中断控制器
  abortControllerRef: MutableRefObject<AbortController | null>
  // 难度选择记忆（错误重试时保持同一选项）
  selectedDifficultyRef: MutableRefObject<Difficulty | undefined>
  selectedTopicRef: MutableRefObject<Topic | undefined>
}

export function useReadingLifecycle({
  articleId,
  article,
  status,
  view,
  toast,
  setToast,
  loadArticleById,
  loadToday,
  resetStore,
  setArticle,
  setShowDifficultyModal,
  navigate,
  mountedRef,
  markedReadRef,
  abortControllerRef,
  selectedDifficultyRef,
  selectedTopicRef,
}: UseReadingLifecycleOptions) {
  // 首次挂载加载：articleId 存在时加载历史文章，否则弹出难度选择弹窗
  // 新阅读模式下由用户选择难度后调用 loadToday(difficulty) 加载文章
  // 依赖 articleId：历史记录跳转 articleId 变化时重新加载对应文章
  useEffect(() => {
    mountedRef.current = true
    if (articleId) {
      void loadArticleById(articleId)
    } else {
      // 新阅读模式：弹出难度选择弹窗，用户选择后再加载文章
      setShowDifficultyModal(true)
    }
    // 组件卸载时重置 store 与挂载标志，避免下次进入仍保留旧状态
    // 同时取消进行中的 AI 请求，避免卸载后继续消耗 token
    return () => {
      mountedRef.current = false
      abortControllerRef.current?.abort()
      resetStore()
    }
  }, [articleId, loadArticleById, resetStore, mountedRef, abortControllerRef, setShowDifficultyModal])

  // 阅读完成（进入 result 视图）时标记文章为已读
  // 通过 ref 避免对同一篇文章重复调用 markAsRead
  useEffect(() => {
    if (view === 'result' && article && markedReadRef.current !== article.id) {
      markedReadRef.current = article.id
      void articleService.markAsRead(article.id)
    }
  }, [view, article, markedReadRef])

  // ---- 缓存事件回调使用的 ref（避免 stale closure 导致历史文章覆盖问题）----
  // useCacheInvalidated 的 callback 通过 callbackRef 每次渲染更新，
  // 但 cache event 可能在两次渲染之间触发（URL 已变但 React 尚未 re-render），
  // 此时闭包中的 article/status/articleId 仍为旧值，会导致重读旧文章并 setArticle 覆盖新文章。
  // 通过 ref 始终读取最新值，彻底消除 stale closure 窗口。
  const articleIdRef = useRef(articleId)
  articleIdRef.current = articleId
  const statusRef = useRef(status)
  statusRef.current = status
  const currentArticleRef = useRef(article)
  currentArticleRef.current = article

  // 订阅 articles 缓存事件：articleRepository 后台刷新完成后重读当前文章
  // SWR 模式下后台刷新可能更新本地缓存（如翻译/短语补充），需重读以刷新 UI
  // 安全策略（全部通过 ref 读取最新值，避免 stale closure）：
  // - 仅在 reading 视图更新，避免干扰 quiz/result 视图状态
  // - 加载中时跳过，避免与 loadToday/loadArticleById 竞态（A→B 切换时重读 A 覆盖 B）
  // - 重读文章 id 必须与当前 article.id 一致（防止期间 article 已被切换）
  // - 重读文章 id 必须与 URL articleId 一致（URL 是源真相）
  // - 仅当 updated_at 更新时才 setArticle（避免 stale 覆盖）
  useCacheInvalidated('articles', () => {
    // 通过 ref 读取最新值，避免 cache event 在渲染间隙触发时读到旧闭包
    const currentArticle = currentArticleRef.current
    const currentStatus = statusRef.current
    const expectedArticleId = articleIdRef.current
    if (!currentArticle || view !== 'reading') return
    if (currentStatus === 'loading') return
    void (async () => {
      try {
        const fresh = await articleService.getArticleById(currentArticle.id)
        if (!mountedRef.current || !fresh) return
        // 再次通过 ref 读取最新值（await 期间状态可能已变化）
        if (fresh.id !== currentArticleRef.current?.id) return
        if (expectedArticleId && fresh.id !== expectedArticleId) return
        if (currentArticleRef.current && fresh.updated_at > currentArticleRef.current.updated_at) {
          setArticle(fresh)
        }
      } catch (err) {
        if (import.meta.env.DEV)
          logger.warn('[ReadingPage] articles 事件重读失败', err)
      }
    })()
  })

  // toast 自动消失：3 秒后清除，cleanup 清除定时器避免内存泄漏
  useEffect(() => {
    if (!toast) return
    const timer = setTimeout(() => setToast(null), 3000)
    return () => clearTimeout(timer)
  }, [toast, setToast])

  // 类型与难度选择确认：关闭弹窗，传入题材与难度加载文章
  const handleDifficultySelect = useCallback((difficulty: Difficulty, topic?: Topic) => {
    selectedDifficultyRef.current = difficulty
    selectedTopicRef.current = topic
    setShowDifficultyModal(false)
    void loadToday(difficulty, topic)
  }, [loadToday, selectedDifficultyRef, selectedTopicRef, setShowDifficultyModal])

  // 难度选择取消：无文章时返回首页，有文章时仅关闭弹窗
  const handleDifficultyCancel = useCallback(() => {
    setShowDifficultyModal(false)
    if (!article) {
      navigate('/')
    }
  }, [article, navigate, setShowDifficultyModal])

  return { handleDifficultySelect, handleDifficultyCancel }
}
