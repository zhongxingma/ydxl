// 文章内容指纹工具
// 基于标题+正文计算 SHA-256 hash，用于去重判断
//
// 优先使用 Web Crypto API（crypto.subtle.digest，浏览器原生支持，异步）；
// 在 crypto.subtle 不可用的环境（如部分旧版 jsdom 测试环境）回退到同步字符串 hash。
// 两种实现均返回 16 位 hex 字符串，碰撞概率极低，足以满足文章去重需求。

/**
 * 计算文章内容指纹（异步，优先使用 SHA-256）
 * @param title 文章标题
 * @param content 文章正文
 * @returns 16 位 hex 字符串
 */
export async function computeContentHash(
  title: string,
  content: string,
): Promise<string> {
  const text = `${title}\n${content}`.trim().toLowerCase()
  const subtle = globalThis.crypto?.subtle
  // crypto.subtle 可用时使用 SHA-256（生产环境浏览器）
  if (subtle) {
    const data = new TextEncoder().encode(text)
    const hashBuffer = await subtle.digest('SHA-256', data)
    const hashArray = Array.from(new Uint8Array(hashBuffer))
    const hashHex = hashArray
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')
    return hashHex.slice(0, 16)
  }
  // 回退到同步实现（crypto.subtle 不可用环境）
  return computeContentHashSync(title, content)
}

/**
 * 计算文章内容指纹（同步版本，非加密安全，但去重足够）
 * 使用 DJB2 变体字符串 hash，返回 16 位 hex 字符串
 * 仅作为 computeContentHash 的内部回退实现，不对外导出
 * @param title 文章标题
 * @param content 文章正文
 * @returns 16 位 hex 字符串
 */
function computeContentHashSync(
  title: string,
  content: string,
): string {
  const text = `${title}\n${content}`.trim().toLowerCase()
  let hash = 0
  for (let i = 0; i < text.length; i++) {
    const char = text.charCodeAt(i)
    hash = (hash << 5) - hash + char
    hash = hash & hash // 转为 32bit 整数
  }
  // 取绝对值转 hex，左填充到 8 位后截取到 16 位（不足则原样返回）
  return Math.abs(hash).toString(16).padStart(8, '0').slice(0, 16)
}
