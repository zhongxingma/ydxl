// server 测试环境 setup：在所有模块导入前设置环境变量
// 确保 db.ts 使用 :memory: 内存数据库，不操作生产数据库文件
// 该文件由 vitest.config.ts 的 setupFiles 加载，在测试模块导入前执行
process.env.NODE_ENV = 'test'
process.env.DB_PATH = ':memory:'
