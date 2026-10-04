/**
 * 本子加载器的行为约定。
 *
 * 最有分量的一条是「case-03 转换后零 issue」——它是**schema 够不够用**的判据：
 * 一份真实本子逐字段填完，结构校验一条都没挑出来，说明格式没跟实际写法打架。
 *
 * 判据来源：`schema/case.schema.yml` v1.0 的七条写本判据，
 * 以及 `cases/03-没拆的那封信/run-03-复盘.md` 里由真人玩家当场指出的两处缺口。
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { CaseFormatError, loadCase, roleBook } from '../src/case.ts'

/** 一份真实本子的 YAML 版——`tests/fixtures/case-03.yml` 的文件头写了它为什么存在。 */
function fixture(): string {
  return readFileSync(new URL('./fixtures/case-03.yml', import.meta.url), 'utf8')
}

/** 一份最小的可用推理本，用来单独试某一条校验。 */
function minimal(overrides: string = ''): string {
  return `
meta:
  genre: deduction
  id: "99"
  title: 试作
  players: 2
${overrides}
roles:
  - id: p0
    name: 甲
    player: human
    now: 在城里做事
    private: 你昨晚在家
    play: 你会少说话
  - id: p1
    name: 乙
    player: ai
    now: 在店里看店
    private: 你昨晚在店里
    play: 你会先说
truth:
  culprit: p1
  narrative: 是他
clues:
  - id: c1
    title: 一只杯子
    text: 柜台上有只倒了的杯子
    supports: 有人碰过柜台
`
}

describe('加载一份真实本子', () => {
  it('读出编号、名字与类型', () => {
    const loaded = loadCase(fixture())
    expect(loaded.id).toBe('03')
    expect(loaded.title).toBe('没拆的那封信')
    expect(loaded.genre).toBe('drama')
  })

  it('四个角色，真人固定在 p0', () => {
    const loaded = loadCase(fixture())
    expect(loaded.roles.map(role => role.id)).toEqual(['p0', 'p1', 'p2', 'p3'])
    expect(loaded.roles.filter(role => role.player === 'human').map(role => role.id)).toEqual(['p0'])
  })

  it('一条问题都挑不出来——这是 schema 够不够用的判据', () => {
    expect(loadCase(fixture()).issues).toEqual([])
  })

  it('除 roles 之外的段落原样留着，按段名取', () => {
    const loaded = loadCase(fixture())
    expect(loaded.sections['reveal']).toBeDefined()
    expect(loaded.sections['briefing']).toBeDefined()
  })
})

describe('角色本', () => {
  it('拼出这个人自己那一份：身份、现在、经历、要瞒的、怎么演', () => {
    const role = loadCase(fixture()).roles[0]!
    const book = roleBook(role)
    expect(book).toContain('宋阳')
    expect(book).toContain('你现在')
    expect(book).toContain('你的真实经历')
    expect(book).toContain('你要瞒的事')
    expect(book).toContain('你要怎么演')
  })

  it('不给凶手标记——角色本里出现「你是凶手」，这一局就完了', () => {
    const culprit = loadCase(minimal()).roles.find(role => role.culprit)
    expect(culprit?.id).toBe('p1')
    expect(roleBook(culprit!)).not.toContain('凶手')
  })

  it('没写的段不留下空标题', () => {
    const book = roleBook({
      id: 'p9', name: '丙', player: 'ai', publicIdentity: '路人', now: '', privateHistory: '你什么都没做',
      secret: '', knows: [], goals: [], play: '', culprit: false,
    })
    expect(book).not.toContain('你要瞒的事')
    expect(book).not.toContain('你要怎么演')
    expect(book).toContain('你什么都没做')
  })
})

describe('结构与判据', () => {
  it('没有 roles 就不是本子', () => {
    expect(() => loadCase('meta:\n  id: "01"\n  title: 空\n')).toThrow(CaseFormatError)
  })

  it('不是合法 YAML 时明说是什么问题', () => {
    expect(() => loadCase('meta: [')).toThrow(/YAML/)
  })

  it('角色数对不上 meta.players 就报错', () => {
    const loaded = loadCase(minimal('  human_slots: 1\n').replace('players: 2', 'players: 5'))
    expect(loaded.issues.some(issue => issue.message.includes('实际有 2 个角色'))).toBe(true)
  })

  it('推理本没有凶手就报错——那正是「靠说谎定罪」那条判据的形式化', () => {
    const loaded = loadCase(minimal().replace('culprit: p1', 'culprit: ""'))
    expect(loaded.issues.some(issue => issue.level === 'error' && issue.message.includes('truth.culprit'))).toBe(true)
  })

  it('凶手指向不存在的角色也报错', () => {
    const loaded = loadCase(minimal().replace('culprit: p1', 'culprit: p7'))
    expect(loaded.issues.some(issue => issue.message.includes('不在 roles 里'))).toBe(true)
  })

  it('角色缺「现在」只是提醒——但第三局就是栽在这上面', () => {
    const loaded = loadCase(minimal().replace('    now: 在城里做事\n', ''))
    expect(loaded.issues.some(issue => issue.level === 'warn' && issue.message.includes('没写「现在」'))).toBe(true)
  })

  it('AI 角色缺 play 只是提醒——不然它只会照剧情陈述', () => {
    const loaded = loadCase(minimal().replace('    play: 你会先说\n', ''))
    expect(loaded.issues.some(issue => issue.level === 'warn' && issue.message.includes('没写 play'))).toBe(true)
  })

  it('推理本没有线索只是提醒：本子能跑，但玩家没得推', () => {
    const loaded = loadCase(minimal().replace(/clues:[\s\S]*$/, ''))
    expect(loaded.issues.some(issue => issue.level === 'warn' && issue.message.includes('clues'))).toBe(true)
  })
})
