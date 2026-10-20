// 应用层 AES-256-GCM 加密：用于 SQLite 敏感字段加密存储
//
// 设计目标：
// - 满足"用户学习数据必须加密存储"的约束
// - 不依赖 SQLCipher（需重新编译 better-sqlite3），改用应用层加密
// - 加密在路由层完成：写入前加密、读取后解密，对上层透明
// - better-sqlite3 同步 API，加密也使用同步方法保持一致
//
// 密钥来源：
// - 优先从环境变量 `ENCRYPTION_KEY` 读取（32 字节 hex 字符串或 64 字符以上 passphrase）
// - 未配置时：
//   * 生产环境：fail-fast 抛错拒绝启动（强制配置，避免重启后无法解密旧数据的数据可用性风险）
//   * 开发/测试环境：禁用加密，明文存储（保持现有测试兼容）
//
// 加密格式：`enc:v1:<base64(iv)>:<base64(authTag)>:<base64(ciphertext)>`
// - `enc:v1:` 前缀用于识别已加密值，未带前缀的旧明文值按原值返回（向后兼容迁移）
// - AES-GCM 的 authTag 提供完整性校验，防止密文被篡改
import { createCipheriv, createDecipheriv, randomBytes, createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ENC_PREFIX = 'enc:v1:'
const IV_LENGTH = 12 // AES-GCM 推荐 12 字节 IV
// AES-256 需要 32 字节密钥（由 deriveKey 保证：hex 解析为 32 字节或 SHA-256 派生 32 字节）

// 解析 .env 中的 ENCRYPTION_KEY（与 index.ts 一致：向上两级到项目根目录）
// 注意：这里独立解析而不依赖 index.ts 的 dotenv.config，避免循环依赖与加载顺序问题
function loadEnvKey(): string | undefined {
  // 优先使用已加载的环境变量（生产环境通过系统注入或 dotenv 已加载）
  if (process.env.ENCRYPTION_KEY) return process.env.ENCRYPTION_KEY

  // 开发环境：尝试从 .env 读取（与 index.ts 的 dotenv.config 路径一致）
  try {
    const __dirname = dirname(fileURLToPath(import.meta.url))
    const envPath = resolve(__dirname, '../../.env')
    const content = readFileSync(envPath, 'utf-8')
    const match = content.match(/^ENCRYPTION_KEY\s*=\s*(.+)$/m)
    return match?.[1]?.trim().replace(/^["']|["']$/g, '')
  } catch {
    return undefined
  }
}

const rawKey = loadEnvKey()
const isProduction = process.env.NODE_ENV === 'production'

// 派生 32 字节 AES 密钥：
// - 若 rawKey 为 64 字符 hex 字符串，直接解析为 32 字节
// - 否则使用 SHA-256 派生（兼容任意长度 passphrase）
function deriveKey(raw: string): Buffer {
  // hex 字符串且长度为 64（32 字节 × 2）
  if (/^[0-9a-fA-F]{64}$/.test(raw)) {
    return Buffer.from(raw, 'hex')
  }
  // 其他情况：SHA-256 派生
  return createHash('sha256').update(raw).digest()
}

// 加密是否启用：
// - 配置了 ENCRYPTION_KEY → 启用
// - 未配置且为生产环境 → fail-fast 抛错拒绝启动
// - 未配置且为开发环境 → 禁用（明文存储，保持测试兼容）
let encryptionEnabled = false
let encryptionKey: Buffer | null = null

if (rawKey) {
  encryptionKey = deriveKey(rawKey)
  encryptionEnabled = true
} else if (isProduction) {
  // 生产环境未配置密钥：fail-fast 拒绝启动
  // 避免使用随机临时密钥导致重启后无法解密旧数据的数据可用性风险
  console.error(
    '[encryption] 生产环境必须配置 ENCRYPTION_KEY。请运行 `openssl rand -hex 32` 生成并配置到 .env',
  )
  throw new Error(
    '[encryption] 生产环境必须配置 ENCRYPTION_KEY（缺失会导致重启后无法解密旧数据）',
  )
} else {
  // 开发/测试环境未配置：禁用加密
  encryptionEnabled = false
}

/**
 * 加密是否已启用（配置了 ENCRYPTION_KEY 或处于生产环境）
 * 用于路由层判断是否需要加密/解密
 */
export function isEncryptionEnabled(): boolean {
  return encryptionEnabled
}

/**
 * 测试专用：动态设置加密密钥
 * - 生产代码不应调用此函数，密钥应通过 ENCRYPTION_KEY 环境变量配置
 * - 测试可在 beforeEach 中调用以启用加密，afterEach 中传入空字符串禁用
 *
 * @param rawKey 32 字节 hex 字符串或任意长度 passphrase（通过 SHA-256 派生）
 */
export function setEncryptionKeyForTesting(rawKey: string): void {
  if (process.env.NODE_ENV === 'production') {
    console.warn('[encryption] setEncryptionKeyForTesting 不应在生产环境调用')
    return
  }
  if (!rawKey) {
    encryptionEnabled = false
    encryptionKey = null
    return
  }
  encryptionKey = deriveKey(rawKey)
  encryptionEnabled = true
}

function bufferToBase64(buf: Buffer): string {
  return buf.toString('base64')
}

function base64ToBuffer(s: string): Buffer {
  return Buffer.from(s, 'base64')
}

function isEncrypted(value: unknown): value is string {
  return typeof value === 'string' && value.startsWith(ENC_PREFIX)
}

/**
 * 加密字符串
 * - 加密未启用时返回原值（保持明文）
 * - 输入为 null/undefined 时原样返回
 * - 每次加密生成随机 IV，相同明文产生不同密文
 *
 * @param plaintext 待加密的明文字符串
 * @returns 加密后的字符串（`enc:v1:...` 格式）或原值
 */
export function encryptField(plaintext: string | null | undefined): string | null {
  // null/undefined 统一返回 null（避免 undefined 透传到 better-sqlite3 导致类型不一致）
  if (plaintext === null || plaintext === undefined) return null
  if (!encryptionEnabled || !encryptionKey) return plaintext
  // 空字符串不加密（避免无意义开销）
  if (plaintext === '') return plaintext

  const iv = randomBytes(IV_LENGTH)
  const cipher = createCipheriv('aes-256-gcm', encryptionKey, iv)
  const encrypted = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ])
  const authTag = cipher.getAuthTag()
  return `${ENC_PREFIX}${bufferToBase64(iv)}:${bufferToBase64(authTag)}:${bufferToBase64(encrypted)}`
}

/**
 * 解密字符串
 * - 加密未启用时返回原值
 * - 非 `enc:v1:` 格式时视为旧明文值，原样返回（向后兼容迁移）
 * - 解密失败（authTag 校验失败、密钥错误等）返回空字符串并记录警告
 *
 * @param ciphertext 待解密的字符串
 * @returns 解密后的明文或原值
 */
export function decryptField(ciphertext: string | null | undefined): string | null {
  // null/undefined 统一返回 null（避免 undefined 透传到上层导致类型不一致）
  if (ciphertext === null || ciphertext === undefined) return null
  if (!encryptionEnabled || !encryptionKey) return ciphertext
  if (!isEncrypted(ciphertext)) return ciphertext

  try {
    const payload = ciphertext.slice(ENC_PREFIX.length)
    const parts = payload.split(':')
    if (parts.length !== 3) {
      if (process.env.NODE_ENV !== 'production')
        console.warn('[encryption] 密文格式错误，parts 数量不对')
      return ''
    }
    const [ivB64, authTagB64, dataB64] = parts as [string, string, string]
    const iv = base64ToBuffer(ivB64)
    const authTag = base64ToBuffer(authTagB64)
    const encrypted = base64ToBuffer(dataB64)

    const decipher = createDecipheriv('aes-256-gcm', encryptionKey, iv)
    decipher.setAuthTag(authTag)
    const decrypted = Buffer.concat([
      decipher.update(encrypted),
      decipher.final(),
    ])
    return decrypted.toString('utf8')
  } catch (err) {
    console.warn('[encryption] 解密失败', err)
    return ''
  }
}
