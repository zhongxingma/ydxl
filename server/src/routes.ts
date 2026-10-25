// REST 路由统一出口
//
// 实现按职责拆分在 ./routes/ 下：
// - shared.ts：表名白名单、认证/权限校验、请求体清洗、私有表前缀映射与序列化
// - tableRouter.ts：通用表路由（私有表隔离 + questions 权限）
// - articlesRouter.ts：共享文章路由（阅读状态按用户合并）
// - wordsBulkRouter.ts：words 批量插入路由
export { TABLES, isTableName, type TableName } from './routes/shared.js'
export { createTableRouter } from './routes/tableRouter.js'
export { createArticlesRouter } from './routes/articlesRouter.js'
export { createWordsBulkRouter } from './routes/wordsBulkRouter.js'
