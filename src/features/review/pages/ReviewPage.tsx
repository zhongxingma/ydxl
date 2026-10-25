// 单词复习页 - 待复习列表 + 五步流程集成视图
// 视图状态机：
//   'list'     - 待复习列表（默认）：展示今日待复习队列，按紧急度排序
//   'review'   - 五步流程视图：识记 → 朗读 → 练习 → 拼写 → 默写
//   'complete' - 完成评价弹窗：用户主观反馈"已掌握"/"还需复习"，调用 applyWeightedReviewResult
//
// 页面仅负责三视图路由与共享 overlay；状态机与副作用见 hooks/useReviewPage，
// 进度条见 components/ReviewProgressHeader。
import Celebration from '@/shared/components/Celebration'
import { AchievementUnlockToast } from '@/features/stats'
import ReviewListView from '../components/ReviewListView'
import ReviewSessionView from '../components/ReviewSessionView'
import ReviewCompleteView from '../components/ReviewCompleteView'
import ReviewProgressHeader from '../components/ReviewProgressHeader'
import { useReviewPage } from '../hooks/useReviewPage'

export default function ReviewPage() {
  const {
    view,
    queueInfo,
    status,
    errorMsg,
    celebrating,
    celebrationText,
    unlockedAchievements,
    setUnlockedAchievements,
    sessionReviewedCount,
    currentWord,
    currentStep,
    unlockedSteps,
    completedSteps,
    reviewQueue,
    goToStep,
    initialTotal,
    reviewProgress,
    isReviewComplete,
    stageLabel,
    loadList,
    handleWordClick,
    handleComplete,
    handleBackToList,
    handleRating,
    handleCelebrationComplete,
  } = useReviewPage()

  return (
    <div className="space-y-4 pb-8">
      {/* 庆祝动画覆盖层（fixed 定位，不参与下方布局） */}
      <Celebration
        visible={celebrating}
        onComplete={handleCelebrationComplete}
        text={celebrationText}
      />

      {/* 成就解锁 Toast：本次新解锁时弹出，3 秒后自动关闭 */}
      <AchievementUnlockToast
        achievements={unlockedAchievements}
        onClose={() => setUnlockedAchievements([])}
      />

      {/* 复习进度条：sticky 顶部，仅在有待复习内容时显示 */}
      {initialTotal > 0 && (
        <ReviewProgressHeader
          sessionReviewedCount={sessionReviewedCount}
          initialTotal={initialTotal}
          reviewProgress={reviewProgress}
          isReviewComplete={isReviewComplete}
          stageLabel={stageLabel}
        />
      )}

      {view === 'list' && (
        <ReviewListView
          queueInfo={queueInfo}
          status={status}
          errorMsg={errorMsg}
          sessionReviewedCount={sessionReviewedCount}
          onWordClick={handleWordClick}
          onReload={() => void loadList()}
        />
      )}

      {view === 'review' && currentWord && currentStep && (
        <ReviewSessionView
          currentWord={currentWord}
          currentStep={currentStep}
          unlockedSteps={unlockedSteps}
          completedSteps={completedSteps}
          reviewQueue={reviewQueue}
          goToStep={goToStep}
          onBackToList={handleBackToList}
          onComplete={handleComplete}
        />
      )}

      {view === 'complete' && (
        <ReviewCompleteView
          word={currentWord}
          onRating={handleRating}
          onBackToList={handleBackToList}
        />
      )}
    </div>
  )
}
