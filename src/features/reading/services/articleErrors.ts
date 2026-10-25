// 文章服务错误类型
//
// 独立文件避免 articleService 聚合出口与生成/查询子模块之间形成循环依赖。
/**
 * 文章未找到错误
 * 用于 getArticleById 在文章不存在（服务器 404 或本地缓存未命中）时抛出，
 * 便于 UI 层捕获后展示友好提示（如「文章不存在或已被删除」）
 */
export class ArticleNotFoundError extends Error {
  constructor(articleId: string) {
    super(`文章 ${articleId} 不存在`)
    this.name = 'ArticleNotFoundError'
    // 修复 TS 编译为 ES5 时 Error 子类原型链丢失的问题
    Object.setPrototypeOf(this, ArticleNotFoundError.prototype)
  }
}
