// 打印工作表 Portal：挂载到 body，仅打印时可见（见 index.css @media print）
// 从 ReadingPage 抽出，避免页面同时承担 Portal 生命周期与视图编排。
import { createPortal } from 'react-dom'
import type { Article, Question } from '@/shared/types'
import PrintableWorksheet from './PrintableWorksheet'

interface ReadingPrintPortalProps {
  // 是否打开打印工作表
  open: boolean
  // 当前文章（调用方保证非空）
  article: Article
  // 阅读理解题（可能为空：打印前懒生成失败时降级）
  questions: Question[]
  // 语法填空题（可能为空）
  grammarQuestions: Question[]
  // 打印结束（afterprint / 60s 兜底）后关闭
  onFinished: () => void
}

export default function ReadingPrintPortal({
  open,
  article,
  questions,
  grammarQuestions,
  onFinished,
}: ReadingPrintPortalProps) {
  if (!open) return null
  return createPortal(
    <div className="print-portal">
      <PrintableWorksheet
        article={article}
        questions={questions}
        grammarQuestions={grammarQuestions}
        onFinished={onFinished}
      />
    </div>,
    document.body,
  )
}
