// 拼写分级提示：生成首尾字母 + 元音遮罩
//
// level 1：仅首尾；level 2：首尾 + 1-2 个元音
export function getMask(word: string, level: number): string {
  const lower = word.toLowerCase()
  if (lower.length === 0) return ''
  const revealed = new Set<number>()
  revealed.add(0)
  if (lower.length > 1) revealed.add(lower.length - 1)

  if (level >= 2) {
    // 露出中间 1-2 个元音（非首尾位置）
    const vowelPositions: number[] = []
    for (let i = 1; i < lower.length - 1; i++) {
      if (/[aeiou]/.test(lower[i])) vowelPositions.push(i)
    }
    vowelPositions.slice(0, 2).forEach((p) => revealed.add(p))
  }

  return lower
    .split('')
    .map((c, i) => (revealed.has(i) ? c : '_'))
    .join('')
}
