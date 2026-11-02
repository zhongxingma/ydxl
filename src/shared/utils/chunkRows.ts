// 将一维数组按列数切分为「行」，供虚拟滚动网格使用
// 例：chunkRows([a,b,c,d,e], 2) → [[a,b],[c,d],[e]]
// size 非法（<=0 / NaN）时按 1 处理，保证每行至少一个元素。
export function chunkRows<T>(items: T[], size: number): T[][] {
  const safeSize = Number.isFinite(size) && size > 0 ? Math.floor(size) : 1
  const rows: T[][] = []
  for (let i = 0; i < items.length; i += safeSize) {
    rows.push(items.slice(i, i + safeSize))
  }
  return rows
}
