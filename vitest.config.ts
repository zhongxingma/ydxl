// Vitest 测试框架配置
//
// 复用项目已有的 @vitejs/plugin-react 插件与 @ 路径别名
// 使用 jsdom 环境支持 React 组件测试
//
// 注意：
// - Vitest 会加载项目根目录的 .env 文件到 import.meta.env（Vite 环境文件机制），
//   为保证测试隔离（不受部署配置影响、不真实调用第三方 API），下方 test.env 将
//   AI 供应商相关变量显式清空——业务代码访问这些变量时与未配置时行为一致，
//   由 ai/index.ts 的降级链（localStorage > env > 默认）处理
// - 全局 fetch 在 src/test/setup.ts 中提供 mock，避免 jsdom 不支持真实 fetch
// - globals: true 启用后无需在每个测试文件 import { describe, it, expect }
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import path from 'node:path'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setupIndexedDB.ts', './src/test/setup.ts'],
    include: ['src/**/__tests__/**/*.test.{ts,tsx}'],
    // 清空 .env 注入的 AI 供应商配置，保证测试确定性：
    // - 供应商选择默认 deepseek（不触发 custom 自动检测）
    // - 各 Provider 走直连模式（无代理前缀），端点由各测试显式断言
    // - 密钥均为空，由测试显式传入或断言「未配置」错误
    env: {
      VITE_AI_PROVIDER: '',
      VITE_AI_PROXY_URL: '',
      VITE_DEEPSEEK_API_KEY: '',
      VITE_DEEPSEEK_MODEL: '',
      VITE_OPENAI_API_KEY: '',
      VITE_OPENAI_MODEL: '',
      VITE_QWEN_API_KEY: '',
      VITE_QWEN_MODEL: '',
      VITE_CUSTOM_API_ENDPOINT: '',
      VITE_CUSTOM_MODEL: '',
      VITE_CUSTOM_API_KEY: '',
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  define: {
    // 显式注入 import.meta.env 为空对象，避免业务代码访问未定义变量时报错
    'import.meta.env': '{}',
  },
})
