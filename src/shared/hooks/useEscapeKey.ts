// 通用 Escape 键监听 hook
// 用于 Modal / Drawer / Popover 等浮层组件，按 Escape 关闭
//
// 抽取自 AddWordModal / ImportWordsModal / AddArticleModal / ImportArticlesModal /
// NoteEditor / WordbookPage actionMenu 中的重复实现
//
// 用法：
//   useEscapeKey(handleClose, open)        // open 为 true 时监听 Escape
//   useEscapeKey(handleClose)              // 默认启用（适用于始终监听的场景）
//
// 内部使用 useEffect + addEventListener('keydown')，cleanup 时自动 removeEventListener
import { useEffect } from 'react'

/**
 * 监听 Escape 键并触发回调
 *
 * @param callback 按 Escape 时触发的回调（通常为关闭浮层）
 * @param enabled 是否启用监听，默认 true。false 时不绑定监听（用于 open=false 时跳过）
 */
export function useEscapeKey(callback: () => void, enabled: boolean = true): void {
  useEffect(() => {
    if (!enabled) return
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        callback()
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
    }
    // callback 通常为 useCallback 稳定引用；enabled 为 boolean 基本类型
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [callback, enabled])
}
