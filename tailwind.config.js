/** @type {import('tailwindcss').Config} */
// TailwindCSS 配置文件
// darkMode: 'class' —— 通过切换 html 上的 dark 类实现夜间模式
// content: 扫描这些文件以提取使用到的 Tailwind 类名
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {},
  },
  plugins: [],
}
