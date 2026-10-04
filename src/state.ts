/**
 * 局面状态机 —— 一局剧本杀「现在到哪了」的机器可读记录。
 *
 * **为什么需要它**：跑三局的过程中，阶段、轮次、线索给没给，一直记在 DM 的对话记忆里。
 * 一旦上下文被压缩或会话断掉，这些事实就跟着没了，复盘也只能靠回忆。这里把它变成一份
 * 可读、可写、可测的状态 —— **复盘 = 读日志**。
 *
 * 两条来自实测的领域规则：
 *
 * 1. **线索只记 id，不记文本**。进牌桌的是本子里的原文；写本时标注的 `supports`
 *    （"它能推出什么"）是给 DM 判断用的。`schema/case.schema.yml` 的判据 4 记着这条的
 *    来由：第二局的监察追问「桌上给玩家的门禁文本，是只给六条时间，还是把『22:41 没有
 *    配对的进』这句注解一起给了？」—— 连"那条没有配对的进"都替他讲了，线索就只剩盖章。
 *    状态机因此只记「发了哪一条」，正文与解读都不经过它。
 * 2. **搜证阶段之前不给线索** —— 提前给会让问话阶段失去意义。
 *
 * @module @max-null/dsh-jubensha/state
 */

/** 阶段顺序，与 `schema/case.schema.yml` 的 `phases` 一致。 */
export const PHASE_ORDER = ['self-intro', 'inquiry', 'search', 'final', 'reveal'] as const

/** 阶段标识。 */
export type PhaseId = (typeof PHASE_ORDER)[number]

/** 事件日志里的一条。 */
export interface LogEntry {
  /** 单调递增序号，从 1 开始；复盘按它排序。 */
  at: number
  /** 该事件发生在哪个阶段。 */
  phase: PhaseId
  /** 事件类型。 */
  kind: 'phase-enter' | 'clue-revealed'
  /** 事件明细：进入阶段记阶段名，公布线索记线索 id。 */
  detail: string
}

/** 一局的开局输入。 */
export interface StartInput {
  /** 本子编号，如 `"01"`。 */
  caseId: string
  /** 本子名，会出现在开场里。 */
  title: string
  /** 桌上的位子（角色 id），按发言顺序。 */
  seats: readonly string[]
  /** 真人占的角色 id。 */
  humanSeat: string
}

/** 一局的局面。 */
export interface GameState {
  /** 本子编号。 */
  readonly caseId: string
  /** 本子名。 */
  readonly title: string
  /** 桌上的位子。 */
  readonly seats: readonly string[]
  /** 真人占的角色 id —— 信息路由靠它分辨谁该收到什么。 */
  readonly humanSeat: string
  /** 当前阶段。 */
  readonly phase: PhaseId
  /** 轮次，从 1 开始。 */
  readonly round: number
  /** 已经发到桌上的线索 id。 */
  readonly revealedClues: readonly string[]
  /** 事件日志，复盘读它。 */
  readonly log: readonly LogEntry[]
}

/** 在一个已有日志后面追加一条。 */
function append(log: readonly LogEntry[], phase: PhaseId, kind: LogEntry['kind'], detail: string): LogEntry[] {
  return [...log, { at: log.length + 1, phase, kind, detail }]
}

/**
 * 开一局：落在第一个阶段，并留下一条进入记录。
 * @param input - 开局输入。
 * @returns 初始局面。
 */
export function createGame(input: StartInput): GameState {
  const phase = PHASE_ORDER[0]
  return {
    caseId: input.caseId,
    title: input.title,
    seats: [...input.seats],
    humanSeat: input.humanSeat,
    phase,
    round: 1,
    revealedClues: [],
    log: append([], phase, 'phase-enter', phase),
  }
}

/**
 * 推进到下一阶段。
 *
 * **已在终点（复盘）时原样返回同一个对象** —— 不是"再进一个空阶段"。判据是复盘之后
 * 没有下一步可走，凭空造一个阶段会让日志与流程对不上。
 * @param state - 当前局面。
 * @returns 推进后的新局面；已在终点时即传入的那个对象。
 */
export function advance(state: GameState): GameState {
  const next = PHASE_ORDER[PHASE_ORDER.indexOf(state.phase) + 1]
  if (next === undefined) return state
  return { ...state, phase: next, log: append(state.log, next, 'phase-enter', next) }
}

/**
 * 公布线索。
 *
 * 只接受线索 id：正文与解读都不经过状态机（见模块注释规则 1）。搜证阶段之前调用是**空操作**，
 * 返回传入的那个对象 —— 让调用方无法用"早给一条"绕过阶段约束，也让这类调用在日志里没有痕迹。
 * @param state - 当前局面。
 * @param ids - 本次公布到桌上的线索 id。
 * @returns 公布后的新局面；阶段未到或全部重复时即传入的那个对象。
 */
export function revealClues(state: GameState, ids: readonly string[]): GameState {
  if (state.phase === 'self-intro' || state.phase === 'inquiry') return state
  const fresh = ids.filter(id => !state.revealedClues.includes(id))
  if (fresh.length === 0) return state
  let log = state.log
  for (const id of fresh) log = append(log, state.phase, 'clue-revealed', id)
  return { ...state, revealedClues: [...state.revealedClues, ...fresh], log }
}

/**
 * 是否已到复盘阶段。
 * @param state - 当前局面。
 * @returns 到达复盘阶段为 `true`。
 */
export function isFinished(state: GameState): boolean {
  return state.phase === 'reveal'
}
