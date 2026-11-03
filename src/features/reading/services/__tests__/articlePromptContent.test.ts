// articlePrompt 内容契约
//
// JSON Schema 样例精简、随机叙事视角注入与生活化题材专属创作简报。
// 由 articlePromptInjection.test.ts 按职责拆分而来，用例内容与断言未改动。

import { articlePrompt } from '@/shared/services/ai/prompts'

describe('articlePrompt JSON Schema 精简', () => {
  it('user message 中 JSON 样例不含 narrative|expository|practical 字符串', () => {
    const { user } = articlePrompt('2024-02-02')
    // 旧样例中 genre 字段含枚举值 narrative|expository|practical，精简后应已移除
    expect(user).not.toContain('narrative|expository|practical')
  })

  it('user message 中 JSON 样例不含 topic 枚举值字符串', () => {
    const { user } = articlePrompt('2024-02-02')
    // 旧样例中 topic 字段含 8 个枚举值用 | 分隔，精简后应已移除
    expect(user).not.toContain('campus|science|culture|biography|travel|sports|technology|nature')
  })

  it('user message 中 JSON 样例不含 difficulty 枚举值字符串', () => {
    const { user } = articlePrompt('2024-02-02')
    // 旧样例中 difficulty 字段含 easy|medium|hard 枚举值，精简后应已移除
    expect(user).not.toContain('easy|medium|hard')
  })

  it('user message 中 JSON 样例字段值为空字符串占位 ""', () => {
    const { user } = articlePrompt('2024-02-02')
    // 精简后所有字符串字段值为空字符串占位
    expect(user).toContain('"title":""')
    expect(user).toContain('"content":""')
    expect(user).toContain('"translation":""')
    expect(user).toContain('"genre":""')
    expect(user).toContain('"topic":""')
    expect(user).toContain('"difficulty":""')
  })

  it('user message 中 JSON 样例数值字段用 0 占位', () => {
    const { user } = articlePrompt('2024-02-02')
    // wordCount 与 lexileRange.min/max 用 0 占位
    expect(user).toContain('"wordCount":0')
    expect(user).toContain('"lexileRange":{"min":0,"max":0}')
  })

  it('user message 中 JSON 样例保留所有字段名与结构', () => {
    const { user } = articlePrompt('2024-02-02')
    // 验证顶层字段名保持完整
    expect(user).toContain('"title"')
    expect(user).toContain('"content"')
    expect(user).toContain('"translation"')
    expect(user).toContain('"genre"')
    expect(user).toContain('"wordCount"')
    expect(user).toContain('"topic"')
    expect(user).toContain('"difficulty"')
    expect(user).toContain('"lexileRange"')
    expect(user).toContain('"highlightedWords"')
    expect(user).toContain('"phrases"')
    // 验证嵌套字段名保持完整
    expect(user).toContain('"phonetic"')
    expect(user).toContain('"pos"')
    expect(user).toContain('"definition"')
    expect(user).toContain('"example"')
    expect(user).toContain('"phrase"')
    expect(user).toContain('"meaning"')
    expect(user).toContain('"exampleTranslation"')
  })

  it('user message 中 JSON 样例不再含中文占位符（如 "英文标题"、"单词"）', () => {
    const { user } = articlePrompt('2024-02-02')
    // 旧样例字段值含中文说明（如 "英文标题"、"中文翻译"、"单词"、"音标"），精简后应已移除
    expect(user).not.toContain('"英文标题"')
    expect(user).not.toContain('"英文正文"')
    expect(user).not.toContain('"中文翻译"')
    expect(user).not.toContain('"词数"')
    expect(user).not.toContain('"单词"')
    expect(user).not.toContain('"音标"')
    expect(user).not.toContain('"词性"')
    expect(user).not.toContain('"释义"')
    expect(user).not.toContain('"例句翻译"')
  })

  it('字段语义说明保持完整（与现行 prompt 演进同步）', () => {
    const { user } = articlePrompt('2024-02-02')
    // 验证字段语义说明（在 JSON 样例之前的上文）保持完整
    // 注：源码 prompt 已新增议论文（argumentative）文体与 nature_theme 题材，断言随之更新
    expect(user).toContain('genre 字段必须使用 narrative / expository / practical / argumentative 之一')
    expect(user).toContain('topic 字段须使用 campus / science / culture / biography / travel / sports / technology / nature / news / self / society / nature_theme / traditional_culture / ai_life / personal_growth 之一')
    expect(user).toContain('difficulty 字段须使用 easy / medium / hard 之一')
    expect(user).toContain('highlightedWords 字段')
    expect(user).toContain('phrases 字段')
  })
})

// ---------- 去模板化：随机叙事视角注入测试 ----------
// 验证 articlePrompt 注入的「叙事视角/开头方式/结尾方式」随机创作风格文案，
// 用于打破 AI 文章模板化/千篇一律
describe('articlePrompt 随机叙事视角注入（去模板化）', () => {
  it('user message 包含随机叙事视角/开头/结尾引导文案', () => {
    const { user } = articlePrompt('2024-02-02')
    expect(user).toContain('叙事视角')
    expect(user).toContain('开头方式')
    expect(user).toContain('结尾方式')
    expect(user).toContain('避免套用固定模板')
  })

  it('system message 保持稳定，不含随机视角动态内容', () => {
    const { system } = articlePrompt('2024-02-02', undefined, undefined, undefined, [
      'campus',
    ])
    expect(system).not.toContain('叙事视角')
    expect(system).not.toContain('开头方式')
    expect(system).not.toContain('结尾方式')
  })

  it('随机视角注入后仍保留 avoidTopics 避免重复提示', () => {
    const { user } = articlePrompt('2024-02-02', undefined, undefined, undefined, [
      'campus',
    ])
    expect(user).toContain('请避免以下最近生成过的主题')
    expect(user).toContain('- campus')
  })
})

// ---------- 生活化题材专属创作简报测试（防套话/防千篇一律） ----------
// 验证 traditional_culture / ai_life / personal_growth 三个新题材
// 在 articlePrompt 中注入专属创作简报，并跳过通用随机叙事视角（避免指令冲突）
describe('articlePrompt 生活化题材专属创作简报', () => {
  it('ai_life 题材注入「一次具体经历」简报并禁用利弊议论文套话', () => {
    const { user } = articlePrompt('2024-02-02', undefined, 'ai_life')
    expect(user).toContain('题材专属要求（人工智能与生活')
    expect(user).toContain('一次具体经历')
    expect(user).toContain('AI is a double-edged sword')
    // 题材简报锁定叙事形式后不再叠加随机叙事视角（避免矛盾指令）
    expect(user).not.toContain('叙事视角')
  })

  it('traditional_culture 题材注入「给笔友的邮件」简报并禁止节日百科式写法', () => {
    const { user } = articlePrompt('2024-02-02', undefined, 'traditional_culture')
    expect(user).toContain('题材专属要求（中华传统文化')
    expect(user).toContain('外国笔友写一封邮件')
    expect(user).toContain('我参与的过程')
    expect(user).not.toContain('叙事视角')
  })

  it('personal_growth 题材注入「日记 + 具体挫折」简报并禁止大道理结尾', () => {
    const { user } = articlePrompt('2024-02-02', undefined, 'personal_growth')
    expect(user).toContain('题材专属要求（个人成长与真实体验')
    expect(user).toContain('英语日记')
    expect(user).toContain('This experience taught me')
    expect(user).not.toContain('叙事视角')
  })

  it('普通题材不受影响，仍注入随机叙事视角', () => {
    const { user } = articlePrompt('2024-02-02', undefined, 'campus')
    expect(user).not.toContain('题材专属要求')
    expect(user).toContain('叙事视角')
  })

  it('未指定题材时不注入专属简报', () => {
    const { user } = articlePrompt('2024-02-02')
    expect(user).not.toContain('题材专属要求')
    expect(user).toContain('叙事视角')
  })
})

