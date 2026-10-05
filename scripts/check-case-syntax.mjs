/**
 * 自带本子的两处 YAML 语法坑。两个都不在 typecheck 的视野里（那是数据），而都会让解析当场炸
 * ——并且一次只报一处，一轮轮改太慢。
 *
 * **坑一：双引号值里再套双引号。** 判据是「恰好两个引号」，不是「偶数个」：
 * `"…而"未登录"说明…"` 有四个引号，是偶数，而解析器看到第二个就把值闭合了，后面那截变成裸
 * 标量，报 `Unexpected scalar at node end`。中文里该用「」——那既躲开这个坑，读起来也更像话。
 *
 * **坑二：列表项以 `**` 开头。** YAML 把 `- **…` 里的 `**` 当成别名（alias）引用，整行解析
 * 失败。要加粗就把整段用引号包起来，或者把 `**` 挪到行中间去。
 *
 * 用法：node scripts/check-case-syntax.mjs
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
/** 列表项以 `*` 开头——YAML 的别名语法。 */
const ALIAS_SHAPED = /^-\s+\*/u

let bad = 0
for (const entry of readdirSync(root)) {
  const file = join(root, entry, 'case.yml')
  if (!statSync(file).isFile()) continue
  readFileSync(file, 'utf8').split('\n').forEach((line, index) => {
    const trimmed = line.trim()
    const where = `${entry} 第 ${index + 1} 行`
    if (ALIAS_SHAPED.test(trimmed)) {
      bad += 1
      console.log(`${where}：列表项以 * 开头（YAML 会当成别名） → ${trimmed.slice(0, 66)}`)
      return
    }
    if (!INLINE_VALUE.test(trimmed)) return
    const count = (line.match(/"/gu) ?? []).length
    if (count !== 2) {
      bad += 1
      console.log(`${where}：引号 ${count} 个（该是 2） → ${trimmed.slice(0, 66)}`)
    }
  })
}
console.log(bad === 0 ? '两个坑都没有' : `共 ${bad} 处`)
