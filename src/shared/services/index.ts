// 数据服务统一出口：数据库实例、Repository 实例、远程 API 客户端
export { db } from './db'
export {
  articleRepository,
  questionRepository,
  wordRepository,
  reviewRepository,
  statsRepository,
  readingSessionRepository,
  achievementRepository,
} from './repositories'
export { RemoteRepository, CachedRemoteRepository, type PaginatedResponse } from './remoteRepository'
export { cacheEvents, type CacheTableName } from './cacheEvents'
export { localApi } from './localApi'
export {
  isNotificationSupported,
  getNotificationPermission,
  requestNotificationPermission,
  sendNotification,
  setupDailyReminder,
  type NotificationPermission,
} from './notification'
export {
  getSettings,
  updateSettings,
  resetSettings,
  DEFAULT_USER_SETTINGS,
  type Settings,
  type PronunciationSource,
} from './settings'
export {
  requestPersistentStorage,
  getStorageEstimate,
  isStorageLow,
  cleanupDerivedData,
  enforceArticleLimit,
  enforceQuestionLimit,
  runStorageMaintenance,
  StorageQuotaError,
  type StorageEstimateInfo,
} from './storageManager'
