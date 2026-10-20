// 音节估算工具：用于复习步骤中展示单词音节数

// 估算音节数（用于展示）
// 算法：按元音组数量估算（a/e/i/o/u/y 连续段落），末尾 e 不发音时减 1
export function estimateSyllables(word: string): number {
  const matches = word.toLowerCase().match(/[aeiouy]+/g)
  const count = matches ? matches.length : 1
  if (count > 1 && word.toLowerCase().endsWith('e')) {
    return count - 1
  }
  return count
}

/**
 * 基于元音分组规则生成本地拼读分解
 * 算法：
 * 1. 遍历单词字符，识别元音核心（a/e/i/o/u + 常见双元音组合 ai/ay/ea/ee/oa/oo/ou/ow/oy 等）
 * 2. 每个元音核心与其前面的辅音组合为一个音节
 * 3. 返回 phonics 数组与 syllables 数
 *
 * @param word 英文单词
 * @returns { phonics: string[]; syllables: number } 拼读分解结果
 */
export function breakdownWord(word: string): { phonics: string[]; syllables: number } {
  const w = word.toLowerCase()
  if (!w) return { phonics: [], syllables: 0 }

  const diphthongs = ['ai', 'ay', 'ea', 'ee', 'oa', 'oo', 'ou', 'ow', 'oy', 'oi', 'aw', 'ew', 'ar', 'er', 'ir', 'or', 'ur']
  const vowels = 'aeiou'

  // 识别元音核心（贪婪匹配双元音组合，否则匹配单元音）
  const cores: { start: number; end: number; text: string }[] = []
  let i = 0
  while (i < w.length) {
    if (i < w.length - 1) {
      const pair = w.slice(i, i + 2)
      if (diphthongs.includes(pair)) {
        cores.push({ start: i, end: i + 1, text: pair })
        i += 2
        continue
      }
    }
    if (vowels.includes(w[i])) {
      cores.push({ start: i, end: i, text: w[i] })
    }
    i += 1
  }

  // 无元音核心：整个单词作为一个音节
  if (cores.length === 0) {
    return { phonics: [w], syllables: 1 }
  }

  // 处理末尾不发音的 e（magic E：元音-单个辅音-e 模式）
  if (cores.length > 1) {
    const last = cores[cores.length - 1]
    if (last.text === 'e' && last.end === w.length - 1) {
      const prev = cores[cores.length - 2]
      if (last.start - prev.end - 1 === 1) {
        cores.pop()
      }
    }
  }

  // 按元音核心切分：每个音节包含其前面的辅音 + 元音核心
  const phonics: string[] = []
  let prevEnd = -1
  for (const core of cores) {
    phonics.push(w.slice(prevEnd + 1, core.end + 1))
    prevEnd = core.end
  }
  // 末尾剩余字符归入最后一个音节
  if (prevEnd < w.length - 1) {
    phonics[phonics.length - 1] += w.slice(prevEnd + 1)
  }

  return { phonics, syllables: phonics.length }
}
