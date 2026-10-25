// statsService 阅读能力趋势
//
// getReadingAbilityTrend 的单日聚合、跨天排序、窗口边界与异常值兜底。
// 由 statsService.test.ts 按职责拆分而来，用例内容与断言未改动。

import { getReadingAbilityTrend } from '../statsService'
import { installMock, restoreMock, makeSession } from './statsServiceTestMocks'

describe('statsService 阅读能力趋势', () => {
  //
  // 验证要点：
  // - 单篇/多篇/跨天/无数据 场景下的聚合
  // - 时间窗口 cutoff 边界（>=，包含边界值）
  // - 缺失字段兜底（correctRate NaN/undefined → 0；wordCount NaN/≤0/undefined → 200；
  //   durationSec NaN/undefined/<0 → 0）
  // - 阅读时长累计
  // - 输出按 date 升序

  // 计算今日本地 00:00 时间戳（与 statsService.getReadingAbilityTrend 内部一致）
  function startOfTodayTs(): number {
    const d = new Date()
    return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0).getTime()
  }

  // 计算今日日期字符串 YYYY-MM-DD（本地时区）
  function todayDateStr(): string {
    const d = new Date()
    const y = d.getFullYear()
    const m = String(d.getMonth() + 1).padStart(2, '0')
    const day = String(d.getDate()).padStart(2, '0')
    return `${y}-${m}-${day}`
  }

  // 计算昨日日期字符串 YYYY-MM-DD（本地时区）
  function yesterdayDateStr(): string {
    const d = new Date()
    d.setDate(d.getDate() - 1)
    const y = d.getFullYear()
    const m = String(d.getMonth() + 1).padStart(2, '0')
    const day = String(d.getDate()).padStart(2, '0')
    return `${y}-${m}-${day}`
  }

  // 20. getReadingAbilityTrend 单篇阅读 → 单日单点聚合
  it('getReadingAbilityTrend 单篇阅读 → 单日单点聚合（score/wordCount/durationSec/count 正确）', async () => {
    const today = todayDateStr()
    const sessions = [
      makeSession('s-1', {
        reviewedAt: startOfTodayTs() + 1000,
        correctRate: 0.8,
        wordCount: 250,
        durationSec: 300,
      }),
    ]
    installMock([], sessions)
    try {
      const trend = await getReadingAbilityTrend(30)
      expect(trend.length).toBe(1)
      expect(trend[0].date).toBe(today)
      expect(trend[0].score).toBeCloseTo(0.8, 3)
      expect(trend[0].wordCount).toBe(250)
      expect(trend[0].durationSec).toBe(300)
      expect(trend[0].count).toBe(1)
    } finally {
      restoreMock()
    }
  })

  // 21. getReadingAbilityTrend 多篇同日 → 平均 score / 累加 wordCount 与 durationSec
  it('getReadingAbilityTrend 多篇同日 → 平均 score 与累加 wordCount/durationSec', async () => {
    const today = todayDateStr()
    const sessions = [
      makeSession('s-1', {
        reviewedAt: startOfTodayTs() + 1000,
        correctRate: 0.8,
        wordCount: 200,
        durationSec: 300,
      }),
      makeSession('s-2', {
        reviewedAt: startOfTodayTs() + 2000,
        correctRate: 1.0,
        wordCount: 300,
        durationSec: 600,
      }),
      makeSession('s-3', {
        reviewedAt: startOfTodayTs() + 3000,
        correctRate: 0.5,
        wordCount: 100,
        durationSec: 120,
      }),
    ]
    installMock([], sessions)
    try {
      const trend = await getReadingAbilityTrend(30)
      expect(trend.length).toBe(1)
      expect(trend[0].date).toBe(today)
      // 平均正确率 (0.8 + 1.0 + 0.5) / 3 ≈ 0.767
      expect(trend[0].score).toBeCloseTo(0.767, 2)
      // 累加字数与时长
      expect(trend[0].wordCount).toBe(600)
      expect(trend[0].durationSec).toBe(1020)
      expect(trend[0].count).toBe(3)
    } finally {
      restoreMock()
    }
  })

  // 22. getReadingAbilityTrend 跨天会话 → 多日数据点按 date 升序
  it('getReadingAbilityTrend 跨天会话 → 多日数据点按 date 升序', async () => {
    const start = startOfTodayTs()
    const yesterday = yesterdayDateStr()
    const today = todayDateStr()
    // 倒序插入，验证返回按 date 升序
    const sessions = [
      makeSession('s-today', {
        reviewedAt: start + 5000,
        correctRate: 1.0,
        wordCount: 250,
        durationSec: 300,
      }),
      makeSession('s-yesterday', {
        reviewedAt: start - 24 * 60 * 60 * 1000 + 5000,
        correctRate: 0.5,
        wordCount: 150,
        durationSec: 200,
      }),
    ]
    installMock([], sessions)
    try {
      const trend = await getReadingAbilityTrend(30)
      expect(trend.length).toBe(2)
      // 升序：昨天在前，今天在后
      expect(trend[0].date).toBe(yesterday)
      expect(trend[1].date).toBe(today)
      // 验证字段正确
      expect(trend[0].score).toBeCloseTo(0.5, 3)
      expect(trend[0].count).toBe(1)
      expect(trend[1].score).toBeCloseTo(1.0, 3)
      expect(trend[1].count).toBe(1)
    } finally {
      restoreMock()
    }
  })

  // 23. getReadingAbilityTrend 无数据 → 空数组
  it('getReadingAbilityTrend 无数据 → 空数组', async () => {
    installMock([], [])
    try {
      const trend = await getReadingAbilityTrend(30)
      expect(trend).toEqual([])
    } finally {
      restoreMock()
    }
  })

  // 24. getReadingAbilityTrend 缺失字段 correctRate（NaN/undefined/越界）→ 兜底 0
  it('getReadingAbilityTrend correctRate NaN/undefined/越界 → 兜底 0 不污染聚合', async () => {
    const today = todayDateStr()
    const sessions = [
      // NaN 正确率
      makeSession('s-1', {
        reviewedAt: startOfTodayTs() + 1000,
        correctRate: NaN,
        wordCount: 200,
        durationSec: 100,
      }),
      // undefined 正确率（通过 as 绕过类型，模拟历史脏数据）
      makeSession('s-2', {
        reviewedAt: startOfTodayTs() + 2000,
        correctRate: undefined as unknown as number,
        wordCount: 200,
        durationSec: 100,
      }),
      // 越界（>1）正确率
      makeSession('s-3', {
        reviewedAt: startOfTodayTs() + 3000,
        correctRate: 5,
        wordCount: 200,
        durationSec: 100,
      }),
      // 负数正确率
      makeSession('s-4', {
        reviewedAt: startOfTodayTs() + 4000,
        correctRate: -0.5,
        wordCount: 200,
        durationSec: 100,
      }),
    ]
    installMock([], sessions)
    try {
      const trend = await getReadingAbilityTrend(30)
      expect(trend.length).toBe(1)
      expect(trend[0].date).toBe(today)
      // 全部兜底为 0/1/0，平均正确率应为 0
      // NaN→0, undefined→0, 5→1（裁剪到 [0,1]）, -0.5→0
      // 平均 = (0 + 0 + 1 + 0) / 4 = 0.25
      expect(trend[0].score).toBeCloseTo(0.25, 3)
      expect(trend[0].count).toBe(4)
      // 字数应为 4 * 200 = 800（无 NaN 污染）
      expect(trend[0].wordCount).toBe(800)
      expect(trend[0].durationSec).toBe(400)
    } finally {
      restoreMock()
    }
  })

  // 25. getReadingAbilityTrend 缺失字段 wordCount（NaN/≤0/undefined）→ 兜底 200
  it('getReadingAbilityTrend wordCount NaN/≤0/undefined → 兜底 200 不产生 NaN', async () => {
    const today = todayDateStr()
    const sessions = [
      // NaN 字数
      makeSession('s-1', {
        reviewedAt: startOfTodayTs() + 1000,
        correctRate: 0.8,
        wordCount: NaN,
        durationSec: 100,
      }),
      // undefined 字数
      makeSession('s-2', {
        reviewedAt: startOfTodayTs() + 2000,
        correctRate: 0.8,
        wordCount: undefined as unknown as number,
        durationSec: 100,
      }),
      // 0 字数
      makeSession('s-3', {
        reviewedAt: startOfTodayTs() + 3000,
        correctRate: 0.8,
        wordCount: 0,
        durationSec: 100,
      }),
      // 负数字数
      makeSession('s-4', {
        reviewedAt: startOfTodayTs() + 4000,
        correctRate: 0.8,
        wordCount: -50,
        durationSec: 100,
      }),
      // 有效字数（应原样累加）
      makeSession('s-5', {
        reviewedAt: startOfTodayTs() + 5000,
        correctRate: 0.8,
        wordCount: 300,
        durationSec: 100,
      }),
    ]
    installMock([], sessions)
    try {
      const trend = await getReadingAbilityTrend(30)
      expect(trend.length).toBe(1)
      expect(trend[0].date).toBe(today)
      // 4 个无效字段兜底为 200，1 个有效为 300，合计 4*200 + 300 = 1100
      expect(trend[0].wordCount).toBe(1100)
      // 不应出现 NaN
      expect(Number.isNaN(trend[0].wordCount)).toBe(false)
      expect(Number.isNaN(trend[0].score)).toBe(false)
    } finally {
      restoreMock()
    }
  })

  // 26. getReadingAbilityTrend cutoff 边界 → 30 天窗口首日 00:00 的会话被包含
  it('getReadingAbilityTrend cutoff 边界 → 30 天窗口首日 00:00 的会话被包含（>=）', async () => {
    const start = startOfTodayTs()
    // 30 天窗口：cutoff = start - 29 * 86400000
    const cutoff = start - 29 * 24 * 60 * 60 * 1000
    // 在 cutoff 时刻恰好有一条会话（应被包含，验证 >= 而非 >）
    const boundarySession = makeSession('s-boundary', {
      reviewedAt: cutoff,
      correctRate: 0.5,
      wordCount: 200,
      durationSec: 100,
    })
    // 比 cutoff 早 1ms 的会话（应被排除）
    const tooOldSession = makeSession('s-too-old', {
      reviewedAt: cutoff - 1,
      correctRate: 1.0,
      wordCount: 200,
      durationSec: 100,
    })
    installMock([], [boundarySession, tooOldSession])
    try {
      const trend = await getReadingAbilityTrend(30)
      // 仅 boundarySession 被包含
      expect(trend.length).toBe(1)
      expect(trend[0].count).toBe(1)
      expect(trend[0].score).toBeCloseTo(0.5, 3)
    } finally {
      restoreMock()
    }
  })

  // 27. getReadingAbilityTrend 超出窗口的会话被过滤
  it('getReadingAbilityTrend 超出窗口的会话被过滤', async () => {
    const start = startOfTodayTs()
    const today = todayDateStr()
    // 30 天前 00:00 之前 1ms 的会话（应被排除）
    const outOfRange = makeSession('s-old', {
      reviewedAt: start - 30 * 24 * 60 * 60 * 1000,
      correctRate: 1.0,
      wordCount: 200,
      durationSec: 100,
    })
    // 今日会话（应被包含）
    const todaySession = makeSession('s-today', {
      reviewedAt: start + 1000,
      correctRate: 0.7,
      wordCount: 250,
      durationSec: 200,
    })
    installMock([], [outOfRange, todaySession])
    try {
      const trend = await getReadingAbilityTrend(30)
      expect(trend.length).toBe(1)
      expect(trend[0].date).toBe(today)
      expect(trend[0].count).toBe(1)
    } finally {
      restoreMock()
    }
  })

  // 28. getReadingAbilityTrend days=1 → 仅今日
  it('getReadingAbilityTrend days=1 → 仅今日窗口', async () => {
    const start = startOfTodayTs()
    const today = todayDateStr()
    const yesterday = yesterdayDateStr()
    // 昨日会话（应被排除）
    const yesterdaySession = makeSession('s-y', {
      reviewedAt: start - 24 * 60 * 60 * 1000 + 1000,
      correctRate: 1.0,
      wordCount: 200,
      durationSec: 100,
    })
    // 今日会话（应被包含）
    const todaySession = makeSession('s-t', {
      reviewedAt: start + 1000,
      correctRate: 0.6,
      wordCount: 180,
      durationSec: 240,
    })
    installMock([], [yesterdaySession, todaySession])
    try {
      const trend = await getReadingAbilityTrend(1)
      expect(trend.length).toBe(1)
      expect(trend[0].date).toBe(today)
      expect(trend[0].count).toBe(1)
      expect(yesterday).not.toBe(today)
    } finally {
      restoreMock()
    }
  })

  // 29. getReadingAbilityTrend 缺失 durationSec → 兜底 0 不污染累加
  it('getReadingAbilityTrend durationSec NaN/undefined/<0 → 兜底 0', async () => {
    const today = todayDateStr()
    const sessions = [
      makeSession('s-1', {
        reviewedAt: startOfTodayTs() + 1000,
        correctRate: 0.8,
        wordCount: 200,
        durationSec: NaN,
      }),
      makeSession('s-2', {
        reviewedAt: startOfTodayTs() + 2000,
        correctRate: 0.8,
        wordCount: 200,
        durationSec: undefined as unknown as number,
      }),
      makeSession('s-3', {
        reviewedAt: startOfTodayTs() + 3000,
        correctRate: 0.8,
        wordCount: 200,
        durationSec: -100,
      }),
      makeSession('s-4', {
        reviewedAt: startOfTodayTs() + 4000,
        correctRate: 0.8,
        wordCount: 200,
        durationSec: 500,
      }),
    ]
    installMock([], sessions)
    try {
      const trend = await getReadingAbilityTrend(30)
      expect(trend.length).toBe(1)
      expect(trend[0].date).toBe(today)
      // 3 个无效兜底为 0，1 个有效为 500，合计 500
      expect(trend[0].durationSec).toBe(500)
      expect(Number.isNaN(trend[0].durationSec)).toBe(false)
    } finally {
      restoreMock()
    }
  })
})
