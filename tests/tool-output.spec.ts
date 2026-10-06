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

/** 一个够用的执行上下文：工具只读 `exec.agent.session.header.id`。 */
const exec = { agent: { session: { header: { id: 'spec-session' } } } }

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

  it('开一局之后，局面的返回里也没有 schema 没声明的键', async () => {
    await startGame()
    const tool = tools.find(one => one.name === 'jubensha_state')
    const value = await tool?.execute({ action: 'show' }, exec) as Record<string, unknown>
    expectDeclared('jubensha_state', tool, value)
  })
})
