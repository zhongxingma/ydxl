import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))

// 禁用文件并行：所有测试共享同一个 SQLite 数据库（测试环境使用 :memory: 内存数据库），
// 并行运行会导致 beforeEach 清理与插入操作互相干扰
// setupFiles 在所有测试模块导入前执行，确保 db.ts 读取到 NODE_ENV=test 与 DB_PATH=:memory:
// 使用绝对路径解析 setup 文件，保证从项目根目录运行 `vitest --config server/vitest.config.ts`
// 时也能正确加载（相对路径会以 cwd 为基准，从项目根运行时找不到 server/src/__tests__/setup.ts）
// 显式 exclude dist 目录：vitest v4 默认 exclude 仅含 node_modules 与 .git，
// 不含 dist/**，会导致 dist/__tests__ 下的编译产物 .test.js 与源文件 .test.ts 重复收集，
// 且 dist/db.js 可能为过期/损坏的构建产物（如 SQL 字符串未闭合）导致测试失败
export default defineConfig({
  test: {
    fileParallelism: false,
    setupFiles: [resolve(__dirname, 'src/__tests__/setup.ts')],
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      '**/cypress/**',
      '**/.{idea,git,cache,output,temp}/**',
      '**/{karma,rollup,webpack,vite,vitest,jest,ava,babel,nyc,cypress,tsup,build,eslint,prettier}.config.*',
    ],
  },
})
