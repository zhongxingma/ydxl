// 统一日志封装（后端）
//
// - debug：细粒度诊断信息，仅非生产环境输出
// - info / warn / error：始终输出，容器日志（docker logs / journalctl）可采集
//
// 约定：仅日志模块本身可直接调用 console（见 docs/CODING_STANDARDS.md 日志章节）

const isDev = process.env.NODE_ENV !== 'production'

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
