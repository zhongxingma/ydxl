// Vitest 测试环境 IndexedDB 注入
//
// jsdom 未实现 IndexedDB，而业务代码（db.ts 的 Dexie 实例、responseCache 的 aiCache 表）
// 依赖 IndexedDB。此处统一注入 fake-indexeddb（内存实现），并作为 setupFiles 的第一项，
// 确保在任何业务模块（尤其是 @/shared/services/db）被 import 之前完成注入。
//
// 关键：必须依赖 setupFiles 的执行顺序（见 vitest.config.ts 中置于 setup.ts 之前）。
// ES module 的 import 会被静态提升，若在本文件或其他模块主体代码中注入会晚于
// Dexie 实例化（import { db } 时已 `new YdxlDatabase()`），导致 MissingAPIError。
import { indexedDB as fakeIndexedDB, IDBKeyRange as fakeIDBKeyRange } from 'fake-indexeddb'

if (!('indexedDB' in globalThis)) {
  Object.defineProperty(globalThis, 'indexedDB', {
    value: fakeIndexedDB,
    configurable: true,
    writable: true,
  })
}
if (!('IDBKeyRange' in globalThis)) {
  Object.defineProperty(globalThis, 'IDBKeyRange', {
    value: fakeIDBKeyRange,
    configurable: true,
    writable: true,
  })
}