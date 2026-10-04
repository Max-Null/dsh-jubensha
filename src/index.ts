/**
 * dsh-jubensha —— 一个人也能开局的剧本杀：AI 当 DM，AI 填满整张桌子。
 *
 * 本模块做两件事：把**局面状态**（`state.ts`）接到模型能调用的工具面上，以及把
 * **玩家**（`player.ts`）放上桌——后者要在子 agent 的创建窗口里收窄它的工具面，
 * 机制与源码位置见 `docs/设计/2026-10-05-spawn_player-可行方案.md`。
 * 真相手册与别人的角色本走各自独立的机制，不在本模块
 * （见 `docs/设计/2026-10-04-单机剧本杀-设计方案.md` §3.4 的六条工具需求）。
 *
 * @module @max-null/dsh-jubensha
 */
import type { Context } from '@deepseek-ai/cordis'
// 这个 type-only import 拉入 Context 上的 `subagents` 声明。本模块不把它写进 inject：
// 没有委派能力的部署仍该能用局面工具，取服务走运行时的 ctx.get。
import type { ContinuableStartSpec } from '@deepseek-ai/dsh-subagent'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { createRegistry, playerBrief, PLAYER_TOOLS } from './player.ts'
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

/** 玩家工具名。 */
const PLAYER_TOOL = 'jubensha_player'

/**
 * 这一局的玩家登记。
 *
 * 与 `current` 一样挂在模块上（单进程单局）。但它比局面状态短命得多：局面可以拿去复盘，
 * 登记表不能——里面的子会话 id 在进程结束后没有任何意义。
 */
const players = createRegistry()

/** 桌上现在有谁，一句人话；错误信息与调用结果都用它。 */
function tableText(): string {
  const sitting = players.list()
  if (sitting.length === 0) return '桌上还没有 AI 玩家'
  return sitting.map(player => `${player.seat}=${player.name}`).join('、')
}

/** 取委派服务。没有它就没有人上得了桌，所以这里直接抛，不做降级。 */
function requireSubagents(ctx: Context) {
  const subagents = ctx.get('subagents')
  if (subagents === undefined) {
    throw new Error(`这个部署里没有 subagent 服务，${PLAYER_TOOL} 用不了——需要 @deepseek-ai/dsh-subagent 与 subagent-spawn-in-process。`)
  }
  return subagents
}

/** 组装工具描述：把「什么时候该调它」写在最前面，模型据此判断而非猜。 */
function describeTool(): string {
  return 'Read or advance the current 剧本杀 (murder-mystery) game state: which phase the table is in, '
    + 'who is seated, and which clues have been dealt. Call it at every phase change so the flow lives '
    + 'in the log instead of in your memory — the debrief afterwards is a read of that log. '
    + '剧本杀局面工具：开一局 / 推进阶段 / 公布线索 / 查看当前局面。'
    + '每一个阶段切换都调一次——流程记在日志里，复盘直接读它，不靠回忆。'
}

/** 组装玩家工具的描述：同样把「什么时候该调它」写在最前面。 */
function describePlayerTool(): string {
  return 'Seat AI players at a 剧本杀 table and talk to them. A player is a continuable subagent '
    + 'restricted to one tool — send_message — so it can speak to you and read nothing else: not the case '
    + 'files, not another player\'s 角色本. Its 角色本 arrives as its first message, and every line it says '
    + 'reaches you as a send_message from it. action="say" only delivers your line; the player answers on '
    + 'its own turn, so never wait for a reply inside this call. '
    + '剧本杀玩家工具：让 AI 玩家上桌 / 对某位玩家说话 / 请他下桌 / 看桌上都有谁。'
    + 'spawn 之后玩家只拿到自己的角色本，且只能说话——他读不到本子文件，也读不到别人的角色本。'
    + 'say 只负责把话送到；玩家的回答在他自己的回合里发回来，不在这次调用里等。'
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
  // 留痕：本插件没有任何界面元素，装没装、注册了什么，只能从这里读——否则「加载成功」
  // 与「静默跳过」在外部看起来一模一样（peer 不满足时内核就是静默跳过的，界面不报错）。
  // 与 dsh-allostasis 同一条判据，它的 README「诊断」段记了来由。
  console.info(`[${name}] loaded · registers ${STATE_TOOL}, ${PLAYER_TOOL}`)
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
  ctx.tools.register(defineTool({
    name: PLAYER_TOOL,
    description: describePlayerTool(),
    parameters: {
      action: {
        type: 'string',
        enum: ['list', 'spawn', 'say', 'unseat'],
        description: 'list = 看桌上都有谁（默认）；spawn = 让一位 AI 玩家上桌；say = 把一句话转达给某位玩家；unseat = 从座位上撤掉这位玩家。',
      },
      seat: { type: 'string', description: 'spawn / say / unseat 用：座位 id，要与局面里的 seats 用同一套命名。' },
      name: { type: 'string', description: 'spawn 用：角色名。' },
      roleBook: {
        type: 'string',
        description: 'spawn 用：这个角色的角色本正文。他要守的秘密全在这里，只发给这一个玩家。',
      },
      message: { type: 'string', description: 'say 用：要对这位玩家说的话——提问、转述，或阶段提示。' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          players: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                seat: { type: 'string' },
                name: { type: 'string' },
              },
            },
          },
          delivered: { type: 'string' },
        },
      },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
    },
    async execute(args, exec) {
      let delivered: string | undefined
      switch (args.action ?? 'list') {
        case 'spawn': {
          const { seat, roleBook } = args
          const playerName = args.name
          if (seat === undefined || playerName === undefined || roleBook === undefined) {
            throw new Error('spawn 需要 seat / name / roleBook 三项都给。')
          }
          // 先问座位空不空，再建子会话。反过来的话，座位被占时那个刚建好的子会话就没人管了
          // ——登记表自己也拦这一手，但那时已经晚了。
          const sitting = players.get(seat)
          if (sitting !== undefined) throw new Error(`座位 "${seat}" 上已经有人了（${sitting.name}）；先 unseat 再 spawn。`)
          const dm = exec.agent
          if (dm === undefined) throw new Error(`${PLAYER_TOOL} 需要一个调用它的 agent。`)
          const request: ContinuableStartSpec['request'] = {
            prompt: [{ type: 'text', text: playerBrief({ seat, name: playerName, roleBook, dmId: dm.id }) }],
            parent: dm,
            toolFilter: { allow: PLAYER_TOOLS },
          }
          const started = await requireSubagents(ctx).startContinuable({
            provider: 'spawn',
            label: `玩家 ${playerName}（${seat}）`,
            request,
            signal: exec.signal,
          })
          players.seat({ seat, name: playerName, childId: started.childId })
          break
        }
        case 'say': {
          const { seat, message } = args
          if (seat === undefined || message === undefined) throw new Error('say 需要 seat 与 message 两项都给。')
          const player = players.get(seat)
          if (player === undefined) throw new Error(`座位 "${seat}" 上没人（${tableText()}）。`)
          const dm = exec.agent
          if (dm === undefined) throw new Error(`${PLAYER_TOOL} 需要一个调用它的 agent。`)
          await requireSubagents(ctx).sendMessage(
            dm,
            player.childId,
            [{ type: 'text', text: message }],
            { signal: exec.signal },
          )
          delivered = player.name
          break
        }
        case 'unseat': {
          const { seat } = args
          if (seat === undefined) throw new Error('unseat 需要 seat。')
          if (!players.unseat(seat)) throw new Error(`座位 "${seat}" 上本来就没有人（${tableText()}）。`)
          break
        }
        case 'list':
          break
      }
      return {
        players: players.list().map(player => ({ seat: player.seat, name: player.name })),
        ...delivered !== undefined ? { delivered } : {},
      }
    },
  }))
}
