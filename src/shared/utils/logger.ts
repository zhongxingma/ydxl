// 统一日志封装（前端）
//
// - debug：细粒度诊断信息，仅开发环境输出（生产构建中静默）
// - info / warn / error：始终输出，保证线上可观测性
// - 环境判定依据 import.meta.env.DEV：Vite 生产构建为 false；
//   部分测试环境将 import.meta.env 置为空对象（DEV 为 undefined），此时按开发环境处理
//
// 约定：仅日志模块本身可直接调用 console（见 docs/CODING_STANDARDS.md 日志章节）

const isDev = import.meta.env.DEV !== false

export const logger = {
  debug: (...args: unknown[]): void => {
    if (isDev) console.debug(...args)
  },
  info: (...args: unknown[]): void => {
    console.info(...args)
  },
  warn: (...args: unknown[]): void => {
    console.warn(...args)
  },
  error: (...args: unknown[]): void => {
    console.error(...args)
  },
}
