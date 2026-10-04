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
