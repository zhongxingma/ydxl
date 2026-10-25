// ReadingPage 测试共用的数据工厂、渲染辅助与 IntersectionObserver mock
//
// 由 ReadingPage.raceAndMarkAsRead.test.tsx 拆分时抽取，
// 供 markAsRead / 竞态保护 / 语法填空选择页三个测试文件共用。

import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import type { Article, Question } from '@/shared/types'
import ReadingPage from '../ReadingPage'

// ---------- 测试数据工厂 ----------

export function makeArticle(overrides: Partial<Article> = {}): Article {
  return {
    id: 'test-id',
    title: '测试文章标题',
    content: '这是文章内容。\n\n第二段内容。',
    translation: '这是翻译。',
    genre: 'narrative',
    wordCount: 100,
    createdAt: Date.now() - 1000 * 60 * 60,
    updated_at: Date.now(),
    topic: 'campus',
    difficulty: 'medium',
    readAt: null,
    ...overrides,
  }
}

export function makeQuestion(overrides: Partial<Question> = {}): Question {
  return {
    id: 'q-1',
    articleId: 'test-id',
    type: 'detail',
    stem: '文章的主旨是什么？',
    options: ['选项一', '选项二', '选项三', '选项四'],
    correctIndex: 0,
    explanation: '解析说明',
    locationClue: '文章内容',
    createdAt: Date.now(),
    updated_at: Date.now(),
    ...overrides,
  }
}

// ---------- 渲染辅助 ----------

export function renderReadingPage(initialEntry = '/reading'): ReturnType<typeof render> {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <Routes>
        <Route path="/reading" element={<ReadingPage />} />
      </Routes>
    </MemoryRouter>,
  )
}

// 新阅读流程辅助：挂载 /reading（无 articleId）后不再自动加载文章，
// 而是先弹出难度选择弹窗，点击「开始阅读」才触发 loadToday（与真实用户路径一致）
export async function startDailyReading(): Promise<void> {
  fireEvent.click(await screen.findByText('开始阅读'))
}

// ---------- IntersectionObserver mock ----------

export class MockIntersectionObserver {
  private cb: IntersectionObserverCallback
  constructor(cb: IntersectionObserverCallback) {
    this.cb = cb
  }
  observe(): void {
    this.cb(
      [{ isIntersecting: true } as unknown as IntersectionObserverEntry],
      this as unknown as IntersectionObserver,
    )
  }
  unobserve(): void {}
  disconnect(): void {}
  takeRecords(): IntersectionObserverEntry[] {
    return []
  }
}

const originalIntersectionObserver = globalThis.IntersectionObserver

export function installIntersectionObserverMock(): void {
  globalThis.IntersectionObserver =
    MockIntersectionObserver as unknown as typeof IntersectionObserver
}

export function restoreIntersectionObserverMock(): void {
  globalThis.IntersectionObserver = originalIntersectionObserver
}
