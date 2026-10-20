// ESLint 配置文件（使用 legacy 配置格式，配合 ESLint 8.x）
// extends 顺序说明：基础规则 → TypeScript → React Hooks → React Refresh → Prettier（必须最后，关闭与 Prettier 冲突的格式化规则）
module.exports = {
  root: true,
  env: {
    browser: true,
    es2020: true,
    node: true,
  },
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
    'plugin:react-hooks/recommended',
    'prettier', // 放在最后，关闭与 Prettier 冲突的格式化规则
  ],
  parser: '@typescript-eslint/parser',
  parserOptions: {
    ecmaVersion: 2020,
    sourceType: 'module',
    ecmaFeatures: {
      jsx: true,
    },
  },
  plugins: ['@typescript-eslint', 'react-refresh'],
  rules: {
    'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
    // 允许未使用的函数参数以 _ 开头时忽略
    '@typescript-eslint/no-unused-vars': [
      'warn',
      { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
    ],
  },
  ignorePatterns: ['dist', 'node_modules', '.eslintrc.cjs'],
}
