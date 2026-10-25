// 轻量 i18n Hook：基于 localStorage 持久化语言选择，支持跨标签同步
// 字典通过 JSON import 静态加载（Vite 原生支持），避免运行时网络请求
import { useCallback, useEffect, useState } from 'react'
import zhCN from './locales/zh-CN.json'
import enUS from './locales/en-US.json'

// 支持的语言列表
export type Language = 'zh-CN' | 'en-US'

// 语言 → 字典映射
const dictionaries: Record<Language, Record<string, string>> = {
  'zh-CN': zhCN,
  'en-US': enUS,
}

// localStorage 存储 key（与 SyncStatus.tsx 跨标签同步模式保持一致）
const STORAGE_KEY = 'user-lang'

// 默认语言
const DEFAULT_LANGUAGE: Language = 'zh-CN'

/**
 * 翻译函数：根据当前语言从字典查找 key，支持 {name} 形式参数插值
 * - 找不到 key 时返回 key 字符串本身（便于排查遗漏的文案）
 */
export type TranslateFn = (key: string, params?: Record<string, string | number>) => string

/**
 * 国际化 Hook
 * - 读取 localStorage 'user-lang' 初始化语言（默认 zh-CN）
 * - 监听 storage 事件实现跨标签同步
 * - setLanguage 同步写入 localStorage 并更新状态
 */
export function useTranslation() {
  const [language, setLanguageState] = useState<Language>(() => {
    if (typeof window === 'undefined') return DEFAULT_LANGUAGE
    const stored = localStorage.getItem(STORAGE_KEY) as Language | null
    return stored && dictionaries[stored] ? stored : DEFAULT_LANGUAGE
  })

  // 监听跨标签 localStorage 变化（其他标签页切换语言时同步）
  useEffect(() => {
    const handler = (e: StorageEvent) => {
      if (e.key !== STORAGE_KEY) return
      const lang = e.newValue as Language | null
      if (lang && dictionaries[lang]) {
        setLanguageState(lang)
      }
    }
    window.addEventListener('storage', handler)
    return () => window.removeEventListener('storage', handler)
  }, [])

  // 切换语言：持久化 + 更新状态
  // 持久化失败（配额满 / 隐私模式）时静默降级，state 仍正常更新
  const setLanguage = useCallback((lang: Language) => {
    try {
      localStorage.setItem(STORAGE_KEY, lang)
    } catch (err) {
      if (import.meta.env?.DEV) {
        console.warn('[useTranslation] localStorage 写入失败，降级为内存模式', err)
      }
    }
    setLanguageState(lang)
  }, [])

  // 翻译函数：查字典 + 参数插值
  const t = useCallback<TranslateFn>(
    (key, params) => {
      const template = dictionaries[language][key] ?? key
      if (!params) return template
      return template.replace(/\{(\w+)\}/g, (_, name: string) =>
        String(params[name] ?? ''),
      )
    },
    [language],
  )

  return { t, language, setLanguage }
}
