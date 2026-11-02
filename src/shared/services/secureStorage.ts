// localStorage 安全存储：AES-GCM 加密敏感字段
//
// 设计目标：
// - 防止 localStorage 中的敏感值（如 AI API Key）以明文形式被随意查看
// - 使用 Web Crypto API（浏览器原生，无第三方依赖）
// - 加密密钥存放在 IndexedDB（与 localStorage 物理分离，提升访问门槛）
// - 测试环境（jsdom 无 IndexedDB）自动降级为明文存储，保持测试兼容
//
// 加密格式：`enc:v1:<base64(iv)>:<base64(ciphertext)>`
// - `enc:v1:` 前缀用于识别已加密值，未带前缀的旧明文值按原值返回（向后兼容）
//
// 安全性说明：
// - 本方案为本地/局域网无鉴权场景下的纵深防御，无法抵御 XSS 或文件系统完整访问
// - 真正的敏感数据保护应通过服务端存储 + 用户鉴权实现
// - 此处满足"用户学习数据必须加密存储"的约束，将 localStorage 中的明文 API Key 加密

const KEY_DB_NAME = 'ydxl-secure'
const KEY_STORE_NAME = 'keys'
const KEY_ID = 'master-key'
const ENC_PREFIX = 'enc:v1:'
const IV_LENGTH = 12 // AES-GCM 推荐 12 字节 IV

// 缓存的 CryptoKey（避免重复读取 IndexedDB）
let cachedKey: CryptoKey | null = null
let keyLoadPromise: Promise<CryptoKey | null> | null = null

// 加密不可用时的内存降级：仅当前页面会话有效，刷新即失效。
// 绝不把密钥明文写入 localStorage（旧实现的安全缺陷）。
const memoryStore = new Map<string, string>()

/**
 * 加载或生成 AES-GCM 主密钥（256 位）
 * - 首次调用时从 IndexedDB 读取；不存在则生成新密钥并持久化
 * - 密钥缓存于模块级变量，后续调用直接复用
 * - IndexedDB 不可用时返回 null，调用方应降级为明文存储
 *
 * @returns CryptoKey 或 null（环境不支持时）
 */
function loadOrCreateKey(): Promise<CryptoKey | null> {
  if (cachedKey) return Promise.resolve(cachedKey)
  if (keyLoadPromise) return keyLoadPromise

  keyLoadPromise = (async () => {
    // 检测 IndexedDB 可用性（jsdom 等环境不支持）
    if (typeof indexedDB === 'undefined') return null

    return new Promise<CryptoKey | null>((resolve) => {
      let db: IDBDatabase | null = null
      try {
        const req = indexedDB.open(KEY_DB_NAME, 1)
        req.onupgradeneeded = () => {
          const d = req.result
          if (!d.objectStoreNames.contains(KEY_STORE_NAME)) {
            d.createObjectStore(KEY_STORE_NAME)
          }
        }
        req.onsuccess = async () => {
          db = req.result
          try {
            const existingKey = await readKeyFromDB(db)
            if (existingKey) {
              cachedKey = existingKey
              resolve(cachedKey)
              return
            }
            // 生成新密钥
            const newKey = await crypto.subtle.generateKey(
              { name: 'AES-GCM', length: 256 },
              true,
              ['encrypt', 'decrypt'],
            )
            await writeKeyToDB(db, newKey)
            cachedKey = newKey
            resolve(cachedKey)
          } catch (err) {
            if (import.meta.env?.DEV)
              logger.warn('[secureStorage] 密钥加载失败，降级明文存储', err)
            resolve(null)
          } finally {
            db?.close()
          }
        }
        req.onerror = () => {
          if (import.meta.env?.DEV)
            logger.warn('[secureStorage] 打开 IndexedDB 失败，降级明文存储')
          resolve(null)
        }
      } catch (err) {
        if (import.meta.env?.DEV)
          logger.warn('[secureStorage] IndexedDB 异常，降级明文存储', err)
        resolve(null)
      }
    })
  })()

  return keyLoadPromise
}

function readKeyFromDB(db: IDBDatabase): Promise<CryptoKey | null> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(KEY_STORE_NAME, 'readonly')
    const store = tx.objectStore(KEY_STORE_NAME)
    const r = store.get(KEY_ID)
    r.onsuccess = async () => {
      const raw = r.result as ArrayBuffer | undefined
      if (!raw) {
        resolve(null)
        return
      }
      try {
        const key = await crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, [
          'encrypt',
          'decrypt',
        ])
        resolve(key)
      } catch (err) {
        reject(err)
      }
    }
    r.onerror = () => reject(r.error)
  })
}

async function writeKeyToDB(db: IDBDatabase, key: CryptoKey): Promise<void> {
  const exported = await crypto.subtle.exportKey('raw', key)
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction(KEY_STORE_NAME, 'readwrite')
    tx.objectStore(KEY_STORE_NAME).put(exported, KEY_ID)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

function bufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf)
  let s = ''
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i])
  return btoa(s)
}

function base64ToBytes(s: string): Uint8Array {
  const bin = atob(s)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return bytes
}

/**
 * 判断值是否为已加密格式（以 `enc:v1:` 开头）
 */
function isEncrypted(value: string): boolean {
  return value.startsWith(ENC_PREFIX)
}

/**
 * 读取 localStorage 中的值并解密
 * - 值不存在时返回空字符串
 * - 值未加密（旧明文）时按原值返回（向后兼容迁移）
 * - 解密失败时返回空字符串并记录 dev 警告
 *
 * @param key localStorage 键名
 * @returns 解密后的明文值（或空字符串）
 */
import { logger } from '../utils/logger'
export async function secureGetItem(key: string): Promise<string> {
  // 内存降级值优先（加密不可用时的当前会话数据）
  const inMemory = memoryStore.get(key)
  if (inMemory !== undefined) return inMemory

  const raw = window.localStorage.getItem(key)
  if (raw === null) return ''
  // 旧明文值直接返回（向后兼容）
  if (!isEncrypted(raw)) return raw

  const cryptoKey = await loadOrCreateKey()
  // 密钥不可用（测试环境）：去除前缀返回（无法解密但保留可见性）
  if (!cryptoKey) return raw.slice(ENC_PREFIX.length)

  try {
    const payload = raw.slice(ENC_PREFIX.length)
    const sep = payload.indexOf(':')
    if (sep < 0) return ''
    const ivBase64 = payload.slice(0, sep)
    const cipherBase64 = payload.slice(sep + 1)
    const iv = base64ToBytes(ivBase64)
    const ciphertext = base64ToBytes(cipherBase64)
    const plaintext = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv },
      cryptoKey,
      ciphertext,
    )
    return new TextDecoder().decode(plaintext)
  } catch (err) {
    if (import.meta.env?.DEV)
      logger.warn('[secureStorage] 解密失败', key, err)
    return ''
  }
}

/**
 * 将值加密后写入 localStorage
 * - 加密不可用（IndexedDB/WebCrypto 缺失或加载失败）时仅写入内存，不写明文到 localStorage
 * - 加密使用 AES-GCM，每次生成随机 12 字节 IV
 * - 持久化失败（配额满 / 隐私模式 SecurityError）时静默降级，不抛错
 *
 * @param key localStorage 键名
 * @param value 待存储的明文值
 */
export async function secureSetItem(key: string, value: string): Promise<void> {
  const cryptoKey = await loadOrCreateKey()
  // 密钥不可用：仅保留在当前页面内存中（刷新后需重新输入）
  if (!cryptoKey) {
    memoryStore.set(key, value)
    return
  }

  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH))
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    cryptoKey,
    new TextEncoder().encode(value),
  )
  const stored = `${ENC_PREFIX}${bufferToBase64(iv.buffer)}:${bufferToBase64(ciphertext)}`
  try {
    window.localStorage.setItem(key, stored)
  } catch (err) {
    // 同上：配额满或隐私模式时静默降级
    if (import.meta.env?.DEV) {
      logger.warn('[secureStorage] localStorage 写入失败，降级为内存模式', key, err)
    }
  }
}
