// AES-256-GCM 加密模块单元测试
//
// 测试范围：
// 1. 加密/解密 round-trip
// 2. 相同明文每次加密产生不同密文（随机 IV）
// 3. 向后兼容：旧明文值（无 enc:v1: 前缀）原样返回
// 4. 错误密钥解密失败
// 5. 加密未启用时为 no-op
// 6. null/undefined/空字符串处理
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  encryptField,
  decryptField,
  isEncryptionEnabled,
  setEncryptionKeyForTesting,
} from '../encryption.js'

const TEST_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'
const TEST_KEY_2 = 'fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210'

describe('encryption module', () => {
  afterEach(() => {
    // 恢复到测试前的状态（通常为禁用，因为测试环境未配置 ENCRYPTION_KEY）
    setEncryptionKeyForTesting('')
  })

  describe('加密未启用时（默认状态）', () => {
    beforeEach(() => {
      setEncryptionKeyForTesting('')
    })

    it('isEncryptionEnabled 返回 false', () => {
      expect(isEncryptionEnabled()).toBe(false)
    })

    it('encryptField 原样返回明文', () => {
      expect(encryptField('hello world')).toBe('hello world')
    })

    it('decryptField 原样返回密文（实际为明文）', () => {
      expect(decryptField('hello world')).toBe('hello world')
    })

    it('null/undefined 统一返回 null', () => {
      expect(encryptField(null)).toBe(null)
      expect(encryptField(undefined)).toBe(null)
      expect(decryptField(null)).toBe(null)
      expect(decryptField(undefined)).toBe(null)
    })

    it('空字符串原样返回', () => {
      expect(encryptField('')).toBe('')
      expect(decryptField('')).toBe('')
    })
  })

  describe('加密已启用时', () => {
    beforeEach(() => {
      setEncryptionKeyForTesting(TEST_KEY)
    })

    it('isEncryptionEnabled 返回 true', () => {
      expect(isEncryptionEnabled()).toBe(true)
    })

    it('round-trip：加密后解密返回原始明文', () => {
      const plaintext = '这是用户的私人学习笔记，包含敏感内容'
      const encrypted = encryptField(plaintext)
      expect(encrypted).not.toBe(plaintext)
      expect(encrypted?.startsWith('enc:v1:')).toBe(true)
      const decrypted = decryptField(encrypted as string)
      expect(decrypted).toBe(plaintext)
    })

    it('相同明文每次加密产生不同密文（随机 IV）', () => {
      const plaintext = 'same content'
      const encrypted1 = encryptField(plaintext)
      const encrypted2 = encryptField(plaintext)
      expect(encrypted1).not.toBe(encrypted2)
      // 两者解密后都应得到原始明文
      expect(decryptField(encrypted1 as string)).toBe(plaintext)
      expect(decryptField(encrypted2 as string)).toBe(plaintext)
    })

    it('密文格式正确：enc:v1:<iv>:<authTag>:<ciphertext> 四段', () => {
      const encrypted = encryptField('test') as string
      const parts = encrypted.split(':')
      // enc, v1, iv, authTag, ciphertext = 5 段（前缀含一个冒号）
      // 实际格式 `enc:v1:<base64(iv)>:<base64(authTag)>:<base64(ciphertext)>`
      // split(':') 后：['enc', 'v1', '<iv>', '<authTag>', '<ciphertext>']
      expect(parts).toHaveLength(5)
      expect(parts[0]).toBe('enc')
      expect(parts[1]).toBe('v1')
    })

    it('向后兼容：旧明文值（无 enc:v1: 前缀）原样返回', () => {
      const legacyPlaintext = 'legacy note without encryption'
      expect(decryptField(legacyPlaintext)).toBe(legacyPlaintext)
    })

    it('错误密钥解密失败，返回空字符串', () => {
      const encrypted = encryptField('secret note') as string
      // 切换到错误密钥
      setEncryptionKeyForTesting(TEST_KEY_2)
      const decrypted = decryptField(encrypted)
      expect(decrypted).toBe('')
    })

    it('密文被篡改时解密失败（authTag 校验）', () => {
      const encrypted = encryptField('original') as string
      // 篡改密文最后一个字符
      const tampered = encrypted.slice(0, -1) + (encrypted.slice(-1) === 'a' ? 'b' : 'a')
      const decrypted = decryptField(tampered)
      expect(decrypted).toBe('')
    })

    it('null/undefined 返回 null（不加密）', () => {
      expect(encryptField(null)).toBe(null)
      expect(encryptField(undefined)).toBe(null)
    })

    it('空字符串原样返回（不加密）', () => {
      expect(encryptField('')).toBe('')
    })

    it('支持任意长度 passphrase 密钥（通过 SHA-256 派生）', () => {
      setEncryptionKeyForTesting('my-simple-passphrase')
      const plaintext = 'note with passphrase-derived key'
      const encrypted = encryptField(plaintext)
      const decrypted = decryptField(encrypted as string)
      expect(decrypted).toBe(plaintext)
    })

    it('Unicode 字符 round-trip 正确', () => {
      const plaintext = '学习笔记：emoji 🎯 中文English mixed content'
      const encrypted = encryptField(plaintext) as string
      const decrypted = decryptField(encrypted)
      expect(decrypted).toBe(plaintext)
    })
  })
})
