// 远程 Repository 统一出口（保持既有导入路径不变）
//
// - RemoteRepository / PaginatedResponse：REST CRUD 基类（remoteRepositoryBase）
// - CachedRemoteRepository：服务器为主 + Dexie 离线只读缓存（cachedRemoteRepository）
export { RemoteRepository, type PaginatedResponse } from './remoteRepositoryBase'
export { CachedRemoteRepository } from './cachedRemoteRepository'
