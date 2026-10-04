/**
 * dsh-jubensha —— 一个人也能开局的剧本杀：AI 当 DM，AI 填满整张桌子。
 *
 * 本模块只做一件事：把**局面状态**（`state.ts`）接到模型能调用的工具面上。
 * 它刻意不碰真相、不碰角色本、不碰玩家的上下文——那些走各自独立的机制
 * （见 `docs/设计/2026-10-04-单机剧本杀-设计方案.md` §3.4 的六条工具需求）。
 *
 * @module @max-null/dsh-jubensha
 */
import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { advance, createGame, isFinished, revealClues } from './state.ts'
import type { GameState } from './state.ts'

/** 插件名。 */
export const name = 'dsh-jubensha'

/** 需要工具注册表。 */
export const inject = ['tools']

/**
 * 当前这一局。
 *
 * **单进程单局**：状态挂在模块上，不是挂在会话上。一个进程同时开两局会互相覆盖——
 * 要做多局并存，得把状态挪到会话作用域（`ctx.agents` 那条线），那是下一步的事。
 */
let current: GameState | undefined

/** 工具名。 */
const STATE_TOOL = 'jubensha_state'

/** 没开局时的统一错误文本。 */
const NO_GAME = '还没有开局——先用 action="start" 给出 caseId / title / seats / humanSeat。'

/** 组装工具描述：把「什么时候该调它」写在最前面，模型据此判断而非猜。 */
function describeTool(): string {
  return 'Read or advance the current 剧本杀 (murder-mystery) game state: which phase the table is in, '
    + 'who is seated, and which clues have been dealt. Call it at every phase change so the flow lives '
    + 'in the log instead of in your memory — the debrief afterwards is a read of that log. '
    + '剧本杀局面工具：开一局 / 推进阶段 / 公布线索 / 查看当前局面。'
    + '每一个阶段切换都调一次——流程记在日志里，复盘直接读它，不靠回忆。'
}

/**
 * 把一次调用的结果整理成工具返回值。
 *
 * 数组要复制成可变副本：`GameState` 的字段都是 `readonly`，而工具的输出契约按可变数组
 * 声明（schema 表达不了 readonly），直接把状态里的数组交出去会类型不符。复制顺带也避免了
 * 调用方改到状态内部。
 */
function snapshot(state: GameState) {
  return {
    ...state,
    seats: [...state.seats],
    revealedClues: [...state.revealedClues],
    log: [...state.log],
    finished: isFinished(state),
  }
}

/**
 * 注册局面工具；监听器与注册项随 `ctx` 生命周期销毁。
 * @param ctx - 插件上下文。
 */
export function apply(ctx: Context): void {
  ctx.tools.register(defineTool({
    name: STATE_TOOL,
    description: describeTool(),
    parameters: {
      action: {
        type: 'string',
        enum: ['show', 'start', 'advance', 'reveal'],
        description: 'show = 查看当前局面（默认）；start = 开一局；advance = 推进到下一阶段；reveal = 公布线索到桌上。',
      },
      caseId: { type: 'string', description: 'start 用：本子编号，如 "01"。' },
      title: { type: 'string', description: 'start 用：本子名，如「拾光照相馆」。' },
      seats: {
        type: 'array',
        items: { type: 'string' },
        description: 'start 用：桌上的位子（角色 id），按发言顺序。',
      },
      humanSeat: { type: 'string', description: 'start 用：真人占的角色 id。' },
      clues: {
        type: 'array',
        items: { type: 'string' },
        description: 'reveal 用：本次公布到桌上的线索 id（只给 id，线索正文由本子决定，不进这里）。',
      },
    },
    output: {
      // 写成真实形状而不是 `{ type: 'json' }`：后者要求值带字符串索引签名，
      // 而 GameState 是 named interface（字段还都是 readonly），赋不过去。
      // 而且描述真实字段本来就是更准确的契约——模型看到的就是它实际拿到的。
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          caseId: { type: 'string' },
          title: { type: 'string' },
          seats: { type: 'array', items: { type: 'string' } },
          humanSeat: { type: 'string' },
          phase: { type: 'string' },
          round: { type: 'integer' },
          revealedClues: { type: 'array', items: { type: 'string' } },
          log: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                at: { type: 'integer' },
                phase: { type: 'string' },
                kind: { type: 'string' },
                detail: { type: 'string' },
              },
            },
          },
          finished: { type: 'boolean' },
        },
      },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
    },
    execute(args) {
      switch (args.action ?? 'show') {
        case 'start': {
          const { caseId, title, seats, humanSeat } = args
          if (caseId === undefined || title === undefined || seats === undefined || humanSeat === undefined) {
            throw new Error('开局需要 caseId / title / seats / humanSeat 四项都给。')
          }
          current = createGame({ caseId, title, seats, humanSeat })
          break
        }
        case 'advance': {
          if (current === undefined) throw new Error(NO_GAME)
          current = advance(current)
          break
        }
        case 'reveal': {
          if (current === undefined) throw new Error(NO_GAME)
          current = revealClues(current, args.clues ?? [])
          break
        }
        case 'show':
          break
      }
      if (current === undefined) throw new Error(NO_GAME)
      return Promise.resolve(snapshot(current))
    },
  }))
}
