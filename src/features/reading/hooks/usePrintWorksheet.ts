// 一键打印完整练习：题目未生成时先补齐再打印（生成失败降级打印无题版本）
//
// 注意：不复用「阅读完成」逻辑（含标记已读/切换视图副作用），此处仅生成数据不改视图。
import type { Dispatch, MutableRefObject, SetStateAction } from 'react'
import { useCallback, useState } from 'react'
import type { Article, Question } from '@/shared/types'
import { questionService } from '../services/questionService'

interface UsePrintWorksheetOptions {
  article: Article | null
  questions: Question[]
  grammarQuestions: Question[]
  setQuestions: Dispatch<SetStateAction<Question[]>>
  setGrammarQuestions: Dispatch<SetStateAction<Question[]>>
  mountedRef: MutableRefObject<boolean>
  setToast: Dispatch<SetStateAction<string | null>>
  generatingQuestions: boolean
}

export function usePrintWorksheet({
  article,
  questions,
  grammarQuestions,
  setQuestions,
  setGrammarQuestions,
  mountedRef,
  setToast,
  generatingQuestions,
}: UsePrintWorksheetOptions) {
  // 打印工作表：true 时通过 Portal 挂载 PrintableWorksheet 并自动唤起浏览器打印
  const [printOpen, setPrintOpen] = useState(false)
  // 打印准备中：题目懒生成（点「开始答题」时才调 AI），打印前需先补齐缺失题目
  const [preparingPrint, setPreparingPrint] = useState(false)
  // 打印结束回调（稳定引用，避免 PrintableWorksheet 内 effect 因回调变化重跑）
  const closePrint = useCallback(() => setPrintOpen(false), [])

  const handlePrint = useCallback(async () => {
    if (!article || preparingPrint || generatingQuestions) return
    // 题目均已就绪（或已尝试过生成）：直接打印
    if (questions.length > 0 && grammarQuestions.length > 0) {
      setPrintOpen(true)
      return
    }
    setPreparingPrint(true)
    setToast('正在准备打印（生成练习题中，约需 1 分钟）...')
    try {
      const tasks: Promise<unknown>[] = []
      if (questions.length === 0) {
        tasks.push(
          questionService.getQuestionsForArticle(article).then((qs) => {
            if (mountedRef.current && qs.length > 0) setQuestions(qs)
          }),
        )
      }
      if (grammarQuestions.length === 0) {
        tasks.push(
          questionService.getGrammarFillQuestionsForArticle(article).then((gqs) => {
            if (mountedRef.current && gqs.length > 0) setGrammarQuestions(gqs)
          }),
        )
      }
      const results = await Promise.allSettled(tasks)
      // 组件已卸载则放弃提示（打印打开动作在 finally 中也受 mountedRef 保护）
      if (!mountedRef.current) return
      // 阅读理解题生成失败时提示（语法题失败静默降级，不阻塞打印）
      // questions.length 取闭包生成前的值：为 0 时 tasks[0] 必为阅读题任务
      const readingFailed = questions.length === 0 && results[0]?.status === 'rejected'
      if (readingFailed) {
        setToast('练习题生成失败，仅打印文章内容')
      }
    } catch (err) {
      console.warn('[ReadingPage] 打印前生成练习题失败，降级打印', err)
      if (mountedRef.current) setToast('练习题生成失败，仅打印文章内容')
    } finally {
      if (mountedRef.current) {
        setPreparingPrint(false)
        // 无论生成成功与否都打开打印（失败时打印原文+单词+短语+翻译版本）
        setPrintOpen(true)
      }
    }
  }, [
    article,
    preparingPrint,
    generatingQuestions,
    questions.length,
    grammarQuestions.length,
    setQuestions,
    setGrammarQuestions,
    mountedRef,
    setToast,
  ])

  return { printOpen, preparingPrint, closePrint, handlePrint }
}
