/**
 * 工具的返回**键**必须都在它的 output schema 里。
 *
 * 被一次真事故逼出来的（2026-10-06）：给 `jubensha_player` 的返回值加了 `humanSeat` /
 * `notSeated` 两个字段，却忘了同步 output schema——而 schema 是 `additionalProperties: false`，
 * 于是内核判每一次调用都是非法输出，**整个工具不可用**：连 `list` 和 `unseat` 都调不动，DM
 * 那边只能看见一串红字，而它连"换个办法"都做不到（每个 action 都被同一道校验挡下）。
 *
 * **typecheck 抓不到它**：输出 schema 与返回值的对应关系不在 TypeScript 的检查范围里——
 * 多出的键在非字面量对象上是允许的。所以这条得由测试守。
 *
 * @module
 */
import { describe, expect, it } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import { apply } from '../src/index.ts'

/** 收下来的一个工具定义——只要这条测试用得着的三样。 */
interface RegisteredTool {
  name: string
  execute: (args: Record<string, unknown>, exec: unknown) => unknown
  output: { schema: { properties?: Record<string, unknown> } }
}

/**
 * 把插件装上，收下它注册的工具。
 *
 * `apply` 还要挂房间端点与 agent 监听，那几样在这里用空实现吃掉——这条测试只关心工具定义。
 * 服务（`ctx.get`）一律给 `undefined`：需要存储的那两个工具会因此自己抛错，而它们不在这一轮的
 * 覆盖范围里（`jubensha_state` 与 `jubensha_player` 不碰存储，局面与玩家登记都是模块级的）。
 * @returns 注册顺序里的工具定义。
 */
function registeredTools(): RegisteredTool[] {
  const collected: RegisteredTool[] = []
  const ctx = {
    effect: () => () => {},
    on: () => () => {},
    get: () => undefined,
    tools: {
      register: (definition: RegisteredTool) => {
        collected.push(definition)
        return () => {}
      },
    },
    webServer: { register: () => () => {} },
    webRuntime: { trustedHosts: [] },
  }
  apply(ctx as unknown as Context)
  return collected
}

/**
 * 一个够用的执行上下文。
 *
 * `snapshotEvents` 不是可有可无的：`jubensha_player` 的节奏闸要数真人在这个会话里说过几句
 * （见 `src/index.ts` 的 `humanLines`），而它读的就是这个口子。
 */
const exec = {
  agent: {
    session: {
      header: { id: 'spec-session' },
      snapshotEvents: () => [],
    },
  },
}

/**
 * 一个「真人可以开口」的上下文——`speak()` 之前他的消息数是 0，之后是 1。
 *
 * **必须是可变的一格**：节奏闸的判据是「真人的话数变了没有」，而写死的 `snapshotEvents`
 * 永远返回同一个数，于是「他一开口计数就归零」这件事压根测不出来（第一版就是这么错的）。
 * @param id - 会话 id；每条测试给不同的值，好把节奏闸的计数隔开。
 * @returns 上下文与那个翻开关的开关。
 */
function execWhereHumanSpeaks(id: string): { context: unknown, speak: () => void } {
  let spoken = false
  return {
    context: {
      agent: {
        session: {
          header: { id },
          snapshotEvents: () => (spoken
            ? [{ type: 'agent/inbox/spliced', data: { inserted: [{ source: { kind: 'user' } }] } }]
            : []),
        },
      },
    },
    speak: () => { spoken = true },
  }
}

describe('工具的返回与它声明的输出', () => {
  const tools = registeredTools()

  /**
   * 这就是内核那道校验：`additionalProperties: false` 之下，多一个键整个输出作废。
   * @param name - 工具名，出错信息里用。
   * @param tool - 那个工具的定义。
   * @param value - 它这一次的返回。
   */
  function expectDeclared(name: string, tool: RegisteredTool | undefined, value: Record<string, unknown>): void {
    expect(tool, `${name} 没注册上`).toBeDefined()
    const declared = new Set(Object.keys(tool?.output.schema.properties ?? {}))
    const extra = Object.keys(value).filter(key => !declared.has(key))
    expect(extra, `${name} 的返回里有 ${extra.join('、')}，而 output schema 没声明——`
      + '那会让这个工具的每一次调用都被判非法').toEqual([])
  }

  /**
   * 先开一局。
   *
   * **两个工具都得在有局面时才跑得出问题**：`jubensha_player` 的 `humanSeat` / `notSeated` 是
   * `game === undefined ? {} : {…}` 展开的，没开局时那两个键压根不在返回里——而事故恰恰发生在
   * 开局之后（DM 先 `start` 再 `spawn`，然后每一条都撞在同一道校验上）。
   */
  async function startGame(): Promise<void> {
    await tools.find(one => one.name === 'jubensha_state')?.execute({
      action: 'start', caseId: '01', title: '拾光照相馆',
      seats: ['p0', 'p1', 'p2', 'p3'], humanSeat: 'p0',
    }, exec)
  }

  it('四个工具都注册上了', () => {
    expect(tools.map(one => one.name).sort()).toEqual([
      'jubensha_actor', 'jubensha_case', 'jubensha_player', 'jubensha_state',
    ])
  })

  it('jubensha_player 的返回里没有 schema 没声明的键', async () => {
    await startGame()
    const tool = tools.find(one => one.name === 'jubensha_player')
    const value = await tool?.execute({ action: 'list' }, exec) as Record<string, unknown>
    // 开局之后这两个键必须真的在——否则这一条就成了「跑了个空断言」。
    expect(Object.keys(value)).toContain('humanSeat')
    expectDeclared('jubensha_player', tool, value)
  })

  it('真人不在 notSeated 里——他不是「还没上桌」，他是不用上桌', async () => {
    // 这一条是从一局实测的日志里揪出来的：那一刻 `list` 返回的是
    //   {"players": [], "humanSeat": "p0", "notSeated": ["p0","p1",…]}
    // ——真人躺在「还没上桌」里。他永远不在 `players` 里（他不 spawn），所以照「谁不在 players
    // 里」算的话他永远出现，而那个返回值到了 DM 手里就成了「真人还没上桌」。
    //
    // 这是同一个 gap 的第五次（前四次：DM 自己把局跑完、头像成灰块、自述页「还没上桌」、
    // 问话页「还没出过声」）。前四次我都在读者那里补一句；这一次修在数据上。
    await startGame()
    const tool = tools.find(one => one.name === 'jubensha_player')
    const value = await tool?.execute({ action: 'list' }, exec) as { notSeated: string[] }
    expect(value.notSeated).not.toContain('p0')
    // 而 AI 那三位还在里面（他们确实还没被叫上桌）。
    expect(value.notSeated).toEqual(['p1', 'p2', 'p3'])
  })

  it('开一局之后，局面的返回里也没有 schema 没声明的键', async () => {
    await startGame()
    const tool = tools.find(one => one.name === 'jubensha_state')
    const value = await tool?.execute({ action: 'show' }, exec) as Record<string, unknown>
    expectDeclared('jubensha_state', tool, value)
  })
})

describe('搜证那一页不能空着过去', () => {
  const tools = registeredTools()

  it('一件线索都没发时，不许从搜证推进到下一阶段', async () => {
    // 这一条也是玩出来的：2026-10-06 我在 dev 里从头玩了一局，阶段条上「问话」「搜证」都点着，
    // 而桌上一条线索都没有——DM 一路推到了投票。线索要 DM 主动发（jubensha_case action="clue"），
    // 而它没有理由记得这件事。
    const context = {
      agent: { session: { header: { id: 'spec-session-clue' }, snapshotEvents: () => [] } },
    }
    const state = tools.find(one => one.name === 'jubensha_state')
    await state?.execute({
      action: 'start', caseId: '01', title: '拾光照相馆',
      seats: ['p0', 'p1', 'p2', 'p3'], humanSeat: 'p0',
    }, context)
    /** 推一次阶段。 */
    const push = async (): Promise<string> => {
      try {
        await state?.execute({ action: 'advance' }, context)
        return ''
      } catch (error: unknown) {
        return error instanceof Error ? error.message : String(error)
      }
    }
    // 自述 → 问话 → 搜证：这两步不该被拦。
    expect(await push()).toBe('')
    expect(await push()).toBe('')
    // 搜证 → 发言投票：一件线索都没有，该拦。
    expect(await push()).toContain('一件线索都还没发')
    // 发一条之后就放行。
    //
    // **注意这里是 `state action="reveal"` 而不是 `case action="clue"`**——那两件事不一样：
    // `clue` 只把线索正文捞出来给 DM 贴到桌上，**它不动局面状态**；而搜证那一页读的是局面里的
    // `revealedClues`。第一版测试写成了 `clue`，于是"发完还是被拦"——而那个错恰好复现了这一局
    // 的真实缺陷：DM 拿到了正文、贴了，而局面里一条都没记。
    const state2 = tools.find(one => one.name === 'jubensha_state')
    await state2?.execute({ action: 'reveal', clues: ['c1'] }, context)
    expect(await push()).toBe('')
  })
})

describe('节奏闸：AI 不能自己一直玩下去', () => {
  const tools = registeredTools()
  const say = { action: 'say', seat: '*', message: '先说一遍你昨晚的经历' }

  /**
   * 跑一次 `say`，返回它的报错文案（没抛就给空串）。
   * @param context - 执行上下文。
   * @param id - 会话 id（每条测试自己一个，别撞到别人的计数）。
   * @returns 抛出来的那句话。
   */
  async function sayOnce(context: unknown): Promise<string> {
    const tool = tools.find(one => one.name === 'jubensha_player')
    try {
      await tool?.execute(say, context)
      return ''
    } catch (error: unknown) {
      return error instanceof Error ? error.message : String(error)
    }
  }

  it('连着推进三次而真人没插进来，第四次会被拦住', async () => {
    const state = tools.find(one => one.name === 'jubensha_state')
    await state?.execute({
      action: 'start', caseId: '01', title: '拾光照相馆',
      seats: ['p0', 'p1', 'p2', 'p3'], humanSeat: 'p0',
    }, exec)
    // 前三次：闸放行——它们随后会撞在「桌上还没有 AI 玩家」上（这条测试只关心闸的计数，
    // 而 spawn 要 Team 服务，这里给的是 undefined）。
    for (let index = 0; index < 3; index += 1) {
      expect(await sayOnce(exec)).toContain('桌上还没有 AI 玩家')
    }
    // 第四次：闸该拦下来，而它说的是「把话头交给他」——那是这个闸存在的全部理由。
    expect(await sayOnce(exec)).toContain('先停一下')
  })

  it('真人一开口，计数就从头开始', async () => {
    const state = tools.find(one => one.name === 'jubensha_state')
    const { context, speak } = execWhereHumanSpeaks('spec-session-with-human')
    await state?.execute({
      action: 'start', caseId: '01', title: '拾光照相馆',
      seats: ['p0', 'p1', 'p2', 'p3'], humanSeat: 'p0',
    }, context)
    // 他没开口时连着推三次，第四次会被拦。
    for (let index = 0; index < 3; index += 1) await sayOnce(context)
    expect(await sayOnce(context)).toContain('先停一下')
    // **他开口之后**：计数归零，于是又能往下推了。
    speak()
    expect(await sayOnce(context)).toContain('桌上还没有 AI 玩家')
  })

  it('转达也过闸——这一条是被实测逼出来的', async () => {    // 上一版只拦 `say`，理由是「拦 relay 等于掐断对话」。而实测（2026-10-06 用户报的第三局）：
    // `say` 两次（没到阈值）而 `relay` 转了十二次——六个来回，真人一句没说。
    // 转达十几轮而不叫他，与推三个阶段是同一个效果。
    const state = tools.find(one => one.name === 'jubensha_state')
    const context = {
      agent: { session: { header: { id: 'spec-session-relay' }, snapshotEvents: () => [] } },
    }
    await state?.execute({
      action: 'start', caseId: '01', title: '拾光照相馆',
      seats: ['p0', 'p1', 'p2', 'p3'], humanSeat: 'p0',
    }, context)
    const tool = tools.find(one => one.name === 'jubensha_player')
    /** 跑一次 relay，返回它的报错文案。 */
    const relayOnce = async (): Promise<string> => {
      try {
        await tool?.execute({ action: 'relay', seat: 'p1' }, context)
        return ''
      } catch (error: unknown) {
        return error instanceof Error ? error.message : String(error)
      }
    }
    // 前三次：闸放行，随后撞在「座位上没有人」上（这条测试只关心闸的计数）。
    for (let index = 0; index < 3; index += 1) {
      expect(await relayOnce()).not.toContain('先停一下')
    }
    expect(await relayOnce()).toContain('先停一下')
  })
})
