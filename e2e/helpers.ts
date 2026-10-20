// E2E 测试辅助：API 拦截 fixture + 登录辅助 + IndexedDB 预置数据
//
// 技术路线（前端级 + API 拦截）：
// - Playwright 驱动真实浏览器访问 vite dev server（5173），
//   所有 /api 请求由 page.route() 在网络层拦截并返回预置 fixture，不启动真实后端；
// - AI 代理端点（/api/v1/ai-proxy/**）统一返回 404：4xx 不触发指数退避重试，
//   provider 双层降级秒级失败，用于验证 AI 不可用时前端的错误提示与降级路径；
// - 离线路径完全依赖 Dexie（IndexedDB）本地缓存：dev 模式不生成 Service Worker，
//   离线模拟使用 context.setOffline(true)（navigator.onLine=false + offline 事件）。
import type { BrowserContext, Page, Route } from '@playwright/test'

// ---------------------------------------------------------------------------
// Fixture 数据
// ---------------------------------------------------------------------------

const NOW = Date.now()

// 测试文章。注意：vocabulary 必须为「增强版」（每条都含 exampleSentence /
// exampleSentenceTranslation / emojiHint 三字段，值可为空串但不能缺省），
// vocabularyService 检测到增强版后会短路 AI 调用直接渲染，
// 避免 E2E 中出现「重点词汇生成失败」提示条干扰断言。
export const E2E_ARTICLE = {
  id: 'e2e-article-1',
  title: 'The Bright Night Sky',
  content: [
    'Last summer, I camped on a mountain with my family. At night, the sky was full of luminous stars. They looked like tiny lamps hanging far above us.',
    'My father told me that some animals, such as fireflies, can make light by themselves. We watched the luminous moon rise slowly over the trees, and the whole valley lit up.',
    'That night I learned that light can come from the sky as well as from our lamps. Nature has its own way of shining.',
  ].join('\n\n'),
  translation: [
    '去年夏天，我和家人在山上露营。夜晚，天空中满是发光的星星，它们像挂在高远处的小灯。',
    '爸爸告诉我，有些动物（比如萤火虫）能自己发光。我们看着发光的月亮慢慢爬上树梢，整个山谷都被照亮了。',
    '那一晚我明白，光不仅来自灯，也来自天空。大自然有自己的发光方式。',
  ].join('\n\n'),
  genre: 'narrative',
  wordCount: 85,
  createdAt: NOW,
  updated_at: NOW,
  readAt: null,
  startedAt: null,
  phrases: [
    {
      phrase: 'light up',
      meaning: '点亮；照亮',
      example: 'The moon lit up the whole valley.',
      exampleTranslation: '月亮照亮了整个山谷。',
    },
    {
      phrase: 'by oneself',
      meaning: '独自；靠自己',
      example: 'Some animals can make light by themselves.',
      exampleTranslation: '有些动物能自己发光。',
    },
  ],
  vocabulary: [
    {
      word: 'luminous',
      phonetic: '/ˈluːmɪnəs/',
      pos: 'adj',
      definition: '发光的，明亮的',
      example: 'The luminous moon rose over the trees.',
      importance: 'high',
      exampleTranslation: '发光的月亮在树梢升起。',
      exampleSentence: 'The luminous stars hung above the valley.',
      exampleSentenceTranslation: '发光的星星悬挂在山谷上空。',
      emojiHint: ['🌙', '✨'],
    },
    {
      word: 'firefly',
      phonetic: '/ˈfaɪəflaɪ/',
      pos: 'n',
      definition: '萤火虫',
      example: 'A firefly flashed in the dark grass.',
      importance: 'medium',
      exampleTranslation: '一只萤火虫在黑暗的草丛中闪光。',
      exampleSentence: 'Fireflies danced around our tent.',
      exampleSentenceTranslation: '萤火虫在帐篷周围飞舞。',
      emojiHint: ['🪲', '💡'],
    },
  ],
}

// 预置阅读理解题（seed 进 Dexie questions 表；questionService 本地命中即返回，不调 AI）
export const E2E_QUESTIONS = [
  {
    id: 'e2e-q1',
    updated_at: NOW,
    articleId: 'e2e-article-1',
    type: 'detail',
    stem: 'According to the passage, what did the writer watch rise over the trees?',
    options: ['The luminous moon', 'A red balloon', 'A bright lantern', 'A small airplane'],
    correctIndex: 0,
    explanation: '第二段提到 "We watched the luminous moon rise slowly over the trees"。',
    locationClue: '第二段第二句',
    createdAt: NOW,
  },
  {
    id: 'e2e-q2',
    updated_at: NOW,
    articleId: 'e2e-article-1',
    type: 'detail',
    stem: 'Which animal can make light by itself?',
    options: ['A firefly', 'A rabbit', 'A horse', 'A dog'],
    correctIndex: 0,
    explanation: '第二段提到 "some animals, such as fireflies, can make light by themselves"。',
    locationClue: '第二段第一句',
    createdAt: NOW,
  },
]

// 预置复习词（seed 进 Dexie words 表）
// - 五字段齐全（phonetic/definition/example 非空）→ 不会触发 enrichWord 的 AI 补全；
// - nextReview: 0（过去时间戳）→ whereBelowOrEqual('nextReview', now) 命中今日复习队列；
// - example 含单词本身 → PracticeStep 的例句填空（fill-blank）题型可正常出题；
// - definition 非空 → def-to-word / word-to-def / listen-choose-def 均可正常出题。
export const E2E_WORD = {
  id: 'luminous',
  word: 'luminous',
  phonetic: '/ˈluːmɪnəs/',
  pos: 'adj',
  definition: '发光的，明亮的',
  example: 'The luminous moon lit up the night sky.',
  mastery: 0,
  nextReview: 0,
  lastReview: 0,
  reviewCount: 0,
  interval: 0,
  easeFactor: 2.5,
  stubbornCount: 0,
  favorite: 0,
  sourceArticleId: 'e2e-article-1',
  createdAt: NOW,
  updated_at: NOW,
}

// ---------------------------------------------------------------------------
// API 拦截
// ---------------------------------------------------------------------------

// repository 列表端点对应的 basePath（GET /api/{base}?limit=1000）。
// 返回空集合是安全的：增量同步只在 remote 记录比本地更新时才覆盖，
// 空 remote 不会冲掉本地缓存（包括测试预置的数据）。
const LIST_BASES = [
  'articles',
  'questions',
  'words',
  'reviews',
  'stats',
  'readingSessions',
  'achievements',
]

// 单个 /api 请求的分发处理（供 page.route 与 context.route 复用）。
// 生产构建 SW 场景：登录后整页跳转即处于 Service Worker 控制下，页面发出的 /api
// 请求会经 SW 透传，page.route() 不拦截 SW 发起的网络请求，必须使用下方
// setupApiFixturesOnContext（context.route 可覆盖 SW 网络请求）。
async function handleApiRequest(route: Route): Promise<void> {
    const req = route.request()
    const method = req.method()
    const { pathname } = new URL(req.url())

    // 1. 登录：返回 sessionStorage 会话所需的 token + user
    //    用户 id 按用户名派生（u-<username>），驱动 authService 的缓存归属检查
    //    （换账号登录清空本地缓存 / 同账号保留）
    if (method === 'POST' && pathname === '/api/auth/login') {
      const body = (req.postDataJSON() ?? {}) as { username?: string }
      const username = body.username ?? 'e2e'
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          token: 'e2e-token',
          user: {
            id: `u-${username}`,
            username,
            displayName: 'E2E 用户',
            role: 'teacher',
          },
        }),
      })
      return
    }

    // 2. AI 代理：一律 404 快速失败（4xx 不触发指数退避重试，provider 秒级降级）
    if (pathname.startsWith('/api/v1/ai-proxy')) {
      await route.fulfill({
        status: 404,
        contentType: 'application/json',
        body: JSON.stringify({ error: { message: 'E2E: AI disabled' } }),
      })
      return
    }

    // 3. 列表端点：返回空集合
    if (method === 'GET' && LIST_BASES.some((b) => pathname === `/api/${b}`)) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ items: [], total: 0, limit: 1000, offset: 0 }),
      })
      return
    }

    // 4. 文章详情：返回 fixture 文章（裸实体，localApi.getById 直接解析）
    if (method === 'GET' && pathname === `/api/articles/${E2E_ARTICLE.id}`) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(E2E_ARTICLE),
      })
      return
    }

    // 5. 写操作：回显请求体（repository 会把响应作为服务器记录写回本地缓存）
    if (method === 'POST' || method === 'PUT') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: req.postData() ?? '{}',
      })
      return
    }
    if (method === 'DELETE') {
      await route.fulfill({ status: 204 })
      return
    }

    // 6. 其余 GET（各类详情查询）：404 触发调用方的本地缓存回退
    await route.fulfill({
      status: 404,
      contentType: 'application/json',
      body: JSON.stringify({ error: { message: 'E2E: not mocked' } }),
    })
}

// 注册 page 级拦截器（dev 模式 E2E 用）
export async function setupApiFixtures(page: Page): Promise<void> {
  await page.route('**/api/**', handleApiRequest)
}

// 注册 context 级拦截器（生产构建 SW 场景：覆盖 SW 透传的网络请求）
export async function setupApiFixturesOnContext(context: BrowserContext): Promise<void> {
  await context.route('**/api/**', handleApiRequest)
}

// ---------------------------------------------------------------------------
// 流程辅助
// ---------------------------------------------------------------------------

// 登录：fixture 后端校验任何账号密码（用户 id 按用户名派生）；
// 成功后应用通过 window.location.assign('/') 跳转
export async function login(page: Page, username = 'e2e-user'): Promise<void> {
  await page.goto('/login')
  await page.fill('#login-username', username)
  await page.fill('#login-password', 'e2e-pass')
  await page.getByRole('button', { name: '登录' }).click()
  await page.waitForURL((u) => u.pathname === '/')
}

// 预置 IndexedDB 数据：
// 1. 先访问生词本页（挂载即触发 getAllLocalFirst → Dexie 打开 ydxl-db 建库，版本 7）；
// 2. 再用原生 indexedDB API 直写目标表（绕过 repository 层，不触发缓存事件）。
// 支持预置 articles / questions / words 三张表（当前 E2E 场景所需）。
export async function seedIndexedDB(
  page: Page,
  table: 'articles' | 'questions' | 'words',
  records: unknown[],
): Promise<void> {
  await page.goto('/wordbook')
  await page.getByRole('heading', { name: '生词本' }).waitFor()
  await page.evaluate(
    async ({ table, records }) => {
      // 等待 Dexie 完成建库（版本 7 才包含全部对象仓库）
      let ready = false
      for (let i = 0; i < 50; i++) {
        const dbs = await indexedDB.databases()
        const db = dbs.find((d) => d.name === 'ydxl-db')
        if (db && (db.version ?? 0) >= 7) {
          ready = true
          break
        }
        await new Promise((r) => setTimeout(r, 100))
      }
      if (!ready) throw new Error('ydxl-db 未就绪（Dexie 建库超时）')

      await new Promise<void>((resolve, reject) => {
        const req = indexedDB.open('ydxl-db')
        req.onerror = () => reject(req.error)
        req.onsuccess = () => {
          const db = req.result
          try {
            const tx = db.transaction(table, 'readwrite')
            const store = tx.objectStore(table)
            for (const rec of records) store.put(rec)
            tx.oncomplete = () => {
              db.close()
              resolve()
            }
            tx.onerror = () => {
              db.close()
              reject(tx.error)
            }
            tx.onabort = () => {
              db.close()
              reject(tx.error)
            }
          } catch (err) {
            db.close()
            reject(err)
          }
        }
      })
    },
    { table, records },
  )
}
