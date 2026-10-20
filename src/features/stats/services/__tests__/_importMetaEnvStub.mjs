// 自定义 ESM loader：在 Node/tsx 中运行测试时 polyfill Vite 专用的 import.meta.env
//
// 背景：
// - supabase.ts 在模块加载时访问 import.meta.env.VITE_SUPABASE_URL
// - Node/tsx 中 import.meta.env 为 undefined，访问 .VITE_X 会抛 TypeError
// - 不可修改业务代码，因此通过 loader 在源码层将 import.meta.env 替换为 ({})
//
// 替换后：import.meta.env.VITE_X → ({}).VITE_X → undefined（不抛错，降级为未配置）
//
// 用法：在测试文件中通过 module.register('./_importMetaEnvStub.mjs', import.meta.url) 注册

export async function load(url, context, defaultLoad) {
  const result = await defaultLoad(url, context)
  // 仅处理 TS/TSX 文件（含 .mts/.cts），且 source 为字符串
  if (
    typeof result?.source === 'string' &&
    /\.[mc]?tsx?$/.test(url)
  ) {
    // 将 import.meta.env 替换为 ({})，使后续属性访问返回 undefined
    result.source = result.source.replace(
      /\bimport\.meta\.env\b/g,
      '({})',
    )
  }
  return result
}
