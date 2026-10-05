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
import { CaseFormatError, bookPreview, bookRef, bookRefSeat, loadCase, openBeforeReveal, pickBookRef, roleBook, sceneRelations, sceneVictim, tableClues } from '../src/case.ts'

/** 一份真实本子的 YAML 版——`tests/fixtures/case-03.yml` 的文件头写了它为什么存在。 */
function fixture(): string {
  return readFileSync(new URL('./fixtures/case-03.yml', import.meta.url), 'utf8')
}

/**
 * 第二份真实本子：推理本 case-02。
 *
 * 与 case-03 分工不同——那份是情感本，`truth.culprit` / `clues[*].supports` / `timeline`
 * 这些**推理本专属**的段在它里面全是空的。这一份把它们都填满。
 */
function fixture02(): string {
  return readFileSync(new URL('./fixtures/case-02.yml', import.meta.url), 'utf8')
}

/**
 * 第三份：case-01，三本里最早写的那一本，也是**唯一填的时候填不下去的**。
 *
 * 它的 YAML 直接住在 `cases/01-拾光照相馆/case.yml`（正式位置，不是 fixture）——
 * 那三本转完之后，本子的家就是各自的目录。
 */
function fixture01(): string {
  return readFileSync(new URL('../cases/01-拾光照相馆/case.yml', import.meta.url), 'utf8')
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

describe('加载一份真实的推理本', () => {
  it('读出编号、名字与类型', () => {
    const loaded = loadCase(fixture02())
    expect(loaded.id).toBe('02')
    expect(loaded.title).toBe('深夜电台')
    expect(loaded.genre).toBe('deduction')
  })

  it('一条问题都挑不出来——推理本这一侧同样成立', () => {
    // case-03 证明了 schema 装得下情感本。这条是它的另一半：`truth.culprit`、
    // `clues[*].supports`、`truth.timeline`、`truth.misdecisions` 这些只在推理本里
    // 有内容的段，也一条不差地装得下。
    expect(loadCase(fixture02()).issues).toEqual([])
  })

  it('真凶由 truth.culprit 一处说了算，派到角色上', () => {
    const loaded = loadCase(fixture02())
    const culprits = loaded.roles.filter(role => role.culprit).map(role => role.id)
    expect(culprits).toEqual(['p3'])
  })

  it('凶手那份角色本里没有凶手标记——它出现这一局就完了', () => {
    const culprit = loadCase(fixture02()).roles.find(role => role.culprit)!
    expect(roleBook(culprit)).not.toContain('凶手')
    expect(roleBook(culprit)).toContain('苏雨')
  })

  it('三条线索都在，而且 supports 是给 DM 的那一半', () => {
    const loaded = loadCase(fixture02())
    const { clues } = tableClues(loaded, [])
    expect(clues.map(clue => clue.id)).toEqual(['c1', 'c2', 'c3'])
    // 破局点到这一步就该断在这里：`supports` 里写了「最后那条 22:41 出没人认领」，
    // 而牌桌上只该有那六条时间。玩家自己看出没人认领，才是他要做的活。
    const supports = JSON.stringify(loaded.sections['clues'])
    expect(supports).toContain('没人认领')
    expect(JSON.stringify(clues)).not.toContain('没人认领')
  })

  it('真值时间线逐段都在，谁在哪一段是明写的', () => {
    const timeline = loadCase(fixture02()).sections['truth'] as { timeline: { at: string; who: string }[] }
    expect(timeline.timeline).toHaveLength(5)
    expect(timeline.timeline.map(entry => entry.who)).toEqual(['p2', 'p1', 'p0', 'p3', 'p3'])
  })
})

describe('加载最早写的那一本（case-01）', () => {
  it('读得出编号、名字与类型', () => {
    const loaded = loadCase(fixture01())
    expect(loaded.id).toBe('01')
    expect(loaded.title).toBe('拾光照相馆')
    expect(loaded.genre).toBe('deduction')
  })

  it('它会报一处「没写现在」——那不是转换的错，是本子本来就有这个缺口', () => {
    // 另外三张角色卡都自带身份（退休邮递员 / 做老照片生意 / 学徒），
    // 而林默那张只写了「32 岁，周德明的侄子」——「他现在在做什么活着」这件事角色卡里没有。
    // 第三局玩家当场问住的正是这件事（「我人物背景呢？我不知道自己现在是在做什么」），
    // 而它在这本**最早写的**本子里就存在。转换只是把它照出来，没有替它编。
    const loaded = loadCase(fixture01())
    const missing = loaded.issues.filter(issue => issue.message.includes('没写「现在」'))
    expect(missing).toHaveLength(1)
    expect(missing[0]?.level).toBe('warn')
    expect(missing[0]?.message).toContain('p0')
  })

  it('除那一处之外没有别的问题——说明缺口只有一个，不是格式不合', () => {
    const loaded = loadCase(fixture01())
    expect(loaded.issues.filter(issue => issue.level === 'error')).toEqual([])
  })

  it('真凶是 p2，其余三个人都不是', () => {
    const loaded = loadCase(fixture01())
    expect(loaded.roles.filter(role => role.culprit).map(role => role.id)).toEqual(['p2'])
  })

  it('三条线索都在', () => {
    const { clues } = tableClues(loadCase(fixture01()), [])
    expect(clues.map(clue => clue.id)).toEqual(['c1', 'c2', 'c3'])
  })

  it('凶手那份角色本里没有凶手标记——它出现这一局就完了', () => {
    const culprit = loadCase(fixture01()).roles.find(role => role.culprit)!
    expect(roleBook(culprit)).not.toContain('凶手')
    expect(roleBook(culprit)).toContain('马丽')
  })

  it('四个角色本的切口都对得上座位', () => {
    const loaded = loadCase(fixture01())
    expect(loaded.roles.map(role => role.id)).toEqual(['p0', 'p1', 'p2', 'p3'])
    expect(loaded.roles.filter(role => role.player === 'human').map(role => role.id)).toEqual(['p0'])
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

describe('封存：哪些段在复盘之前拿不到', () => {
  it('带答案的段一律封着', () => {
    expect(openBeforeReveal('truth')).toBe(false)
    expect(openBeforeReveal('clues')).toBe(false)
    expect(openBeforeReveal('emotional')).toBe(false)
    expect(openBeforeReveal('reveal')).toBe(false)
  })

  it('带局要用的段照常给', () => {
    expect(openBeforeReveal('scene')).toBe(true)
    expect(openBeforeReveal('briefing')).toBe(true)
    expect(openBeforeReveal('audit')).toBe(true)
  })

  it('没见过的段名按封着算——白名单的意义就在这里', () => {
    expect(openBeforeReveal('某个还没发明出来的段')).toBe(false)
  })
})

describe('角色本引用', () => {
  it('生成与解析是一对：往返回来还是原来那个座位', () => {
    // 写死字符串的用例挡不住"改了格式忘了改解析"，往返一致性挡得住。
    for (const seat of ['p0', 'p1', 'p2', 'p3']) {
      expect(bookRefSeat(bookRef('03', seat))).toBe(seat)
    }
  })

  it('不同座位解析出不同座位——这条是「不许串位」的前提', () => {
    const seats = ['p0', 'p1', 'p2', 'p3'].map(seat => bookRefSeat(bookRef('03', seat)))
    expect(new Set(seats).size).toBe(4)
  })

  it('引用里带着本子编号', () => {
    expect(bookRef('03', 'p1')).toContain('03')
    expect(bookRef('03', 'p1')).not.toBe(bookRef('01', 'p1'))
  })

  it('不是引用的串解析出 undefined——正文与引用靠这个分', () => {
    expect(bookRefSeat('你是「林小满」。')).toBeUndefined()
    expect(bookRefSeat('book:')).toBeUndefined()
  })
})

describe('从入参里认出引用', () => {
  /** 一局的登记表：p1 与 p2 各一份。 */
  function known(): Map<string, string> {
    return new Map([
      [bookRef('03', 'p1'), 'p1 的角色本'],
      [bookRef('03', 'p2'), 'p2 的角色本'],
    ])
  }

  it('整串就是一个引用', () => {
    expect(pickBookRef(bookRef('03', 'p1'), known())).toBe(bookRef('03', 'p1'))
  })

  it('整段文本里含有引用也认得——DM 实际就是这么填的', () => {
    // 2026-10-05 实测：book 的返回值里有摘要、有说明，DM 把**整段**填进了 roleBook。
    // 只认"整串相等"会让这一局静默地发不出版角色本，而玩家照样能说话，看不出来。
    const filled = '你是「林小满」。陈默的高中同学。\n\n'
      + '角色本全文已封存，不经过你的上下文。上桌时 roleBook 只填下面这一串——只填这一串：\n'
      + bookRef('03', 'p1')
    expect(pickBookRef(filled, known())).toBe(bookRef('03', 'p1'))
  })

  it('认的是本局发出去的那几个，不是字样——正文里出现 book: 也不会误认', () => {
    expect(pickBookRef('他写了 book:xxx@99 这几个字', known())).toBeUndefined()
  })

  it('纯正文原样当作全文', () => {
    expect(pickBookRef('你是「林小满」。', known())).toBeUndefined()
    expect(pickBookRef('', known())).toBeUndefined()
  })
})

describe('线索进牌桌', () => {
  it('只给玩家要读的原文，supports 一个字都不带', () => {
    const loaded = loadCase(minimal())
    const { clues } = tableClues(loaded, [])
    expect(clues).toHaveLength(1)
    expect(clues[0]?.text).toBe('柜台上有只倒了的杯子')
    expect(clues[0]?.title).toBe('一只杯子')
    // 判据写成"结果里不许出现 supports"，而不是"结果里有 text"——
    // 前者能抓住"哪天有人给 TableClue 加了个字段"这种回归，后者抓不住。
    expect(JSON.stringify(clues)).not.toContain('有人碰过柜台')
  })

  it('没写 supports 也不影响取', () => {
    const loaded = loadCase(minimal().replace('    supports: 有人碰过柜台\n', ''))
    expect(tableClues(loaded, []).clues[0]?.text).toBe('柜台上有只倒了的杯子')
  })

  it('按 id 挑，挑不到的把 id 原样报回来', () => {
    const loaded = loadCase(minimal())
    const { clues, missing } = tableClues(loaded, ['c9'])
    expect(clues).toEqual([])
    expect(missing).toEqual(['c9'])
  })

  it('本子里没有 clues 段时给空，不抛——情感本本来就没有搜证', () => {
    const loaded = loadCase(minimal().replace(/clues:[\s\S]*$/, ''))
    expect(tableClues(loaded, []).clues).toEqual([])
  })

  it('情感本没有 clues 段——不是缺陷，schema 里明说了「那些段留空即可」', () => {
    // 这条原先写成 "真本子的线索也过得了这道口"，跑出来是 0 条——**是我的假设错了，不是代码错了**。
    // 留着它，因为"情感本没有搜证"这件事正是下面这条 action="clue" 会遇到的真实输入。
    const loaded = loadCase(fixture())
    expect(loaded.genre).toBe('drama')
    expect(tableClues(loaded, []).clues).toEqual([])
  })
})

describe('角色本封存期给 DM 看的那一行', () => {
  it('只有开场就要念的东西，秘密一个字都不露', () => {
    const loaded = loadCase(fixture())
    const role = loaded.roles.find(candidate => candidate.id === 'p0')!
    const preview = bookPreview(role)
    expect(preview).toContain(role.name)
    expect(preview).toContain(role.publicIdentity)
    expect(preview).not.toContain(role.privateHistory.slice(0, 12))
    expect(preview).not.toContain(role.secret.slice(0, 12))
  })
})

/**
 * 造一份最小可用的本子：只用来测「界面要的那两块读法」。
 *
 * `scene` 由调用方给——这样每条用例能写出它要的那个形状（空的 victim、断了一条的关系），
 * 而不必去改真本子，也不必依赖某一个 fixture 恰好长成什么样。
 * @param scene - `scene:` 之下的那几行。
 * @returns 一份能过加载器的本子。
 */
function tinyCase(scene: string): string {
  return [
    'meta: { genre: drama, id: "99", title: "试", players: 2, human_slots: 1 }',
    'scene:',
    scene,
    'roles:',
    '  - { id: p0, name: "甲", player: human }',
    '  - { id: p1, name: "乙", player: ai }',
  ].join('\n')
}

describe('死者与关系：两块给界面用的读法', () => {
  it('死者读得出来', () => {
    const victim = sceneVictim(loadCase(fixture01()))
    expect(victim?.name).toBe('周德明')
    expect(victim?.age).toBe(58)
    expect(victim?.cause).toContain('后脑')
    expect(victim?.timeWindow).toEqual(['21:30', '22:30'])
  })

  it('情感本没有案件时给 null——不是抛，也不是一个空壳', () => {
    // case-03 的 scene.victim 是 `{}`，那是情感本的正常写法。
    expect(sceneVictim(loadCase(tinyCase('  setup: "占位"\n  victim: {}')))).toBeNull()
  })

  it('关系读得出来：四条线，两头都有名字', () => {
    const relations = sceneRelations(loadCase(fixture01()))
    expect(relations).toHaveLength(4)
    expect(relations[0]).toEqual({ from: '周德明', to: '林默', label: '叔侄' })
  })

  it('本子没写 relations 时给空数组——图画不出来不该让整个左栏不显示', () => {
    expect(sceneRelations(loadCase(fixture02()))).toEqual([])
  })

  it('缺一头的条目直接跳过：留一条连不上人的线，画出来只是个悬空的标签', () => {
    const loaded = loadCase(tinyCase([
      '  setup: "占位"',
      '  relations:',
      '    - { from: "甲", to: "乙", label: "同乡" }',
      '    - { from: "甲", label: "断了" }',
    ].join('\n')))
    expect(sceneRelations(loaded)).toEqual([{ from: '甲', to: '乙', label: '同乡' }])
  })
})
