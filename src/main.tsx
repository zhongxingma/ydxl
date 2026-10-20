import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { requestPersistentStorage, runStorageMaintenance } from './shared/services/storageManager'
import { cleanupExpired } from './shared/services/ai/responseCache'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

// 请求持久化存储，避免浏览器自动清理用户已读文章与生词
void requestPersistentStorage()

// 启动时立即清理上次会话遗留的过期 AI 响应缓存（Task 4.5）
// - cleanupExpired 清理 IndexedDB aiCache 表中的过期条目，开销低
// - 内存缓存在读取时按 TTL 自动清理，无需主动调用
// - 与下方 runStorageMaintenance 区别：后者按存储使用率条件触发，前者为启动时例行清理
void cleanupExpired().catch((err) => {
  console.warn('[main] cleanupExpired 启动清理失败', err)
})

// 延迟 5 秒执行存储维护，避免阻塞首屏渲染
setTimeout(() => {
  void runStorageMaintenance()
}, 5000)
