// 复习会话视图：五步流程（识记 → 朗读 → 练习 → 拼写 → 默写）
// - 顶部步骤进度条与导航
// - 提示按钮与提示文案
// - 当前步骤内容（key 在单词切换时强制重新挂载，确保 step 组件状态重置）
import { useEffect, useState } from 'react'
import type { ReviewStep, Word } from '@/shared/types'
import StepIndicator from './StepIndicator'
import HintButton from './HintButton'
import LearnStep from '../steps/LearnStep'
import ReadStep from '../steps/ReadStep'
import PracticeStep from '../steps/PracticeStep'
import SpellStep from '../steps/SpellStep'
import WriteStep from '../steps/WriteStep'
import { STEP_LABEL, STEP_ORDER } from '../types'
import type { StepResult } from '../types'

// 各步骤的提示文案：根据当前步骤动态变化
const STEP_HINTS: Record<ReviewStep, string> = {
  learn: '仔细阅读词根词缀拆解与助记口诀，建立第一印象',
  read: '点击发音按钮跟读，注意音节与重音',
  practice: '仔细审题，排除明显错误的选项',
  spell: '可使用提示按钮查看首尾字母与元音',
  write: '可使用提示按钮查看首尾字母，注意时态与词形',
}

interface ReviewSessionViewProps {
  currentWord: Word
  currentStep: ReviewStep
  unlockedSteps: Set<ReviewStep>
  completedSteps: Set<ReviewStep>
  reviewQueue: Word[]
  goToStep: (step: ReviewStep) => void
  onBackToList: () => void
  onComplete: (step: ReviewStep, result: StepResult) => Promise<void>
}

export default function ReviewSessionView({
  currentWord,
  currentStep,
  unlockedSteps,
  completedSteps,
  reviewQueue,
  goToStep,
  onBackToList,
  onComplete,
}: ReviewSessionViewProps) {
  // 提示按钮已显示标志（每个步骤切换时重置）
  const [hintShown, setHintShown] = useState(false)

  // 步骤切换时重置提示按钮状态
  useEffect(() => {
    setHintShown(false)
  }, [currentStep])

  // 渲染当前步骤内容
  const renderStep = () => {
    const stepProps = {
      word: currentWord,
      onComplete: (result: StepResult) => onComplete(currentStep, result),
    }
    switch (currentStep) {
      case 'learn':
        return <LearnStep {...stepProps} />
      case 'read':
        return <ReadStep {...stepProps} />
      case 'practice':
        // 干扰项来源：复习队列中除当前词外的其他单词
        return (
          <PracticeStep
            {...stepProps}
            distractors={reviewQueue.filter((w) => w.id !== currentWord.id)}
          />
        )
      case 'spell':
        return <SpellStep {...stepProps} />
      case 'write':
        return <WriteStep {...stepProps} />
      default:
        return null
    }
  }

  // 当前步骤序号（1-5）
  const stepIndex = STEP_ORDER.indexOf(currentStep) + 1
  const stepTotal = STEP_ORDER.length
  const stepPercent = Math.round((stepIndex / stepTotal) * 100)

  return (
    <div className="space-y-4 pb-8">
      {/* 页面标题与返回按钮 */}
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">单词复习</h1>
        <button
          type="button"
          onClick={onBackToList}
          className="inline-flex items-center gap-1.5 rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700"
        >
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="h-4 w-4" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5 3 12m0 0 7.5-7.5M3 12h18" />
          </svg>
          返回列表
        </button>
      </div>

      {/* 步骤进度条（1/5 ... 5/5） */}
      <div className="rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
        <div className="mb-1 flex items-center justify-between text-xs">
          <span className="font-medium text-gray-700 dark:text-gray-300">
            步骤 {stepIndex}/{stepTotal} · {STEP_LABEL[currentStep]}
          </span>
          <span className="text-gray-500 dark:text-gray-400">{stepPercent}%</span>
        </div>
        <div
          className="h-2 w-full overflow-hidden rounded-full bg-gray-200 dark:bg-gray-700"
          role="progressbar"
          aria-valuenow={stepIndex}
          aria-valuemin={0}
          aria-valuemax={stepTotal}
        >
          <div
            className="h-full rounded-full bg-gradient-to-r from-blue-500 to-indigo-500 transition-all duration-300 dark:from-blue-400 dark:to-indigo-400"
            style={{ width: `${stepPercent}%` }}
          />
        </div>

        {/* 步骤导航 */}
        <div className="mt-4">
          <StepIndicator
            currentStep={currentStep}
            unlockedSteps={unlockedSteps}
            completedSteps={completedSteps}
            onGoToStep={goToStep}
          />
        </div>
      </div>

      {/* 提示按钮 + 提示文案 */}
      <div className="flex flex-wrap items-center gap-3">
        <HintButton
          onShowHint={() => setHintShown(true)}
          hintShown={hintShown}
          label={`显示提示（${STEP_LABEL[currentStep]}）`}
        />
        {hintShown && (
          <p className="flex-1 text-sm text-gray-600 dark:text-gray-400">
            {STEP_HINTS[currentStep]}
          </p>
        )}
      </div>

      {/* 当前步骤内容（key 在单词切换时强制重新挂载，确保 step 组件状态重置） */}
      <div
        key={currentWord.id}
        className="rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800"
      >
        {renderStep()}
      </div>
    </div>
  )
}
