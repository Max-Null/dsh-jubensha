/**
 * README 与实现核对：把 README 里所有能机械核的东西核一遍。
 *
 * §2 的原话是「先假定它写错了，再去找证据」。所以这里不猜——每一行都拿仓库里的东西去比：
 * 提到的文件路径存不存在、用例数对不对、本子数对不对、工具名在不在代码里。
 *
 * 用法：node scripts/check-readme.mjs
 */
import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const readme = readFileSync(join(root, 'README.md'), 'utf8')
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))

const problems = []
const notes = []

// ① README 里提到的文件路径（markdown 链接与图片）都要存在。
const refs = [...readme.matchAll(/\]\(([^)]+)\)/gu)].map(m => m[1]).filter(one => !one.startsWith('http'))
for (const ref of new Set(refs)) {
  const path = join(root, ref)
  if (!existsSync(path)) problems.push(`README 引的路径不存在：${ref}`)
  else if (!ref.startsWith('docs/') && !ref.startsWith('cases/') && !ref.startsWith('schema/')) continue
}
notes.push(`README 引用的路径 ${String(new Set(refs).size)} 个，全部存在（除上面报出来的）`)

// ② 引用的图片在不在 npm 包里（files 决定发出去什么）。
const files = pkg.files ?? []
const shotsInPack = files.some(one => one.startsWith('docs'))
if (!shotsInPack) {
  const shots = refs.filter(one => one.startsWith('docs/shots/'))
  if (shots.length > 0) {
    problems.push(`README 引了 ${String(shots.length)} 张 docs/shots/ 的图，而 package.json 的 files 里没有 docs —— npm 页面上那些图会裂（GitHub 上正常）`)
  }
}

// ③ 用例数。
const testFiles = readdirSync(join(root, 'tests')).filter(one => one.endsWith('.spec.ts'))
let cases = 0
for (const file of testFiles) {
  const text = readFileSync(join(root, 'tests', file), 'utf8')
  cases += (text.match(/\bit\(/gu) ?? []).length
}
const claimedTests = /test`?（(\d+) 条）/u.exec(readme) ?? /（(\d+) 条）/u.exec(readme)
const saidTests = /（(\d+) 条）/u.exec(readme)?.[1]
if (saidTests !== undefined && Number(saidTests) !== cases) {
  problems.push(`README 说测试 ${saidTests} 条，而 tests/ 里数出 ${String(cases)} 条`)
} else {
  notes.push(`测试条数：README ${saidTests ?? '没写'} / 实际 ${String(cases)}`)
}

// ④ 本子数。
const casesDir = readdirSync(join(root, 'cases'), { withFileTypes: true }).filter(one => one.isDirectory()).map(one => one.name)
const said = /自带([一二三四五六七八九十]+)本/u.exec(readme)?.[1]
const chinese = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 }
notes.push(`本子目录 ${String(casesDir.length)} 个（${casesDir.join(' / ')}），README 说「自带${said ?? '没写'}本」`)
if (said !== undefined && chinese[said] !== casesDir.length) {
  problems.push(`README 说自带${said}本，而 cases/ 下有 ${String(casesDir.length)} 个目录`)
}

// ⑤ 提到的工具名与 action 要在代码里真的有。
//
// **判据要照代码的实际写法**：工具名是常量（`const STATE_TOOL = 'jubensha_state'`）、而 action 走
// `action === 'clue'` 或 schema 的 `enum: [...]`——第一版按 `name: 'jubensha_state'` 与
// `case 'clue'` 去找，于是四个工具与一个 action 全报「找不到」（全是假警报）。
const tools = ['jubensha_state', 'jubensha_player', 'jubensha_case', 'jubensha_actor']
const index = readFileSync(join(root, 'src', 'index.ts'), 'utf8')
for (const tool of tools) {
  const declared = new RegExp(`= '${tool}'`, 'u').test(index)
  if (!declared) problems.push(`README 提到的工具 ${tool} 在 src/index.ts 里找不到（既没有常量也没有字面量）`)
}
const actions = [...readme.matchAll(/action="([a-z]+)"/gu)].map(m => m[1])
for (const action of new Set(actions)) {
  const handled = new RegExp(`action === '${action}'`, 'u').test(index)
    || new RegExp(`'${action}'`, 'u').test(index)
  if (!handled) problems.push(`README 提到的 action="${action}" 在 src/index.ts 里找不到`)
}
notes.push(`README 提到的 action：${[...new Set(actions)].join(' / ')}`)

// ⑥ 演员池自带几位。
const actors = readFileSync(join(root, 'src', 'actor.ts'), 'utf8')
const builtin = (actors.match(/id: '[^']+'/gu) ?? []).length
notes.push(`src/actor.ts 里看到的 id 条目 ${String(builtin)} 条（README 说自带六位）`)

// ⑦ skills 名。
for (const name of [...readme.matchAll(/skill `([a-z-]+)`/gu)].map(m => m[1])) {
  if (!index.includes(`name: '${name}'`)) problems.push(`README 提到的 skill ${name} 在代码里找不到`)
}

console.log('=== 对上的 ===')
for (const note of notes) console.log('  · ' + note)
console.log('\n=== 对不上的 ===')
if (problems.length === 0) console.log('  （没有）')
for (const one of problems) console.log('  ✗ ' + one)
console.log(`\n共 ${String(problems.length)} 处要改。`)
