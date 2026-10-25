// 添加文章 Modal：手动录入单篇自有文章，支持 AI 补全中文翻译
// - 表单字段与业务逻辑下沉至 hooks/useAddArticleForm 与 components/AddArticleFormFields
// - 本文件仅负责模态框外壳、标题栏与底部操作按钮
import { cn } from '@/shared/utils/cn'
import AddArticleFormFields from './AddArticleFormFields'
import { useAddArticleForm } from '../hooks/useAddArticleForm'

interface AddArticleModalProps {
  // 是否打开
  open: boolean
  // 关闭回调
  onClose: () => void
}

export default function AddArticleModal({ open, onClose }: AddArticleModalProps) {
  const form = useAddArticleForm(open, onClose)

  // open 为 false 时不渲染
  if (!open) return null

  const { saving, canSave, handleSave, handleClose } = form

  return (
    // 遮罩层：点击空白处关闭
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={handleClose}
      role="dialog"
      aria-modal="true"
      aria-label="添加文章"
    >
      {/* Modal 主体：阻止点击事件冒泡 */}
      <div
        className="w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-lg bg-white p-6 shadow-xl dark:bg-gray-800"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 标题栏 */}
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
            添加文章
          </h3>
          <button
            type="button"
            onClick={handleClose}
            className="rounded-md p-1 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-700 dark:hover:text-gray-300"
            aria-label="关闭"
          >
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="h-5 w-5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* 表单字段 */}
        <AddArticleFormFields form={form} />

        {/* 底部操作按钮 */}
        <div className="mt-6 flex justify-end gap-2">
          <button
            type="button"
            onClick={handleClose}
            className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-100 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700"
          >
            取消
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={!canSave}
            className={cn(
              'rounded-md px-4 py-2 text-sm font-medium text-white transition-colors',
              !canSave
                ? 'cursor-not-allowed bg-indigo-400 dark:bg-indigo-400/70'
                : 'bg-indigo-600 hover:bg-indigo-700 dark:bg-indigo-500 dark:hover:bg-indigo-600',
            )}
          >
            {saving ? '保存中…' : '保存'}
          </button>
        </div>
      </div>
    </div>
  )
}
