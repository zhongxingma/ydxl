// SSE 流式响应解析：逐 chunk 累积 delta.content 与 usage
import { AIError } from './types'

export interface SseStreamResult {
  fullText: string
  usage: unknown
}

/**
 * 读取并解析 SSE 响应流
 *
 * @param body 响应体可读流
 * @param provider 供应商名称（用于错误消息）
 * @param onDelta 增量回调；重试场景可传 undefined 以静默累积
 * @returns 完整文本与流末尾 usage 字段
 * @throws AIError 当上游在流中返回 error 事件时抛出
 */
export async function readSseStream(
  body: ReadableStream<Uint8Array>,
  provider: string,
  onDelta?: (delta: string, fullText: string) => void,
): Promise<SseStreamResult> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let fullText = ''
  let usage: unknown = null

  try {
    // eslint-disable-next-line no-constant-condition -- 流式读取标准模式，退出条件为 reader.read() 返回 done
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      // SSE 事件以双换行分隔，按行处理
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''
      for (const line of lines) {
        const trimmedLine = line.trim()
        if (!trimmedLine.startsWith('data: ')) continue
        const data = trimmedLine.slice(6).trim()
        if (data === '[DONE]') continue
        try {
          const chunk = JSON.parse(data) as {
            choices?: Array<{
              delta?: { content?: string; reasoning_content?: string }
            }>
            usage?: unknown
            error?: { message?: string }
          }
          // 错误事件
          if (chunk.error) {
            throw new AIError(
              `${provider} 流式响应错误：${chunk.error.message ?? '未知错误'}`,
            )
          }
          const delta = chunk.choices?.[0]?.delta?.content ?? ''
          if (delta) {
            fullText += delta
            onDelta?.(delta, fullText)
          }
          // 流末尾 usage 字段（stream_options.include_usage）
          if (chunk.usage) {
            usage = chunk.usage
          }
        } catch (parseErr) {
          // JSON 解析失败：忽略该 chunk（可能是 keep-alive 空行或部分数据）
          if (parseErr instanceof AIError) throw parseErr
          // 普通 JSON 解析错误静默忽略
        }
      }
    }
  } finally {
    reader.releaseLock()
  }

  return { fullText, usage }
}
