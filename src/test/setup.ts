// Vitest 全局测试环境初始化
//
// - 注册 @testing-library/jest-dom 的 dom matcher（如 toBeInTheDocument）
// - 提供 fetch mock 工具函数（迁移自原 ai-provider.test.ts / ai-proxy-contract.test.ts 中
//   重复实现的 installFetchMock / installFetchMockSequence / restoreFetch / installImmediateSetTimeout）
// - 所有工具在 afterEach 中自动恢复，避免测试间状态泄漏
// - 清空 AI 响应缓存与 Token 统计，避免缓存命中污染测试断言
import '@testing-library/jest-dom/vitest'
import { afterEach } from 'vitest'
import { clearCache } from '@/shared/services/ai/responseCache'
import { resetStats } from '@/shared/services/ai/tokenStats'

// ---------- jsdom 缺失 API 补丁 ----------
// jsdom 未实现 window.scrollTo（虽定义为函数但调用时输出 "Not implemented" 警告），
// 业务代码（如 handleStartQuiz / handleMarkAsRead）调用时会干扰测试输出。
// 这里无条件覆盖为 no-op，仅保持调用语义。
if (typeof window !== 'undefined') {
  window.scrollTo = (() => {}) as typeof window.scrollTo
}

// jsdom 未实现 window.speechSynthesis，导致 WordPopover 等组件在模块加载时
// 计算的 speechSupported 常量为 false，喇叭按钮不渲染。
// 这里提供最小 stub（speak/cancel/pause/resume 均为 no-op），让组件渲染喇叭按钮；
// 具体测试可通过 vi.spyOn(window.speechSynthesis, 'speak') 验证调用。
if (typeof window !== 'undefined' && !('speechSynthesis' in window)) {
  Object.defineProperty(window, 'speechSynthesis', {
    configurable: true,
    value: {
      speak: () => {},
      cancel: () => {},
      pause: () => {},
      resume: () => {},
      getVoices: () => [],
    },
  })
}
// SpeechSynthesisUtterance 构造函数 stub（jsdom 未实现）
if (typeof window !== 'undefined' && !('SpeechSynthesisUtterance' in window)) {
  Object.defineProperty(window, 'SpeechSynthesisUtterance', {
    configurable: true,
    value: class SpeechSynthesisUtterance {
      text: string
      lang: string
      rate: number
      pitch: number
      volume: number
      constructor(text: string) {
        this.text = text
        this.lang = ''
        this.rate = 1
        this.pitch = 1
        this.volume = 1
      }
    },
  })
}

// ---------- fetch mock 工具 ----------

export interface FetchCall {
  url: string
  method: string
  headers: Record<string, string>
  body: string
}

export interface MockResponse {
  ok?: boolean
  status?: number
  statusText?: string
  // 作为 res.json() 的返回值
  json?: unknown
  // 作为 res.text() 的返回值
  text?: string
  // 响应头（供 res.headers.get(name) 读取，如 Retry-After）
  headers?: Record<string, string>
  // 永不 resolve（用于测试超时：依赖 AbortController 触发拒绝）
  neverResolve?: boolean
}

// 保存原始 fetch，便于测试后恢复
const originalFetch = globalThis.fetch

// 构造 AbortError（与浏览器/Node 原生 fetch abort 行为一致）
function makeAbortError(): Error {
  const err = new Error('The operation was aborted')
  err.name = 'AbortError'
  return err
}

// 将 MockResponse 构造为 Response 对象（含 signal 监听）
// signal 被 abort 时 reject AbortError，模拟真实 fetch 行为
function buildMockResponse(
  response: MockResponse,
  signal?: AbortSignal | null
): Promise<Response> {
  return new Promise((resolve, reject) => {
    if (signal) {
      if (signal.aborted) {
        reject(makeAbortError())
        return
      }
      signal.addEventListener('abort', () => reject(makeAbortError()))
    }
    // 永不 resolve（等待 signal abort 触发 reject）
    if (response.neverResolve) return
    const ok = response.ok ?? true
    const headerEntries = response.headers ?? {}
    const res = {
      ok,
      status: response.status ?? (ok ? 200 : 500),
      statusText: response.statusText ?? (ok ? 'OK' : 'Internal Server Error'),
      text: async () => response.text ?? '',
      json: async () => response.json ?? {},
      headers: {
        get: (name: string) =>
          name in headerEntries ? headerEntries[name] : null,
      },
    } as unknown as Response
    resolve(res)
  })
}

// 安装 fetch mock，返回调用记录数组供断言使用
// 每次 fetch 调用都返回相同的 response（signal-aware）
export function installFetchMock(response: MockResponse): FetchCall[] {
  const calls: FetchCall[] = []
  const mockFetch = async (
    input: RequestInfo | URL,
    init?: RequestInit
  ): Promise<Response> => {
    const url = typeof input === 'string' ? input : input.toString()
    calls.push({
      url,
      method: init?.method ?? 'GET',
      headers: (init?.headers ?? {}) as Record<string, string>,
      body: (init?.body ?? '') as string,
    })
    const signal = (init?.signal ?? null) as AbortSignal | null
    return buildMockResponse(response, signal)
  }
  globalThis.fetch = mockFetch as unknown as typeof fetch
  return calls
}

// 安装序列 fetch mock：每次 fetch 调用依次返回 responses 中的下一个响应
// 用于测试重试场景（第一次失败、第二次成功等）
// 超出 responses 长度时复用最后一个响应
export function installFetchMockSequence(responses: MockResponse[]): FetchCall[] {
  const calls: FetchCall[] = []
  let callIndex = 0
  const mockFetch = async (
    input: RequestInfo | URL,
    init?: RequestInit
  ): Promise<Response> => {
    const url = typeof input === 'string' ? input : input.toString()
    calls.push({
      url,
      method: init?.method ?? 'GET',
      headers: (init?.headers ?? {}) as Record<string, string>,
      body: (init?.body ?? '') as string,
    })
    const response = responses[Math.min(callIndex, responses.length - 1)]
    callIndex++
    const signal = (init?.signal ?? null) as AbortSignal | null
    return buildMockResponse(response, signal)
  }
  globalThis.fetch = mockFetch as unknown as typeof fetch
  return calls
}

// 恢复原始 fetch
export function restoreFetch(): void {
  globalThis.fetch = originalFetch
}

// 将所有 setTimeout 延迟降为 0ms（保持异步 macrotask 语义）
// 用于跳过 30s 超时等待与指数退避等待，加速超时/重试相关测试
// 返回 restore 函数，须在 finally 中调用恢复
export function installImmediateSetTimeout(): () => void {
  const original = global.setTimeout
  global.setTimeout = ((cb: TimerHandler, ...args: unknown[]) => {
    return original(cb as TimerHandler, 0, ...args)
  }) as unknown as typeof setTimeout
  return () => {
    global.setTimeout = original
  }
}

// 每个测试后自动恢复 fetch 与 setTimeout，避免跨用例状态泄漏
// 同时清空 AI 响应缓存与 Token 统计，避免缓存命中污染后续测试断言
afterEach(async () => {
  globalThis.fetch = originalFetch
  try {
    // clearCache 现为 async（迁移 IndexedDB 后），需 await 确保清理完成，
    // 避免跨用例缓存污染（无 IndexedDB 环境内部已兜底，不抛错）
    await clearCache()
  } catch {
    // 测试环境无 localStorage / IndexedDB 时忽略
  }
  try {
    resetStats()
  } catch {
    // 测试环境无 localStorage 时忽略
  }
})
