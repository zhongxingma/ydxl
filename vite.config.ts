import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'

// 在 ESM 中没有 __dirname，使用 fileURLToPath 自行派生
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// ===== AI 模型单一配置源（config/ai-providers.json） =====
// 自定义端点 + 模型 ID 与兜底供应商各自仅在此 JSON 声明一次；Vite 构建通过 define 注入前端变量，
// 服务端（server/src/index.ts 与 ai-proxy.ts）读取同一文件填充 CUSTOM_* 并派生 UPSTREAMS 注册表，
// 从根上消除 .env 中前端 VITE_CUSTOM_* 与服务端 CUSTOM_* 手写两遍导致的不一致。
// ⚠️ 安全：本文件只注入端点 / 模型 / 兜底供应商，**绝不注入任何密钥值**；密钥在 JSON 中仅以
// 「变量名」（keyEnv）声明，实际值只写服务端 .env（CUSTOM_API_KEY / DEEPSEEK_API_KEY 等），不进前端 bundle。
function loadAiProvidersConfig(): {
  custom?: { endpoint?: string; model?: string }
  fallback?: { provider?: string; model?: string }
} {
  try {
    return JSON.parse(
      fs.readFileSync(path.resolve(__dirname, 'config/ai-providers.json'), 'utf-8')
    )
  } catch (err) {
    console.warn('[vite] 读取 config/ai-providers.json 失败，将回退环境变量默认配置', err)
    return {}
  }
}
const aiProvidersConfig = loadAiProvidersConfig()

// 将 JSON 中的端点/模型写回 process.env，使其优先于 .env 中的同名变量。
// 依据 Vite 语义：process.env 中已存在的 VITE_* 最后覆盖 .env 文件解析值，
// 从而保证前端注入的值与服务端（server/src/index.ts）读取同一 JSON 文件，从根上消除重复配置冲突。
// 仅当 JSON 提供非空值且进程环境未显式设置时才覆盖（显式 shell 环境变量仍拥有最高优先级）。
if (aiProvidersConfig.custom?.endpoint && !process.env.VITE_CUSTOM_API_ENDPOINT) {
  process.env.VITE_CUSTOM_API_ENDPOINT = aiProvidersConfig.custom.endpoint
}
if (aiProvidersConfig.custom?.model && !process.env.VITE_CUSTOM_MODEL) {
  process.env.VITE_CUSTOM_MODEL = aiProvidersConfig.custom.model
}

// 兜底 API（自定义 API 失败时切换的备用上游）：provider + model 单一来源，
// 注入 VITE_FALLBACK_AI_PROVIDER / VITE_FALLBACK_MODEL 供前端工厂 buildFallbackProvider 读取
if (aiProvidersConfig.fallback?.provider && !process.env.VITE_FALLBACK_AI_PROVIDER) {
  process.env.VITE_FALLBACK_AI_PROVIDER = aiProvidersConfig.fallback.provider
}
if (aiProvidersConfig.fallback?.model && !process.env.VITE_FALLBACK_MODEL) {
  process.env.VITE_FALLBACK_MODEL = aiProvidersConfig.fallback.model
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    // PWA 插件配置：自动注册 Service Worker，支持离线访问
    VitePWA({
      registerType: 'autoUpdate',
      // PWA 应用清单配置
      manifest: {
        name: '英语学习应用',
        short_name: '英语学习',
        description: '一个用于英语阅读、生词背诵与学习统计的 PWA 应用',
        theme_color: '#4f46e5',
        background_color: '#ffffff',
        display: 'standalone',
        // PWA 图标：any 用于普通场景，maskable 用于 Android 自适应图标（保留 safe-zone）
        icons: [
          {
            src: '/pwa-192.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: '/pwa-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: '/pwa-maskable-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      // workbox 缓存策略：预缓存以下类型的资源
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg}'],
      },
    }),
  ],
  resolve: {
    alias: {
      // 路径别名：@ 指向 src 目录
      '@': path.resolve(__dirname, './src'),
    },
  },
  // 开发服务器代理：将 /api 请求转发到本地 Express 服务器（端口 3001）
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
  build: {
    // 构建目标：ES2020，确保现代浏览器（Chrome/Edge/Firefox/Safari 近 2 年版本）支持
    target: 'es2020',
    // 使用 esbuild 进行压缩，生成更小体积（同时支持现代语法）
    minify: 'esbuild',
    // 生产构建关闭 sourcemap，避免泄露原始源码；如需线上排错可改为 'hidden'
    sourcemap: false,
    rollupOptions: {
      output: {
        // 手动拆分 vendor chunk，提升缓存命中率与首屏性能
        manualChunks: {
          // Recharts 体积较大且仅 StatsPage 使用，单独拆分避免污染路由 chunk
          recharts: ['recharts'],
          // React 运行时核心库（react/react-dom/react-router-dom）独立 chunk
          react: ['react', 'react-dom', 'react-router-dom'],
        },
      },
    },
  },
})