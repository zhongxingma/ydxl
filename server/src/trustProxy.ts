// 反向代理信任配置解析
//
// 部署在 Nginx / 反向代理之后时，Express 默认看到的 req.ip 是反代地址，
// 会导致按 IP 的限流变成全站共享、审计日志 IP 失真。
// TRUST_PROXY 支持：
// - 不配置 / 空：不信任 X-Forwarded-For（默认，安全）
// - 数字（如 1）：信任最近 N 跳代理
// - true / false：信任全部 / 不信任
// - 其他字符串：交给 Express 解释（如 'loopback' 或 IP 列表）
export type TrustProxySetting = boolean | number | string | undefined

export function parseTrustProxy(raw: string | undefined): TrustProxySetting {
  const value = raw?.trim()
  if (!value) return undefined
  if (value === 'true') return true
  if (value === 'false') return false
  if (/^\d+$/.test(value)) return Number(value)
  return value
}
