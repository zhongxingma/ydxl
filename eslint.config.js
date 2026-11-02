// ESLint 9 扁平配置（替代 .eslintrc.cjs）
// 规则层次：JS 推荐 → TypeScript 推荐 → 项目约定 → 类型感知规则（先以 warn 落地）→ Prettier（最后关闭格式化冲突）
import js from '@eslint/js'
import globals from 'globals'
import prettier from 'eslint-config-prettier'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'

// 类型感知规则先降级为 warn：既有代码可继续合入，新代码在 IDE/CI 中可见提示
function toWarn(rules) {
  if (!rules) return rules
  return Object.fromEntries(
    Object.entries(rules).map(([name, setting]) =>
      Array.isArray(setting) ? [name, ['warn', ...setting.slice(1)]] : [name, setting === 'error' ? 'warn' : setting],
    ),
  )
}

const TS_FILES = ['**/*.{ts,tsx}']

const typeCheckedWarn = tseslint.configs.recommendedTypeChecked.map((config) => {
  const next = {
    ...config,
    files: ['src/**/*.{ts,tsx}'],
    languageOptions: {
      ...config.languageOptions,
      parserOptions: {
        ...(config.languageOptions?.parserOptions ?? {}),
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  }
  // base 配置仅含 parser/plugins，无 rules 字段时不写入该键（否则 ESLint 校验失败）
  if (config.rules) next.rules = toWarn(config.rules)
  return next
})

export default tseslint.config(
  {
    // 与旧 .eslintignore 等效的排除范围
    ignores: [
      '**/dist',
      'coverage',
      'node_modules',
      'playwright-report',
      'test-results',
      '.husky',
      'scripts',
      '*.config.js',
      '*.config.ts',
    ],
  },
  {
    files: TS_FILES,
    languageOptions: {
      ecmaVersion: 2020,
      sourceType: 'module',
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...js.configs.recommended.rules,
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
      // 允许未使用的变量/参数以 _ 开头时忽略
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    },
  },
  ...tseslint.configs.recommended.map((config) => ({ ...config, files: TS_FILES })),
  ...typeCheckedWarn,
  prettier,
)
