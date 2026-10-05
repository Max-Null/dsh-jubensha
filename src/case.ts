/**
 * 本子：从 YAML 到「该给谁什么」。
 *
 * **为什么需要它**：三局的本子都是手写 Markdown，角色本靠 DM 从手册里**手抄**再发给玩家
 * ——抄漏一句就是信息隔离破了，而抄的过程没有任何检查。这里把本子变成可校验的数据：
 * 格式由 `schema/case.schema.yml` 定，加载时能查出结构问题，角色本能**按角色切出来**。
 *
 * **只把 `roles` 结构化**：别的段落（真相、线索、带局脚本…）是给 DM 读的整块文本，
 * 拆开反而丢信息，所以原样留在 `sections` 里按段取。角色本不一样——它要按座位切成
 * 各自那一份，切口必须精确。
 *
 * @module @max-null-plugins/dsh-jubensha/case
 */
import { parse as parseYaml } from 'yaml'

/** 一个角色的那份资料，字段与 `schema/case.schema.yml` 的 `roles` 段一一对应。 */
export interface RoleEntry {
  /** 座位 id，与 `GameState.seats` 同一套命名。 */
  readonly id: string
  /** 角色名。 */
  readonly name: string
  /** 这个位子归真人还是 AI。 */
  readonly player: 'human' | 'ai'
  /** 所有人可见的身份（开场就念）。 */
  readonly publicIdentity: string
  /** 角色**现在**在做什么活着——第三局发现玩家那份漏了它就被当场问住。 */
  readonly now: string
  /** 只有本人可见的真实经历。 */
  readonly privateHistory: string
  /** 他要瞒的事。 */
  readonly secret: string
  /** 他确实掌握的事实（监察判"越界"的输入）。 */
  readonly knows: readonly string[]
  /** 他在这局里想要什么。 */
  readonly goals: readonly string[]
  /** 怎么演 —— 这件事让他怎么说话。 */
  readonly play: string
  /** 他是不是凶手。**不进角色本**。 */
  readonly culprit: boolean
}

/** 一处能被程序查出来的问题。 */
export interface CaseIssue {
  /** `error` 让本子不可用；`warn` 只是提醒，本子仍能跑。 */
  readonly level: 'error' | 'warn'
  /** 给人看的一句话。 */
  readonly message: string
}

/** 一本加载好的本子。 */
export interface LoadedCase {
  /** 本子编号。 */
  readonly id: string
  /** 本子名。 */
  readonly title: string
  /** 类型：`deduction` / `drama` / `mechanic` / `horror`。 */
  readonly genre: string
  /** 全部角色，按本子里写的顺序。 */
  readonly roles: readonly RoleEntry[]
  /** 除 `roles` 外的原始段落，按段名取用（`scene` / `truth` / `clues` …）。 */
  readonly sections: Readonly<Record<string, unknown>>
  /** 校验发现的问题。 */
  readonly issues: readonly CaseIssue[]
}

/** 本子结构不对时抛这个 —— 它意味着这份文件根本没法用，不是"提醒一下"。 */
export class CaseFormatError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CaseFormatError'
  }
}

/** 取一个字段的文本；缺失时给空串（结构由调用方的校验负责，这里不重复报错）。 */
function text(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

/** 取一个字符串数组；非数组或含非字符串项时按空处理。 */
function strings(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === 'string')
}

/** 取一个对象；不是对象时给空对象。 */
function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

/** 从原始 roles 段读出一条。 */
function readRole(raw: unknown, index: number): RoleEntry {
  const entry = record(raw)
  const id = text(entry['id'])
  if (id === '') throw new CaseFormatError(`roles[${index}] 没有 id —— 每个角色都要有个座位号。`)
  const player = entry['player'] === 'human' ? 'human' : 'ai'
  return {
    id,
    name: text(entry['name']),
    player,
    publicIdentity: text(entry['public']),
    now: text(entry['now']),
    privateHistory: text(entry['private']),
    secret: text(entry['secret']),
    knows: strings(entry['knows']),
    goals: strings(entry['goals']),
    play: text(entry['play']),
    // 派生字段：谁是真凶由 `truth.culprit` 一处说了算，`loadCase` 读完真相再标回来。
    culprit: false,
  }
}

/**
 * 复盘之前可以随时取用的段落。
 *
 * **这是白名单，不是黑名单**：不在里面的段落，`phase` 走到 `reveal` 之前一律拒答。
 * 用白名单是因为漏的代价不对称——漏掉一段该开的，DM 当场就知道（取不到，报错里
 * 还列着段名）；而漏掉一段该锁的，是**玩家的操作条里静静躺着一份真相**，
 * 谁也不会发现，直到有人展开它。以后往 schema 加段落时，默认落在安全的那一侧。
 */
export const OPEN_BEFORE_REVEAL: readonly string[] = [
  'meta',            // 编号与人数，开场就要念
  'scene',           // 公开场景，本来就要给全员
  'briefing',        // 带局脚本——DM 靠它控场
  'style',           // 口吻素材，给 AI 玩家的味道
  'phases',          // 流程骨架
  'audit',           // 监察职责，逐局不同
  'world_facts',     // 玩家的环境常识
  'liberty_to_slip', // 破绽许可
]

/** 一段在复盘之前能不能取。 */
export function openBeforeReveal(section: string): boolean {
  return OPEN_BEFORE_REVEAL.includes(section)
}

/** 一条线索在**牌桌上**的样子：只有原文，没有 `supports`。 */
export interface TableClue {
  /** 线索 id，与 `jubensha_state` 的 `revealedClues` 同一套命名。 */
  readonly id: string
  /** 线索标题。 */
  readonly title: string
  /** 呈现给玩家的原文。 */
  readonly text: string
}

/**
 * 取线索的**牌桌原文**，丢掉 `supports`。
 *
 * 这是线索进牌桌的唯一出口。分开的理由在 schema 里写着：`text` 是"现场留下了什么"，
 * `supports` 是"这意味着什么"——后者只给 DM 判断用。两者若从同一个口子出去，
 * 迟早有一次会被整段贴到桌上，而**连"那条没有配对的进"都替玩家讲了，线索就只剩盖章**。
 * @param loaded - 加载好的本子。
 * @param ids - 要取的线索 id；给空数组表示全部。
 * @returns 牌桌可用的线索，以及在本子里找不到的 id。
 */
export function tableClues(
  loaded: LoadedCase,
  ids: readonly string[],
): { clues: TableClue[]; missing: string[] } {
  const raw = loaded.sections['clues']
  const entries = Array.isArray(raw) ? raw : []
  const all: TableClue[] = entries.map((item, index) => {
    const entry = record(item)
    return {
      id: text(entry['id']) || `c${index + 1}`,
      title: text(entry['title']),
      text: text(entry['text']),
    }
  })
  if (ids.length === 0) return { clues: all, missing: [] }
  const wanted = new Set(ids)
  const clues = all.filter(clue => wanted.has(clue.id))
  const found = new Set(clues.map(clue => clue.id))
  return { clues, missing: ids.filter(id => !found.has(id)) }
}

/** 死者。 */
export interface SceneVictim {
  /** 名字。 */
  readonly name: string
  /** 年龄；本子里没写就是 0。 */
  readonly age: number
  /** 怎么死的。 */
  readonly cause: string
  /** 法医给的死亡时间窗。 */
  readonly timeWindow: readonly string[]
}

/** 时间线上的一步。 */
export interface SceneTruthStep {
  /** 什么时候。 */
  readonly at: string
  /** 谁。 */
  readonly who: string
  /** 他实际做了什么——注意是**实际**，不是他嘴上说的。 */
  readonly doing: string
}

/** 复盘那一夜：真相、逐段时间线、以及那些「其实不是」。 */
export interface SceneTruth {
  /** 完整真相。 */
  readonly narrative: string
  /** 真值时间线。 */
  readonly timeline: readonly SceneTruthStep[]
  /** 设计好的误伤——复盘时要一条条解开，否则玩家会带着「我是不是冤枉了谁」散场。 */
  readonly misdirections: readonly string[]
  /** 事发之后又发生了什么。 */
  readonly after: readonly string[]
}

/**
 * 从本子里取真相那一段——**给复盘页用**。
 *
 * 它只在复盘之后才该被读，而那道判断在宿主那边（`index.ts` 按 `finished` 判，复盘前给 `null`）。
 * 本子的封存机制管的是 `jubensha_case` 取段，房间页走的是端点，是另一条读法——所以那一道判断
 * 得在那条路上显式写一次。
 *
 * 宽容地取：缺哪一段就给空，整段 `truth` 都没写时给 `null`——一个没写 `after` 的本子不该让
 * 复盘页整块不显示。
 * @param loaded - 加载好的本子。
 * @returns 真相；本子没写时为 `null`。
 */
export function sceneTruth(loaded: LoadedCase): SceneTruth | null {
  const truth = record(loaded.sections['truth'])
  const narrative = text(truth['narrative'])
  const steps = Array.isArray(truth['timeline']) ? truth['timeline'] : []
  const timeline = steps.flatMap((one): SceneTruthStep[] => {
    const step = record(one)
    const doing = text(step['doing'])
    if (doing === '') return []
    return [{ at: text(step['at']), who: text(step['who']), doing }]
  })
  /** 取一段字符串列表，把空行丢掉。 */
  const linesOf = (name: string): string[] =>
    (Array.isArray(truth[name]) ? truth[name] : []).flatMap((one): string[] => {
      const line = text(one)
      return line === '' ? [] : [line]
    })
  const misdirections = linesOf('misdirections')
  const after = linesOf('after')
  if (narrative === '' && timeline.length === 0) return null
  return { narrative, timeline, misdirections, after }
}


/**
 * 从本子里取死者。
 *
 * **宽容地取**：缺字段给空串、整个 `scene.victim` 缺失时给 `null`。本子格式在校验时已经管过
 * 必填项，而这里是"显示用"的读法——一个可选的年龄没写，不该让房间页整块不显示。
 * @param loaded - 加载好的本子。
 * @returns 死者；本子没写时为 `null`。
 */
export function sceneVictim(loaded: LoadedCase): SceneVictim | null {
  const victim = record(record(loaded.sections['scene'])['victim'])
  const name = text(victim['name'])
  if (name === '') return null
  const window = victim['time_window']
  return {
    name,
    age: typeof victim['age'] === 'number' ? victim['age'] : 0,
    cause: text(victim['cause']),
    timeWindow: Array.isArray(window)
      ? window.filter((one): one is string => typeof one === 'string')
      : [],
  }
}

/** 一条人物关系。 */
export interface SceneRelation {
  /** 从谁。写的是**名字**——图上除了角色还有死者，而死者没有座位号。 */
  readonly from: string
  /** 到谁。 */
  readonly to: string
  /** 什么关系，一句话。 */
  readonly label: string
}

/**
 * 从本子里取人物关系。
 *
 * **宽空地取**：缺字段的条目跳过、整段缺失给空数组——关系图少一条线，好过整个左栏不显示。
 * 两头都得有名字才留：留一条连不上任何人的线，画出来只是个悬空的标签。
 * @param loaded - 加载好的本子。
 * @returns 关系列表；本子没写时为 `[]`。
 */
export function sceneRelations(loaded: LoadedCase): SceneRelation[] {
  const raw = record(loaded.sections['scene'])['relations']
  if (!Array.isArray(raw)) return []
  return raw.flatMap((item): SceneRelation[] => {
    const entry = record(item)
    const from = text(entry['from'])
    const to = text(entry['to'])
    if (from === '' || to === '') return []
    return [{ from, to, label: text(entry['label']) }]
  })
}

/** ref 的前缀。`roleBook` 靠它分辨手里那串是引用还是正文。 */export const BOOK_REF_PREFIX = 'book:'

/**
 * 一个座位的角色本封存引用。
 *
 * 带上本子编号，跨局不会串。**引用本身就是"这一份属于谁"的凭据**——`spawn` 时拿它和
 * 座位号核一遍，就能挡住"把 p2 的本子发给了 p1"。
 * @param caseId - 本子编号。
 * @param seat - 座位 id。
 * @returns 形如 `book:p1@03` 的引用。
 */
export function bookRef(caseId: string, seat: string): string {
  return `${BOOK_REF_PREFIX}${seat}@${caseId}`
}

/**
 * 从一个引用里读回座位号。
 *
 * 与 `bookRef` 是一对，**改动其中一边必须同时改另一边**——所以这里的用例是往返一致性，
 * 而不是某个写死的字符串。
 * @param ref - 待解析的引用。
 * @returns 座位 id；不是本插件发的引用时给 `undefined`。
 */
export function bookRefSeat(ref: string): string | undefined {
  if (!ref.startsWith(BOOK_REF_PREFIX)) return undefined
  const seat = ref.slice(BOOK_REF_PREFIX.length).split('@')[0]
  return seat === undefined || seat === '' ? undefined : seat
}

/**
 * 在一段文本里认出一个引用。
 *
 * **只认已知的那几个**（`known` 是登记表）——所以正文里偶然出现 `book:` 字样不会被误认，
 * 这让它可以比正则宽松得多：整串相等算，**整段文本里含有**也算。
 *
 * 需要"含有"这一档是实测逼出来的（2026-10-05）：`book` 的返回值里既有一行摘要、又有一句
 * "roleBook 只填这一串"，而 DM 把**整段**填了进去。只认"整串相等"会让这种最自然的用法
 * 静默失败——玩家拿不到角色本，照样能说话，从外面看不出来。
 * @param text - 调用方填进 `roleBook` 的东西。
 * @param known - 本进程发出去的引用们。
 * @returns 认出来的引用；认不出时 `undefined`（调用方据此当作全文）。
 */
export function pickBookRef(text: string, known: ReadonlyMap<string, string>): string | undefined {
  if (known.has(text)) return text
  for (const ref of known.keys()) {
    if (text.includes(ref)) return ref
  }
  return undefined
}

/**
 * 封存期内给 DM 看的一行摘要。
 *
 * 它只取 `public :` 与角色名——**开场就要念给所有人听的**那两样。所以它不泄漏任何东西，
 * 却足以让 DM 确认手里那个 ref 指向的确实是这个位子的本子。
 * @param role - 一个角色的资料。
 * @returns 摘要文本。
 */
export function bookPreview(role: RoleEntry): string {
  return `你是「${role.name}」。${role.publicIdentity}`
}

/**
 * 把加载好的本子拼成能直接发给玩家的角色本。
 *
 * **不含 `culprit`**：那是真相，属于 DM 与监察。这一条是硬的——角色本里出现
 * 「你是凶手」，这一局就完了。
 * @param role - 一个角色的资料。
 * @returns 作为玩家首条消息正文的角色本文本。
 */
export function roleBook(role: RoleEntry): string {
  const parts = [`你是「${role.name}」。`, role.publicIdentity]
  if (role.now !== '') parts.push(`--- 你现在 ---\n${role.now}`)
  parts.push(`--- 你的真实经历 ---\n${role.privateHistory}`)
  if (role.secret !== '') parts.push(`--- 你要瞒的事 ---\n${role.secret}`)
  if (role.knows.length > 0) parts.push(`--- 你知道的 ---\n${role.knows.map(item => `- ${item}`).join('\n')}`)
  if (role.goals.length > 0) parts.push(`--- 你想要什么 ---\n${role.goals.map(item => `- ${item}`).join('\n')}`)
  if (role.play !== '') parts.push(`--- 你要怎么演 ---\n${role.play}`)
  return parts.filter(part => part.trim() !== '').join('\n\n')
}

/**
 * 机械可查的那几条判据。
 *
 * 只收**程序答得了的**：结构一致性、类型与内容的匹配。像「出口有没有修在动机的延长线上」
 * 这种要读懂本子才判断的，一条都不在这里——把它们写成检查只会得到假信号。
 * @param genre - 本子类型。
 * @param roles - 全部角色。
 * @param sections - 除 roles 外的原始段落。
 * @returns 发现的问题（可能为空）。
 */
function inspect(
  genre: string,
  roles: readonly RoleEntry[],
  sections: Readonly<Record<string, unknown>>,
): CaseIssue[] {
  const issues: CaseIssue[] = []
  const truth = record(sections['truth'])
  const culprit = text(truth['culprit'])

  if (genre === 'deduction') {
    if (culprit === '') {
      issues.push({ level: 'error', message: 'genre 是 deduction，但 truth.culprit 是空的——推理本得有凶手。' })
    } else if (!roles.some(role => role.id === culprit)) {
      issues.push({ level: 'error', message: `truth.culprit "${culprit}" 不在 roles 里。` })
    }
    if (!Array.isArray(sections['clues']) || sections['clues'].length === 0) {
      issues.push({ level: 'warn', message: 'genre 是 deduction，但 clues 是空的——玩家拿什么推。' })
    }
  }
  if (genre === 'drama') {
    if (!Array.isArray(sections['emotional']) || sections['emotional'].length === 0) {
      issues.push({ level: 'warn', message: 'genre 是 drama，但 emotional 是空的——情感本的主干不该缺。' })
    }
    if (culprit !== '') {
      issues.push({ level: 'warn', message: `genre 是 drama，却写了 truth.culprit "${culprit}"——情感本一般没有凶手。` })
    }
  }

  const humans = roles.filter(role => role.player === 'human')
  if (humans.length !== 1) {
    issues.push({ level: 'error', message: `真人位应当恰好一个，这本里有 ${humans.length} 个。` })
  } else if (humans[0]?.id !== 'p0') {
    issues.push({ level: 'warn', message: `真人位是 "${humans[0]?.id}"，惯例是 p0。` })
  }

  // 第三局那个坑：「你人物背景呢？我不知道自己现在是在做什么」——
  // 给谁的那份都不能缺「现在」，缺了玩家只能瞎编。
  const missingNow = roles.filter(role => role.now === '').map(role => role.id)
  if (missingNow.length > 0) {
    issues.push({ level: 'warn', message: `这些角色没写「现在」：${missingNow.join('、')}——玩家会问「我人物背景呢」。` })
  }

  const missingPlay = roles.filter(role => role.player === 'ai' && role.play === '').map(role => role.id)
  if (missingPlay.length > 0) {
    issues.push({ level: 'warn', message: `这些 AI 角色没写 play（怎么演）：${missingPlay.join('、')}——它只会照剧情陈述。` })
  }

  return issues
}

/**
 * 解析一份本子 YAML。
 *
 * 结构缺到没法用时**抛 `CaseFormatError`**；能用但有问题时把问题放在 `issues` 里返回——
 * 后者交给调用方决定是拦下还是提醒。
 * @param source - 本子文件的全文。
 * @returns 加载好的本子与校验结果。
 */
export function loadCase(source: string): LoadedCase {
  let document: unknown
  try {
    document = parseYaml(source)
  } catch (error: unknown) {
    throw new CaseFormatError(`本子不是合法的 YAML：${error instanceof Error ? error.message : String(error)}`)
  }
  const root = record(document)

  const meta = record(root['meta'])
  const id = text(meta['id'])
  if (id === '') throw new CaseFormatError('meta.id 是空的——本子要有个编号。')
  const rolesRaw = root['roles']
  if (!Array.isArray(rolesRaw) || rolesRaw.length === 0) {
    throw new CaseFormatError('roles 段缺失或是空的——没有角色就不是本子。')
  }
  // 真凶只从 `truth.culprit` 读一次，再标到对应角色上——不设第二个出处。
  const culpritId = text(record(root['truth'])['culprit'])
  const roles = rolesRaw.map((raw, index) => {
    const role = readRole(raw, index)
    return culpritId !== '' && role.id === culpritId ? { ...role, culprit: true } : role
  })

  const declared = typeof meta['players'] === 'number' ? meta['players'] : roles.length
  const sections: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(root)) {
    if (key !== 'roles') sections[key] = value
  }

  const issues = inspect(text(meta['genre']), roles, sections)
  if (declared !== roles.length) {
    issues.push({
      level: 'error',
      message: `meta.players 写的是 ${declared}，实际有 ${roles.length} 个角色。`,
    })
  }

  return {
    id,
    title: text(meta['title']),
    genre: text(meta['genre']),
    roles,
    sections,
    issues,
  }
}
