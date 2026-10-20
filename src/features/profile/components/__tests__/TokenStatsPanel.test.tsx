// TokenStatsPanel 组件单元测试
//
// 覆盖场景：
// 1. 无任何 AI 调用数据时显示「暂无 AI 调用数据」占位
// 2. 仅有 API 调用时渲染「估算成本」区块与 tokens 展示
// 3. 存在本地响应缓存命中时渲染「本地缓存命中」区块与调用数
// 4. 混合 api + 缓存命中调用时命中率计算正确
// 5. 存在 DeepSeek 上下文缓存字段时渲染「DeepSeek 缓存命中」与「估算节省」
// 6. 仅有缓存命中（无 API 调用）时面板有数据（不显示占位）
//
// 环境依赖：
// - setup.ts 的 afterEach 自动调用 resetStats() 清空 token 统计
// - useTranslation 默认使用 zh-CN 字典（无需 mock）
import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { recordUsage, resetStats } from '@/shared/services/ai/tokenStats'
import TokenStatsPanel from '../TokenStatsPanel'

describe('TokenStatsPanel', () => {
  beforeEach(() => {
    // 确保每个测试前统计为空（setup.ts 的 afterEach 仅在测试后清空）
    resetStats()
  })

  // 1. 无任何 AI 调用数据时显示占位
  it('无 AI 调用数据时显示「暂无 AI 调用数据」占位', () => {
    render(<TokenStatsPanel />)
    expect(screen.getByText('暂无 AI 调用数据')).toBeInTheDocument()
  })

  // 2. 仅有 API 调用时渲染「估算成本」区块与 tokens 展示
  it('存在 API 调用时渲染「估算成本」区块与 tokens 数量', () => {
    // 1 次 API 调用：prompt=200 + completion=100 = 300 tokens
    recordUsage(
      'article',
      'deepseek-v4-pro',
      { prompt_tokens: 200, completion_tokens: 100 },
      false
    )

    render(<TokenStatsPanel />)

    // 面板有数据，不显示占位
    expect(screen.queryByText('暂无 AI 调用数据')).not.toBeInTheDocument()
    // 无本地缓存命中，不渲染该区块
    expect(screen.queryByText('本地缓存命中')).not.toBeInTheDocument()
    // 估算成本区块渲染
    expect(screen.getByText('估算成本')).toBeInTheDocument()
    // tokens = 200 + 100 = 300
    expect(screen.getByText(/tokens：300/)).toBeInTheDocument()
  })

  // 3. 存在本地响应缓存命中时渲染「本地缓存命中」区块与调用数
  it('存在缓存命中调用时渲染「本地缓存命中」区块与调用数', () => {
    // 1 次缓存命中（cacheHit=true，source 自动置为 'cache'）
    recordUsage(
      'translation',
      'deepseek-v4-pro',
      { prompt_tokens: 0, completion_tokens: 0 },
      true
    )

    render(<TokenStatsPanel />)

    // 本地缓存命中区块渲染
    expect(screen.getByText('本地缓存命中')).toBeInTheDocument()
    // 命中率 = 1 / 1 = 100.0%
    expect(screen.getByText('100.0%')).toBeInTheDocument()
    // 调用数：cacheHits / totalCalls = 1 / 1
    expect(screen.getByText('1 / 1 calls')).toBeInTheDocument()
  })

  // 4. 混合 api + 缓存命中调用时命中率计算正确
  it('混合 API 与缓存命中调用时命中率按 totalCalls 聚合计算', () => {
    // 1 次 API 调用 + 1 次缓存命中
    recordUsage(
      'article',
      'deepseek-v4-pro',
      { prompt_tokens: 100, completion_tokens: 50 },
      false
    )
    recordUsage(
      'translation',
      'deepseek-v4-pro',
      { prompt_tokens: 0, completion_tokens: 0 },
      true
    )

    render(<TokenStatsPanel />)

    // 命中率 = 1 / 2 = 50.0%
    expect(screen.getByText('50.0%')).toBeInTheDocument()
    // 调用数：cacheHits=1 / totalCalls=2（跨 scenario 聚合）
    expect(screen.getByText('1 / 2 calls')).toBeInTheDocument()
  })

  // 5. 存在 DeepSeek 上下文缓存字段时渲染「DeepSeek 缓存命中」与「估算节省」
  it('存在 prompt_cache_hit/miss 字段时渲染「DeepSeek 缓存命中」与「估算节省」', () => {
    // hit=120 / miss=80 → hitRate=60%；savings = 120 × (3 - 0.025) / 1e6 = 0.000357 元
    recordUsage(
      'article',
      'deepseek-v4-pro',
      {
        prompt_tokens: 200,
        completion_tokens: 100,
        prompt_cache_hit_tokens: 120,
        prompt_cache_miss_tokens: 80,
      },
      false
    )

    render(<TokenStatsPanel />)

    // DeepSeek 缓存命中区块渲染
    expect(screen.getByText('DeepSeek 缓存命中')).toBeInTheDocument()
    // hitRate = 120 / (120 + 80) = 60.0%
    expect(screen.getByText('60.0%')).toBeInTheDocument()
    // 估算节省区块渲染
    expect(screen.getByText(/估算节省/)).toBeInTheDocument()
  })

  // 6. 仅有缓存命中（无 API token 消耗）时面板有数据
  it('仅有缓存命中调用时面板显示数据（不显示占位）', () => {
    // 仅 1 次缓存命中：prompt/completion 均为 0，但 totalCalls > 0 使 hasAnyData=true
    recordUsage(
      'translation',
      'deepseek-v4-pro',
      { prompt_tokens: 0, completion_tokens: 0 },
      true
    )

    render(<TokenStatsPanel />)

    // 不显示「暂无数据」占位
    expect(screen.queryByText('暂无 AI 调用数据')).not.toBeInTheDocument()
    // 显示本地缓存命中区块
    expect(screen.getByText('本地缓存命中')).toBeInTheDocument()
  })
})
