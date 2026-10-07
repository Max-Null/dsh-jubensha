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
/** 那一次 `apply` 里注册过的 `tools/pre-execute` 钩子（测试要手动触发它们）。 */
const preExecuteHooks: ((exec: { name: string, agent?: unknown }, next: () => Promise<unknown>) => Promise<unknown>)[] = []

function registeredTools(): RegisteredTool[] {
  const collected: RegisteredTool[] = []
  const ctx = {
    effect: () => () => {},
    // **钩子不能吞掉。** 假 ctx 原先这里是 `() => () => {}`，于是插件注册的
    // `tools/pre-execute`（桌上转太久了要提醒主管人那道闸挂在那儿）在测试里从来没跑过——
    // 而它在生产里是有效的（同一个钩子拦住过玩家的 `list_agents`）。
    // 记下来，让测试自己 fire。
    on: (name: string, callback: (exec: { name: string, agent?: unknown }, next: () => Promise<unknown>) => Promise<unknown>) => {
      if (name === 'tools/pre-execute') preExecuteHooks.push(callback)
      return () => {}
    },
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
  preExecuteHooks.length = 0
  apply(ctx as unknown as Context)
  return collected
}

/**
 * 走一遍真实执行路径上的那道闸（内核在工具解析之后、执行之前会跑它）。
 *
 * 假 ctx 不会自己 dispatch，所以测试显式调一次——**不这么做就等于测了个没有闸的世界**。
 * @param name - 工具名。
 * @param agent - 执行者。
 * @returns 拦下来的理由；放行时给空串。
 */
async function preExecute(name: string, agent: unknown): Promise<string> {
  for (const hook of preExecuteHooks) {
    const verdict = await hook({ name, agent }, () => Promise.resolve())
    if (verdict !== undefined && verdict !== null && typeof verdict === 'object' && 'kind' in verdict) {
      return String((verdict as { reason?: unknown }).reason ?? '')
    }
  }
  return ''
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
  async function startGame(): Promise<{ agent: { session: unknown } }> {
    // **每次用一个新的会话 id**，并把那个上下文还回去。
    //
    // 「一个会话只能开一局」是 2026-10-07 加的闸（重复开局会重置局面、把已经上桌的人丢在原地），
    // 而这一组里好几个测试各自开一局——它们不该撞在同一个会话上；而调用方也必须拿**同一个**
    // 会话去调后面的工具（局面按会话存）。
    const context = {
      agent: {
        session: {
          header: { id: `spec-session-${String(Math.random()).slice(2, 10)}` },
          snapshotEvents: () => [],
        },
      },
    }
    await tools.find(one => one.name === 'jubensha_state')?.execute({
      action: 'start', caseId: '01', title: '拾光照相馆',
      seats: ['p0'], humanSeat: 'p0',
    }, context)
    return context
  }

  it('四个工具都注册上了', () => {
    expect(tools.map(one => one.name).sort()).toEqual([
      'jubensha_actor', 'jubensha_case', 'jubensha_player', 'jubensha_state',
    ])
  })

  it('jubensha_player 的返回里没有 schema 没声明的键', async () => {
    // **必须用 startGame 还回来的那个上下文**：局面按会话存，而 startGame 每次用一个新会话 id
    // （「一个会话只能开一局」那道闸）。用共享的 exec 去调，等于问另一个会话——那里没有局面，
    // 返回里就没有 humanSeat，于是这一条会变成一个跑不到东西的空断言。
    const game = await startGame()
    const tool = tools.find(one => one.name === 'jubensha_player')
    const value = await tool?.execute({ action: 'list' }, game) as Record<string, unknown>
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
    //
    // **这一条要用一张满座的桌**：它验的是「真人不在 notSeated 里，而 AI 那几个还在」——
    // 只有真人的桌子看不出区别（两边都是空）。
    const state = tools.find(one => one.name === 'jubensha_state')
    await state?.execute({
      action: 'start', caseId: '01', title: '拾光照相馆',
      seats: ['p0', 'p1', 'p2', 'p3'], humanSeat: 'p0',
    }, exec)
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

describe('自述完了就得有账', () => {
  const tools = registeredTools()

  it('还有人的行踪没记进时间线时，不许从自述推进', async () => {
    // 用户 2026-10-07 报的：「时间线检测还是有点问题，这个数据是从哪来的？」——答案是那一栏读
    // `timeline`（DM 主动记的），而 DM 听清了每个人的行踪却一条都没记，于是它一直写着
    // 「其余时段还没有人交代」。而「听到行踪就顺手记一笔」在指令里只是一句叮嘱。
    const context = {
      agent: { session: { header: { id: 'spec-session-timeline' }, snapshotEvents: () => [] } },
    }
    const state = tools.find(one => one.name === 'jubensha_state')
    await state?.execute({
      action: 'start', caseId: '01', title: '拾光照相馆',
      seats: ['p0', 'p1', 'p2'], humanSeat: 'p0',
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
    // 两条都没有——报错要把**缺谁**说清（而不是只说「空的」）。
    expect(await push()).toContain('p0、p1、p2')
    // 记上一条：还缺两个。
    await state?.execute({ action: 'timeline', entries: [{ at: '20:00', seat: 'p0', doing: '到店' }] }, context)
    expect(await push()).toContain('p1、p2')
    // 记齐了才放行。
    await state?.execute({
      action: 'timeline',
      entries: [
        { at: '20:00', seat: 'p1', doing: '跟老周下了两盘棋' },
        { at: '21:00', seat: 'p2', doing: '八点多来了一趟' },
      ],
    }, context)
    expect(await push()).toBe('')
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
      seats: ['p0'], humanSeat: 'p0',
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
    // 自述 → 问话：这一步要先有行踪（另一道闸管那个），所以先记一条。
    //
    // **这就是新加的那道闸在教 DM 的动作**：自述阶段每个人说完自己那段之后，DM 该把行踪
    // 记进时间线——不然房间页左栏那一栏一直是空的（用户 2026-10-07 报的）。
    expect(await push()).toContain('昨晚行踪还没记进时间线')
    await state?.execute({
      action: 'timeline',
      entries: [{ at: '21:20', seat: 'p0', doing: '到店，叔叔不在柜台，等了十几分钟' }],
    }, context)
    expect(await push()).toBe('')
    // 问话 → 搜证：也该过。
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

describe('桌上转太久了，该把话头交给真人', () => {
  const tools = registeredTools()

  /** 造一个主持人上下文：玩家发言条数**每次读都在长**（桌上是活的），真人说 `human` 条。 */
  function dmContext(id: string, count: number, human: number): { context: Record<string, unknown>, grow: (to: number) => void } {
    // **起手就是 `count` 条**（这参数第一版忘了用，于是「11 条」那张桌子其实是空的）。
    let players = count
    const events: unknown[] = []
    let seq = 0
    /** 按当前数补齐事件。 */
    const rebuild = (): void => {
      events.length = 0
      seq = 0
      for (let index = 0; index < players; index += 1) {
        seq += 1
        events.push({
          type: 'agent/inbox/spliced',
          seq,
          data: { inserted: [{ content: [{ type: 'text', text: `Team message m-${String(index)} from p3-x: 第 ${String(index)} 句` }], source: { kind: 'team-message' } }] },
        })
      }
      for (let index = 0; index < human; index += 1) {
        seq += 1
        events.push({
          type: 'agent/inbox/spliced',
          seq,
          data: { inserted: [{ content: [{ type: 'text', text: `真人第 ${String(index)} 句` }], source: { kind: 'user' } }] },
        })
      }
    }
    rebuild()
    return {
      context: { agent: { session: { header: { id }, snapshotEvents: () => events } } },
      grow(to: number) { players = to; rebuild() },
    }
  }

  it('玩家连着说十几条而真人没说话，主持人的下一个动作会被拦下来', async () => {
    // 用户 2026-10-07 报的：「演员们玩的挺嗨啊，又把我无视了，DM不干预吗？」
    // 那一局：真人 2 次 / 玩家 **647 次** / DM 只开口 3 次——而旧的节奏闸数的是 DM 的开口次数，
    // 所以整局一次都没触发。这道闸数的是**桌上玩家说了多少条**。
    const { context, grow } = dmContext('spec-session-table-pace', 0, 0)
    const state = tools.find(one => one.name === 'jubensha_state')
    await state?.execute({ action: 'start', caseId: '01', title: '拾光照相馆', seats: ['p0', 'p1'], humanSeat: 'p0' }, context)
    /** 调一次：先过那道闸（内核在真实路径上就是这么做的），再执行。 */
    const poke = async (): Promise<string> => {
      const denied = await preExecute('jubensha_state', context.agent)
      if (denied !== '') return denied
      try {
        const result = await state?.execute({ action: 'show' }, context) as unknown
        return result === undefined ? '（没返回）' : ''
      } catch (error: unknown) {
        return error instanceof Error ? error.message : String(error)
      }
    }
    // **顺序要紧**：第一次过闸只是记基准（那一刻桌上有多少条就是起点）。
    // 所以先空跑一次，再让桌上涨起来——那才是真实形状：开局定基准，而后桌上一直转、真人没说。
    await poke()
    grow(20)
    const blocked = await poke()
    expect(blocked).toContain('先停一下')
    // 提醒里要有出路：点名字 + 问具体的 + 然后停下。
    expect(blocked).toContain('把话头点给他')
    expect(blocked).toContain('把这一轮结束掉')
    // 而它**只拦一次**——再拦下去等于把主持人卡死（而不是提醒它）。
    expect(await poke()).toBe('')
  })

  it('基准从开局那一刻起算——不必先空跑一次', async () => {
    // 实测（2026-10-07 晚）：基准原先记在「主持人第一次调插件工具」那一刻，而那时桌上可能已经
    // 聊了几十条——用户看到的是「182 才让用户有参与感，平均每个人都说了 30 多句话了」。
    // 现在 `start` 就把它定成 0，所以桌上说到第 8 条时第一次拦就来了。
    const { context } = dmContext('spec-session-table-pace-from-start', 8, 0)
    const state = tools.find(one => one.name === 'jubensha_state')
    await state?.execute({ action: 'start', caseId: '01', title: '拾光照相馆', seats: ['p0', 'p1'], humanSeat: 'p0' }, context)
    // 开局之后**直接**调一次——中间没有「空跑记基准」那一步。
    const blocked = await preExecute('jubensha_state', context.agent)
    expect(blocked).toContain('先停一下')
    // 而理由里要写清「光停下不算」——那是上一版漏掉的一半。
    expect(blocked).toContain('只做第 2 件是不够的')
  })

  it('真人说过话之后，桌上重新计时', async () => {
    // 真人说完之后基准跟着走——所以接下来这十几条不该立刻又被拦。
    const { context, grow } = dmContext('spec-session-table-pace-human', 11, 1)
    const state = tools.find(one => one.name === 'jubensha_state')
    await state?.execute({ action: 'start', caseId: '01', title: '拾光照相馆', seats: ['p0', 'p1'], humanSeat: 'p0' }, context)
    // 基线：真人刚说完那一次过闸 → 记下「此刻桌上有 11 条」。
    expect(await preExecute('jubensha_state', context.agent)).toBe('')
    grow(14)
    // 又转了几条——还没到阈值，不拦。
    expect(await preExecute('jubensha_state', context.agent)).toBe('')
  })
})

describe('一个会话只能开一局', () => {
  const tools = registeredTools()

  it('重复 start 会被拦下来，并说清为什么', async () => {
    // 实测（2026-10-07）：同一个会话里 `start` 被调了三次（07 → 01 → 07），而每一次都重置局面——
    // 已经 spawn 的玩家还在 Team 名册里（不可移除），而座位表被清空了，于是下一次 spawn 撞
    // 「座位上已经有人了」，而房间里看起来像什么也没发生过。那一次是我自己造的（同一会话里点了
    // 两次「开一局」），而**闸不该依赖调用者自觉**。
    const context = {
      agent: { session: { header: { id: 'spec-session-once' }, snapshotEvents: () => [] } },
    }
    const state = tools.find(one => one.name === 'jubensha_state')
    await state?.execute({
      action: 'start', caseId: '01', title: '拾光照相馆',
      seats: ['p0', 'p1'], humanSeat: 'p0',
    }, context)
    /** 再开一次。 */
    const again = await (async (): Promise<string> => {
      try {
        await state?.execute({
          action: 'start', caseId: '07', title: '夜场',
          seats: ['p0', 'p1'], humanSeat: 'p0',
        }, context)
        return ''
      } catch (error: unknown) {
        return error instanceof Error ? error.message : String(error)
      }
    })()
    expect(again).toContain('已经有一局了')
    // 报错要说清出路：换会话，而不是「再试一次」。
    expect(again).toContain('换会话')
    // 而**局面没被换掉**——那正是这条闸要保的东西。
    const shown = await state?.execute({ action: 'show' }, context) as { title?: string }
    expect(shown.title).toBe('拾光照相馆')
  })
})

describe('桌上说话不用主持人转达', () => {
  const tools = registeredTools()

  it('主持人用 say 转达玩家的原话时，会被拦下来', async () => {
    // 实测（2026-10-07）：广播上线之后，指令里只说了「不用 relay」，而它一直用 say 转达
    // （「【主持人转达·某某的原话】」）——同一件事的另一种写法，于是桌上会把这句看见两遍。
    const context = {
      agent: { session: { header: { id: 'spec-session-relay-say' }, snapshotEvents: () => [] } },
    }
    const state = tools.find(one => one.name === 'jubensha_state')
    await state?.execute({ action: 'start', caseId: '01', title: '拾光照相馆', seats: ['p0'], humanSeat: 'p0' }, context)
    const player = tools.find(one => one.name === 'jubensha_player')
    /** 试着说一句。 */
    const say = async (message: string): Promise<string> => {
      try {
        await player?.execute({ action: 'say', seat: '*', message }, context)
        return ''
      } catch (error: unknown) {
        return error instanceof Error ? error.message : String(error)
      }
    }
    // 转达的写法绕不开这几个字眼——它们会被拦。
    expect(await say('【主持人转达·林默的原话】「我 21:45 走的」')).toContain('先别转达')
    expect(await say('转达·阿May：她说她九点前就走了')).toContain('先别转达')
    // 而主持人自己说话不会被误伤（那才是它的嘴该干的）。
    expect(await say('武斌，你还没答我——22:00 那十几分钟你在哪儿？')).not.toContain('先别转达')
  })
})

describe('人齐了才开场', () => {
  const tools = registeredTools()

  it('还有座位没上桌时，谁都不许开口', async () => {
    // 这一条是用户 2026-10-07 报的：小满还没上桌，阿May 就开始问真人了。从那一局的调用序列
    // 看得很清楚——`spawn p1` → p1 自述 → `spawn p2` → **p2 就开口了**，而 p3 还没 spawn。
    // DM 把「一个个请他们上桌」理解成了「上一个说完就叫下一个，而叫完就让他说话」，
    // 于是第三个人上桌的节奏被前两个人打断了。
    const context = {
      agent: { session: { header: { id: 'spec-session-seated' }, snapshotEvents: () => [] } },
    }
    const state = tools.find(one => one.name === 'jubensha_state')
    await state?.execute({
      action: 'start', caseId: '01', title: '拾光照相馆',
      seats: ['p0', 'p1', 'p2', 'p3'], humanSeat: 'p0',
    }, context)
    const player = tools.find(one => one.name === 'jubensha_player')
    /** 试着说一句。 */
    const speak = async (): Promise<string> => {
      try {
        await player?.execute({ action: 'say', seat: '*', message: '各位好' }, context)
        return ''
      } catch (error: unknown) {
        return error instanceof Error ? error.message : String(error)
      }
    }
    // 三个 AI 位一个都没上桌——该拦，而报错要说清还缺谁。
    const blocked = await speak()
    expect(blocked).toContain('桌上还缺人')
    expect(blocked).toContain('p1')
    expect(blocked).toContain('p3')
    // 而 `relay` 也过同一道闸（桌上缺人时转达，缺的那个人收不到）。
    const relayed = await (async () => {
      try {
        await player?.execute({ action: 'relay', seat: 'p1' }, context)
        return ''
      } catch (error: unknown) {
        return error instanceof Error ? error.message : String(error)
      }
    })()
    expect(relayed).toContain('桌上还缺人')
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
    // 用自己的会话（「一个会话只能开一局」那道闸：共享 exec 可能已被别的测试开过局）。
    const mine = { agent: { session: { header: { id: 'spec-session-pace' }, snapshotEvents: () => [] } } }
    const state = tools.find(one => one.name === 'jubensha_state')
    await state?.execute({
      action: 'start', caseId: '01', title: '拾光照相馆',
      seats: ['p0'], humanSeat: 'p0',
    }, mine)
    // 前三次：闸放行——它们随后会撞在「桌上还没有 AI 玩家」上（这条测试只关心闸的计数，
    // 而 spawn 要 Team 服务，这里给的是 undefined）。
    for (let index = 0; index < 3; index += 1) {
      expect(await sayOnce(mine)).toContain('桌上还没有 AI 玩家')
    }
    // 第四次：闸该拦下来，而它说的是「把话头交给他」——那是这个闸存在的全部理由。
    expect(await sayOnce(mine)).toContain('先停一下')
  })

  it('真人一开口，计数就从头开始', async () => {
    const state = tools.find(one => one.name === 'jubensha_state')
    const { context, speak } = execWhereHumanSpeaks('spec-session-with-human')
    await state?.execute({
      action: 'start', caseId: '01', title: '拾光照相馆',
      seats: ['p0'], humanSeat: 'p0',
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
      seats: ['p0'], humanSeat: 'p0',
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
