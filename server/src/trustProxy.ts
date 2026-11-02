// 反向代理信任配置解析与生产环境强校验
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

export interface TrustProxyResolution {
  // 传给 app.set('trust proxy', ...) 的值；undefined 表示不设置
  setting: TrustProxySetting
  // 生产环境未显式配置时的阻断错误（启动即失败）
  error?: string
  // 非生产环境未配置时的提示（不阻断启动）
  warning?: string
}

/**
 * 解析 TRUST_PROXY 并执行生产环境强校验
 *
 * 背景（R5）：反代后未配置时 req.ip 恒为反代地址，IP 维度限流会全站共享、
 * 审计日志 IP 失真；此前仅靠部署文档提醒，容易被漏配。
 * 强校验规则：生产环境必须显式声明部署形态——
 * - 反代部署：TRUST_PROXY=1（单层）或 2（CDN + Nginx 两层）
 * - 直连部署：TRUST_PROXY=false（明确不信任 X-Forwarded-For）
 * 未配置时拒绝启动，避免带着错误配置静默上线。
 *
 * @param raw TRUST_PROXY 原始值
 * @param nodeEnv NODE_ENV（production 时执行强校验）
 * @returns 解析结果与校验结论
 */
export function resolveTrustProxy(
  raw: string | undefined,
  nodeEnv: string | undefined,
): TrustProxyResolution {
  const setting = parseTrustProxy(raw)
  if (raw?.trim()) return { setting }
  if (nodeEnv === 'production') {
    return {
      setting,
      error:
        '生产环境必须显式设置 TRUST_PROXY（反代部署用 1 或代理跳数，直连部署用 false）；' +
        '否则按 IP 的限流会全站共享、审计日志 IP 失真。已拒绝启动。',
    }
  }
  return {
    setting,
    warning:
      '未设置 TRUST_PROXY：req.ip 将取直连地址；若部署在反代之后，请设置 TRUST_PROXY=1',
  }
}
