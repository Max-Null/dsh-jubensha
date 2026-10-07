/**
 * 桌上的广播——**一句话说出口，桌上每个人都收到同一份**。
 *
 * ## 它替换掉的是什么
 *
 * 在这之前，「桌上所有人听得见所有人」靠的是主持人手打 `relay` / `say`：玩家把话发给 lead，
 * 再由 lead 一句句转出去。而 2026-10-06 ~ 10-07 的四起实测错位全出在那道手上——
 * 署名不准、**地址被摘**（真人说「回阿May：你说你进门的时候我才走」，广播版成了
 * 「你说你进门的时候我才走」，而苏小满也是进过门的人）、「你可以接」。
 * 见 `docs/设计/2026-10-07-桌上说话-公共信道.md`。
 *
 * ## 它做什么、不做什么
 *
 * **只做传输**：把真人说的话与 AI 玩家说的话，署名 + 原文一字不改地送到桌上其余每个人。
 * **「对谁说」留在话里**（「阿May，你几点到的？」），传输层不碰它。
 *
 * **判断不是它的活**：谁在回避、该把话头交给谁、要不要拦——那些是主持人（见设计文档 §3.1 的
 * 分工表）。所以这个模块里没有一句判断语义的代码。
 *
 * ## 两条必须记住的约束
 *
 * 1. **跳过主持人自己的话。** 主持人的 `say` 也落在同一个会话里，而它已经自己发过一次了——
 *    一起广播等于同一句说两遍。
 * 2. **定时器包在 `ctx.effect` 里。** 插件卸载之后它不能还活着去读一个已经不存在的局面。
 *
 * @module @max-null/dsh-jubensha/broadcast
 */
import type { Context } from '@deepseek-ai/cordis'
import { SessionId, SessionLogOffset } from '@deepseek-ai/dsh-session/types'
import type { Agent } from '@deepseek-ai/dsh-agent'

/** 一句话，连同它是谁说的。 */
export interface HeardLine {
  /** 事件序号（去重与排序都用它）。 */
  readonly seq: number
  /** 说话的座位；认不出来时为空串。 */
  readonly seat: string
  /** 有没有署名可给（真人一律给「你」以外的称呼由渲染方决定，这里给空串表示真人）。 */
  readonly text: string
}

/**
 * 剥掉 Team 消息自带的信封，把发信人留下来。
 *
 * 玩家经 Team 的 `send_message` 发来的话，正文前面带着 `Team message <id> from <成员名>: `
 * ——那是信道的记账，不是他说的话。**而那个成员名是这一段里唯一能分辨"谁说的"的东西**，
 * 它的前缀就是座位 id。同一段解析在浏览器半边也有一份（`client/said.ts`），
 * 那一份管显示，这一份管广播；两边都依赖信道的同一个信封格式。
 * @param text - 原始正文。
 * @returns 剥掉信封的正文与座位号；没有信封时座位为空串。
 */
function unwrap(text: string): { text: string, seat: string } {
  const match = /^Team message \S+ from (\S+):\s*/u.exec(text)
  if (match === null) return { text, seat: '' }
  return { text: text.slice(match[0].length).trim(), seat: (match[1] ?? '').split('-')[0] ?? '' }
}

/**
 * 把一条消息的 `content` 拍成一段文字。
 *
 * 富结构（`[{ type: 'text', text }]` 起头，也可能夹着别的），而广播只关心文字。
 * 拍不出文字就给空串，让调用方丢掉这一条。
 * @param content - 事件里的 `content`。
 * @returns 文字与座位号。
 */
function flatten(content: unknown): { text: string, seat: string } {
  if (typeof content === 'string') return unwrap(content.trim())
  if (!Array.isArray(content)) return { text: '', seat: '' }
  const parts: string[] = []
  for (const item of content) {
    if (typeof item === 'string') { parts.push(item); continue }
    if (typeof item !== 'object' || item === null) continue
    const one = item as { type?: unknown, text?: unknown }
    if (one.type === 'text' && typeof one.text === 'string') parts.push(one.text)
  }
  return unwrap(parts.join('\n').trim())
}

/**
 * 从一个会话事件里挑出「桌上的话」。
 *
 * 三种来源分得清：真人是 `source.kind === 'user'`；AI 玩家经 Team 来的是 `team-message`
 * （信封里带座位号）；其余（注入、别的插件）不是桌上说的话。
 * @param event - 一条会话事件。
 * @returns 这一批里的桌上发言，按顺序。
 */
export function tableLinesOf(event: { type: string, seq: number, data?: unknown }): HeardLine[] {
  if (event.type !== 'agent/inbox/spliced') return []
  const data = event.data as { inserted?: unknown } | undefined
  const inserted = Array.isArray(data?.inserted) ? data.inserted : []
  const lines: HeardLine[] = []
  for (const item of inserted) {
    if (typeof item !== 'object' || item === null) continue
    const one = item as { content?: unknown, source?: { kind?: unknown } }
    const kind = typeof one.source?.kind === 'string' ? one.source.kind : ''
    const { text, seat } = flatten(one.content)
    if (text === '') continue
    if (kind === 'user') { lines.push({ seq: event.seq, seat: '', text }); continue }
    if (kind === 'team-message' && seat !== '') lines.push({ seq: event.seq, seat, text })
  }
  return lines
}

/**
 * 广播器：每个被记着的会话一个游标，每两秒读一次增量。
 *
 * **为什么是「读增量」而不是「订阅」**：DSH 的会话事件没有 `session.on()` 那样的口子，
 * 而 `snapshotEvents(fromSeq)` 带区间参数——所以宿主自己记住上次读到哪儿。
 */
export interface Broadcaster {
  /**
   * 让一个会话开始被广播。
   * @param sessionId - 会话 id（也就是局面的键）。
   * @param say - 把一句话送给桌上其他人；**返回送给几个人**（0 表示桌上没有别人）。
   *   那个数用来打日志——第一版 sink 不给回执，于是桌上一个人都没有时也报「广播到桌上其余人」。
   */
  watch(sessionId: string, say: (line: HeardLine) => Promise<number>): void
  /** 停止广播一个会话（散场、或者局面没了）。 */
  unwatch(sessionId: string): void
}

/** 每两秒读一次增量。再密没有意义（一轮发言本来就是几十秒级的），再疏会让人觉得「反应慢」。 */
const TICK_MS = 2000

/**
 * 造一个广播器，并把它的定时器挂进 `ctx.effect`。
 *
 * @param ctx - 插件上下文，用来取 agent 注册表。
 * @returns 广播器；`watch` 之后那个会话的增量才会被读。
 */
export function createBroadcaster(ctx: Context): Broadcaster {
  /** 会话 → 上次读到哪个 seq。 */
  const cursors = new Map<string, number>()
  /** 会话 → 送话的那条路。 */
  const sinks = new Map<string, (line: HeardLine) => Promise<number>>()
  /** 正在跑的那一轮——防止两秒内的两次 tick 叠在一起。 */
  let running = false

  /** 读一遍所有被看着的会话。 */
  async function tick(): Promise<void> {
    if (running) return
    running = true
    try {
      const agents = ctx.get('agents')
      if (agents === undefined) {
        // 拿不到 agent 注册表——那意味着一个字也送不出去，而它不该是静默的。
        console.warn('[jubensha] 广播器读不到 agents 服务，桌上说话的广播这一轮没跑')
        return
      }
      for (const [sessionId, sink] of sinks) {
        const lead = agents.get(SessionId(sessionId)) as Agent | undefined
        if (lead === undefined) continue
        const from = cursors.get(sessionId) ?? 0
        let events: readonly { type: string, seq: number, data?: unknown }[]
        try {
          events = lead.session.snapshotEvents(SessionLogOffset(from)) as unknown as readonly { type: string, seq: number, data?: unknown }[]
        } catch (error: unknown) {
          // 读不到就下一轮再试——一个会话读失败不该拖住别的会话。而同样要留痕。
          console.warn(`[jubensha] 广播器读不到 ${sessionId} 的增量（from=${String(from)}）：`
            + (error instanceof Error ? error.message : String(error)))
          continue
        }
        // 一段一段看清：读到了多少事件、其中多少条是桌上的发言。
        //
        // 这一行是**诊断**而不是叙事：第一版这里什么都没有，于是「广播一条没送」与「桌上没人
        // 说话」在外部完全一样（2026-10-07 实测栽在这里）。只在**读到东西**时打，所以平时安静。
        if (events.length > 0) {
          const lines = events.flatMap(event => tableLinesOf(event))
          const kinds = [...new Set(events.map(event => event.type))].join('、')
          console.info(`[jubensha] 广播器读到 ${String(events.length)} 条事件（${kinds}）、`
            + `桌上发言 ${String(lines.length)} 条`)
        }
        for (const event of events) {
          for (const line of tableLinesOf(event)) {
            // 送不出去不能让整轮停住：桌上少听见一句，比广播器整个哑掉轻。
            //
            // **但必须留痕。** 第一版这里是空 catch——于是「广播一条都没送出去」在外部看起来
            // 与「桌上没人说话」一模一样（2026-10-07 实测：一整局下来玩家会话里一条广播都没有，
            // 而我只能靠翻会话才知道）。静默失败与静默跳过长得一样，那是这一路反复踩的坑。
            try {
              const delivered = await sink(line)
              // 送出成功的痕迹也留一行——**但只在真送出时**（每 2 秒一行会把这日志淹掉），
              // 而**人数要准**：桌上一个人都没有就不该报「广播了」。
              if (delivered > 0) {
                console.info(`[jubensha] 广播 ${line.seat === '' ? '真人' : line.seat} 的一句`
                  + `（${String(line.text.length)} 字）给 ${String(delivered)} 位`)
              }
            } catch (error: unknown) {
              console.warn(`[jubensha] 广播失败（${sessionId} · ${line.seat === '' ? '真人' : line.seat}）：`
                + (error instanceof Error ? error.message : String(error)))
            }
          }
        }
        // 游标推到这一批的末尾——`snapshotEvents` 给的是 [from, seq)，所以末条的 seq + 1。
        const last = events[events.length - 1]
        if (last !== undefined) cursors.set(sessionId, last.seq + 1)
        else cursors.set(sessionId, from)
      }
    } finally {
      running = false
    }
  }

  ctx.effect(() => {
    const timer = setInterval(() => { void tick() }, TICK_MS)
    return () => { clearInterval(timer) }
  }, 'jubensha: table broadcast')

  return {
    watch(sessionId, say) {
      sinks.set(sessionId, say)
      // 起点是「现在」：开播之前的历史不该被补播——那会在一局的中途把旧话重放一遍。
      if (!cursors.has(sessionId)) {
        const agents = ctx.get('agents')
        const lead = agents?.get(SessionId(sessionId)) as Agent | undefined
        cursors.set(sessionId, lead?.session.seq ?? 0)
      }
    },
    unwatch(sessionId) {
      sinks.delete(sessionId)
      cursors.delete(sessionId)
    },
  }
}
