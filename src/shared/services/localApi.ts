// 本地服务器 REST API 客户端
// 数据落盘策略：服务器为主，前端通过此模块直接读写服务器数据
// 服务器不可达时触发自定义事件，供 UI 层显示离线提示
// ydxl:unauthorized 事件（App 监听后跳转登录页）

import { authHeaders, clearSession } from './authService'

const baseUrl = (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? '/api'

// 请求超时：避免服务器无响应时页面无限等待（登录、CRUD 等全部走此封装）
const REQUEST_TIMEOUT_MS = 15_000

// 当 fetch 发生网络错误时触发自定义事件，供 Layout 组件监听显示离线 banner
function notifyOffline(): void {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('ydxl:offline'))
  }
}

// 会话失效（401）：清除本地会话并广播，App 监听后跳转登录页
function notifyUnauthorized(): void {
  clearSession()
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('ydxl:unauthorized'))
  }
}

// 通用 fetch 包装，处理错误与超时
async function request<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const url = `${baseUrl}${path}`
  // 外部 signal（组件卸载等）与内部超时共用同一个 AbortController
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  const externalSignal = options.signal
  const onExternalAbort = () => controller.abort()
  if (externalSignal) {
    if (externalSignal.aborted) controller.abort()
    else externalSignal.addEventListener('abort', onExternalAbort)
  }

  let response: Response
  try {
    response = await fetch(url, {
      ...options,
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        ...authHeaders(),
        ...options.headers,
      },
    })
  } catch (err) {
    // 可区分三种情况：外部取消（组件卸载）、请求超时、网络不可达
    if (controller.signal.aborted) {
      if (externalSignal?.aborted) {
        throw new Error(`API ${path} 请求已取消`)
      }
      throw new Error(`API ${path} 请求超时（${REQUEST_TIMEOUT_MS / 1000}s）`)
    }
    // 网络错误（服务器不可达）：触发离线提示
    notifyOffline()
    throw new Error(
      `API ${path} 网络请求失败: ${err instanceof Error ? err.message : String(err)}`,
    )
  } finally {
    clearTimeout(timer)
    if (externalSignal) externalSignal.removeEventListener('abort', onExternalAbort)
  }

  // 401 会话失效：清会话 + 广播跳转登录（优先级高于通用错误处理）
  if (response.status === 401) {
    notifyUnauthorized()
    throw new Error(`API ${path} failed: 401 会话已失效，请重新登录`)
  }

  if (!response.ok) {
    // 错误响应体可能非 JSON（如 502 HTML 页面），解析失败时回退到 statusText
    const errorBody = (await response.json().catch((err) => {
      if (import.meta.env.DEV) {
        console.warn(`[localApi] ${path} 错误响应体 JSON 解析失败，回退到 statusText`, err)
      }
      return {}
    })) as { error?: { message?: string }; message?: string }
    // 服务端标准错误体为 { error: { code, message } }；兼容旧的扁平 message
    const message = errorBody.error?.message || errorBody.message || response.statusText
    throw new Error(`API ${path} failed: ${response.status} ${message}`)
  }

  if (response.status === 204) return undefined as T
  return response.json() as Promise<T>
}

export const localApi = {
  /**
   * 发起 GET 请求
   * @param path 请求路径（不含 baseUrl，如 `/articles`）
   * @param options 可选的请求配置（如组件卸载时用于取消请求的 signal）
   * @returns 解析后的响应体
   * @throws 网络错误或服务器返回非 2xx 状态码时抛出 Error
   */
  async get<T>(path: string, options: Pick<RequestInit, 'signal'> = {}): Promise<T> {
    return request<T>(path, options)
  },

  /**
   * 按主键获取单条记录
   * @param path 资源路径（不含 baseUrl，如 `/articles`）
   * @param id 记录主键
   * @returns 匹配的记录；404 时返回 undefined
   * @throws 网络 error 或非 404 的服务器错误时抛出 Error
   */
  async getById<T>(path: string, id: string): Promise<T | undefined> {
    try {
      return await request<T>(`${path}/${id}`)
    } catch (err) {
      // 404 视为未找到，返回 undefined（不抛出）
      if (err instanceof Error && err.message.includes('404')) return undefined
      throw err
    }
  },

  /**
   * 发起 POST 请求创建资源
   * @param path 资源路径（不含 baseUrl，如 `/articles`）
   * @param body 请求体（将被 JSON.stringify）
   * @returns 解析后的响应体
   * @throws 网络错误或服务器返回非 2xx 状态码时抛出 Error
   */
  async post<T>(path: string, body: unknown): Promise<T> {
    return request<T>(path, {
      method: 'POST',
      body: JSON.stringify(body),
    })
  },

  /**
   * 发起 PUT 请求更新资源
   * @param path 资源路径（不含 baseUrl，如 `/articles`）
   * @param id 记录主键
   * @param body 请求体（将被 JSON.stringify）
   * @returns 解析后的响应体
   * @throws 网络错误或服务器返回非 2xx 状态码时抛出 Error
   */
  async put<T>(path: string, id: string, body: unknown): Promise<T> {
    return request<T>(`${path}/${id}`, {
      method: 'PUT',
      body: JSON.stringify(body),
    })
  },

  /**
   * 发起 DELETE 请求删除资源
   * @param path 资源路径（不含 baseUrl，如 `/articles`）
   * @param id 记录主键
   * @throws 网络错误或服务器返回非 2xx 状态码时抛出 Error
   */
  async del(path: string, id: string): Promise<void> {
    await request<void>(`${path}/${id}`, {
      method: 'DELETE',
    })
  },
}
