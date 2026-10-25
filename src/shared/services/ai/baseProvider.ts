// AI Provider 抽象基类聚合出口
//
// 公共逻辑按职责拆分为三层，子类仍只需实现差异化方法：
//   - providerCore.ts：配置、密钥解析、端点解析、缓存与传输委托
//   - providerContentTasks.ts：文章 / 题目 / 语法填空 / 翻译 / 词汇 / 短语
//   - providerWordTasks.ts：单词提示 / 拼读 / 助记 / 例句 / emoji / 连通性测试 / 补全
//
// 子类必须实现：
//   providerName / defaultEndpoint / defaultModel / buildRequestBody / parseContent
export { WordTaskProvider as BaseAIProvider } from './providerWordTasks'
export type { BaseProviderConfig } from './providerCore'
