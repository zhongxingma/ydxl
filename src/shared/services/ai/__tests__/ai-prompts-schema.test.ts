// Prompt JSON Schema 样例精简
//
// 各 Prompt 的 JSON 样例不含枚举值字符串、字段值为空占位，结构与字段名保持完整。
// 由 ai-provider.test.ts 按职责拆分而来，用例内容与断言未改动。

import { questionsPrompt, vocabularyPrompt, wordEnrichPrompt, wordHintPrompt, wordBreakdownPrompt, mnemonicPrompt, emojiHintPrompt } from '../prompts'

describe('JSON Schema 样例精简', () => {
  describe('questionsPrompt', () => {
    it('user message 中 JSON 样例不含 type 枚举值字符串', () => {
      const { user } = questionsPrompt('art-1', 'article content')
      expect(user).not.toContain('main_idea|detail|inference|word_guess')
    })

    it('user message 中 JSON 样例字段值为空字符串占位', () => {
      const { user } = questionsPrompt('art-1', 'article content')
      expect(user).toContain('"id":""')
      expect(user).toContain('"type":""')
      expect(user).toContain('"stem":""')
      expect(user).toContain('"explanation":""')
      expect(user).toContain('"locationClue":""')
      // options 为 4 个空字符串占位
      expect(user).toContain('"options":["","","",""]')
      // correctIndex 为 0 占位
      expect(user).toContain('"correctIndex":0')
    })

    it('user message 中 JSON 样例不再含中文占位符', () => {
      const { user } = questionsPrompt('art-1', 'article content')
      expect(user).not.toContain('"文章id-1"')
      expect(user).not.toContain('"题干"')
      expect(user).not.toContain('"选项A"')
      expect(user).not.toContain('"解析"')
      expect(user).not.toContain('"原文线索"')
    })

    it('user message 中 JSON 样例保留字段名与结构', () => {
      const { user } = questionsPrompt('art-1', 'article content')
      expect(user).toContain('"id"')
      expect(user).toContain('"type"')
      expect(user).toContain('"stem"')
      expect(user).toContain('"options"')
      expect(user).toContain('"correctIndex"')
      expect(user).toContain('"explanation"')
      expect(user).toContain('"locationClue"')
    })
  })

  describe('vocabularyPrompt', () => {
    it('user message 中 JSON 样例不含 importance 枚举值字符串', () => {
      const { user } = vocabularyPrompt('article content')
      expect(user).not.toContain('high|medium|low')
    })

    it('user message 中 JSON 样例字段值为空字符串占位', () => {
      const { user } = vocabularyPrompt('article content')
      expect(user).toContain('"word":""')
      expect(user).toContain('"phonetic":""')
      expect(user).toContain('"pos":""')
      expect(user).toContain('"definition":""')
      expect(user).toContain('"example":""')
      expect(user).toContain('"exampleTranslation":""')
      expect(user).toContain('"importance":""')
    })

    it('user message 中 JSON 样例不再含中文占位符', () => {
      const { user } = vocabularyPrompt('article content')
      expect(user).not.toContain('"单词"')
      expect(user).not.toContain('"音标"')
      expect(user).not.toContain('"词性"')
      expect(user).not.toContain('"释义"')
      expect(user).not.toContain('"例句"')
      expect(user).not.toContain('"例句翻译"')
    })
  })

  describe('wordEnrichPrompt', () => {
    it('user message 中 JSON 样例字段值为空字符串占位', () => {
      const { user } = wordEnrichPrompt('apple')
      expect(user).toContain('"word":""')
      expect(user).toContain('"phonetic":""')
      expect(user).toContain('"pos":""')
      expect(user).toContain('"definition":""')
      expect(user).toContain('"example":""')
      expect(user).toContain('"exampleTranslation":""')
      // phrases 数组中的字段也为空字符串占位
      expect(user).toContain('"phrase":""')
      expect(user).toContain('"meaning":""')
    })

    it('user message 中 JSON 样例不再含中文占位符', () => {
      const { user } = wordEnrichPrompt('apple')
      expect(user).not.toContain('"短语"')
      expect(user).not.toContain('"短语释义"')
      expect(user).not.toContain('"短语例句"')
    })
  })

  describe('wordHintPrompt', () => {
    it('user message 中 JSON 样例字段值为空字符串占位', () => {
      const { user } = wordHintPrompt('apple', '苹果')
      expect(user).toContain('"imageAssociation":""')
      expect(user).toContain('"mnemonic":""')
    })

    it('user message 中 JSON 样例不再含中文占位符', () => {
      const { user } = wordHintPrompt('apple', '苹果')
      expect(user).not.toContain('"图像联想描述"')
      expect(user).not.toContain('"记忆口诀"')
    })
  })

  describe('wordBreakdownPrompt', () => {
    it('user message 中 JSON 样例字段值为空字符串与 0 占位', () => {
      const { user } = wordBreakdownPrompt('apple')
      expect(user).toContain('"phonics":["",""]')
      expect(user).toContain('"syllables":0')
    })

    it('user message 中 JSON 样例不再含中文占位符', () => {
      const { user } = wordBreakdownPrompt('apple')
      // 旧样例中 phonics 数组值为 "音节1"/"音节2"，精简后应为空字符串
      expect(user).not.toContain('"音节1"')
      expect(user).not.toContain('"音节2"')
      // 旧样例 syllables 字段值为 "音节数" 文本占位（非合法 JSON 数字），精简后为 0
      // 注：user message 上文仍含 "该单词的音节数（正整数）" 语义说明，需用 schema 上下文区分
      expect(user).not.toContain('"syllables":音节数')
    })
  })

  describe('mnemonicPrompt', () => {
    it('user message 中 JSON 样例字段值为空字符串占位', () => {
      const { user } = mnemonicPrompt('because', '因为')
      expect(user).toContain('"mnemonic":""')
      expect(user).toContain('"explanation":""')
    })

    it('user message 中 JSON 样例不再含中文占位符', () => {
      const { user } = mnemonicPrompt('because', '因为')
      expect(user).not.toContain('"助记口诀"')
      expect(user).not.toContain('"口诀解释"')
    })
  })

  describe('emojiHintPrompt', () => {
    it('user message 中 JSON 样例字段值为空字符串占位', () => {
      const { user } = emojiHintPrompt('sun', '太阳')
      // 旧样例为 ["emoji1","emoji2"]，精简后为 ["",""]
      expect(user).toContain('["",""]')
    })

    it('user message 中 JSON 样例不再含 emoji1/emoji2 占位符', () => {
      const { user } = emojiHintPrompt('sun', '太阳')
      expect(user).not.toContain('"emoji1"')
      expect(user).not.toContain('"emoji2"')
    })
  })
})
