/**
 * 找本子里「双引号值里面又套了双引号」的行。
 *
 * 双引号包起来的 YAML 值里再出现双引号，解析器会当场炸——而它一次只报一处，一轮轮试太慢。
 * 这个脚本一次找全。
 *
 * **判据是「恰好两个引号」，不是「偶数个」**：`"…而"未登录"说明…"` 有四个引号，是偶数，
 * 而解析器看到第二个就把值闭合了——后面那半截变成了裸标量，报 `Unexpected scalar at node end`。
 * 所以一对引号的值里出现第三、第四个引号，就是错的。
 *
 * 中文里该用「」——那既躲开这个坑，读起来也更像话。
 *
 * 用法：node scripts/check-quotes.mjs
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

const root = 'cases'
/**
 * 值写在行内的那两种行：`键: "…"` 与列表项 `- "…"`。
 *
 * 用通则而不是列一张键名清单——第一版列了十一个键，于是漏掉 `setup`，多花了两轮才找到。
 * 块标量（`text: |`）下面那几行不在这个模式里，而它们**可以**自由用双引号。
 */
const INLINE_VALUE = /^([a-z_]+:\s*|-\s*)"|^-\s*[a-z_]+:\s*"/u

let bad = 0
for (const entry of readdirSync(root)) {
  const file = join(root, entry, 'case.yml')
  if (!statSync(file).isFile()) continue
  readFileSync(file, 'utf8').split('\n').forEach((line, index) => {
    const trimmed = line.trim()
    if (!INLINE_VALUE.test(trimmed)) return
    const count = (line.match(/"/gu) ?? []).length
    if (count !== 2) {
      bad += 1
      console.log(`${entry} 第 ${index + 1} 行：引号 ${count} 个 → ${trimmed.slice(0, 76)}`)
    }
  })
}
console.log(bad === 0 ? '没有内层引号' : `共 ${bad} 处`)
