/**
 * 桌上的玩家 —— 谁在位子上、以及他上台时被告知了什么。
 *
 * **为什么与 `state.ts` 分开**：`state.ts` 记的是「这一局到哪了」，那些是可以写进日志、
 * 事后能复盘的事实；这里记的是「哪个座位背后挂着哪个子会话」，是运行时的句柄，
 * 会话断掉之后既没有意义也不该被持久化。两者寿命不同，混在一起会让局面状态带上
 * 不可序列化的字段。
 *
 * 玩家的核心约束是**只能说话**：`PLAYER_TOOLS` 是交给
 * `ctx.subagents.startContinuable` 的白名单，由内核在子 agent 的创建窗口里
 * 施加为 `tools.restrict()`。机制的确认过程与源码位置见
 * [`docs/设计/2026-10-05-spawn_player-可行方案.md`](../docs/设计/2026-10-05-spawn_player-可行方案.md)。
 *
 * @module @max-null/dsh-jubensha/player
 */
import type { ContinuableStart } from '@deepseek-ai/dsh-subagent'

/** 玩家背后的子会话 id，跨 activation 稳定。 */
export type PlayerChildId = ContinuableStart['childId']

/**
 * 玩家能看到的全部工具。
 *
 * **用白名单而不是黑名单**：新内核会加新工具，逐个 `deny` 的清单会随时间过期，
 * 而 `allow` 只保留点名的那些，天然免疫这件事。代价是名单里的名字必须真实存在——
 * `tools.restrict()` 对未知名字直接抛错，错误信息还会列出全部已知工具名。
 * 那个失败模式正好是我们想知道的：名单里少了 `send_message`，就等于玩家没法开口。
 *
 * **它管不到 agent 自己 scope 里注册的工具**（2026-10-05 实测）。`restrict` 的语义是
 * 「过滤一个 scope **继承**到的东西 —— global 层与链上每一层祖先，从不包括它自己那层」
 * （`core/tools/src/index.ts` 的 `view()`）。而内核的委派工具 `subagent` 恰好是每个 agent
 * 创建时注册进它自己 scope 的（`subagent/tool-subagent/src/index.ts:665-683` 用
 * `candidate.ctx`），于是玩家实际看到两个工具，不是一个。实测证据：往这份名单里塞一个
 * 假名字，spawn 会吐回「known global tools」全表——表里有 `send_message`、有
 * `subagent_fork`（全局注册的），**没有** `subagent`。要连 own 层一起收，得用
 * `tools.guard()`（拒绝执行，与注册在哪一层无关），见
 * `docs/设计/2026-10-05-spawn_player-可行方案.md` §六。
 */
export const PLAYER_TOOLS = ['send_message'] as const

/** 一位已上桌的 AI 玩家。 */
export interface PlayerHandle {
  /** 座位 id，与 `GameState.seats` 用的是同一套命名。 */
  readonly seat: string
  /** 角色名，开场时报给桌上的那个。 */
  readonly name: string
  /** 这个玩家的子会话 id，DM 用它给玩家发话。 */
  readonly childId: PlayerChildId
}

/** 拼上台说明需要的输入。 */
export interface BriefInput {
  /** 座位 id。 */
  readonly seat: string
  /** 角色名。 */
  readonly name: string
  /** 角色本正文 —— DM 交给这个玩家的全部信息，也是他要守住的东西。 */
  readonly roleBook: string
  /** DM 的 agent id：玩家的每一句发言都要发到这个 id 上。 */
  readonly dmId: string
}

/**
 * 拼一位玩家的上台说明 —— 他这个子会话收到的第一段话。
 *
 * 只写游戏层的事：他是谁、话怎么传到桌上、他的角色本是什么。**不写**「你没有别的工具」
 * 这类权限说明——内核已经给每个子 agent 注入了委派范围声明（`SUBAGENT_DELEGATION_CONTEXT`），
 * 再说一遍只是噪声。
 * @param input - 座位、角色名、角色本与 DM 的 agent id。
 * @returns 作为子会话首条用户消息的文本。
 */
export function playerBrief(input: BriefInput): string {
  return `你是「${input.name}」，坐在 ${input.seat} 号位。这是一桌剧本杀，你是**玩家**，不是助手：`
    + '你要以这个角色的身份说话、被人盘问、也盘问别人，而不是帮谁完成任务。\n\n'
    + `你的每一句发言都要用 send_message 发给主持人，agent_id 是 "${input.dmId}"。`
    + '发言没发出去，就等于你什么都没说——桌上没有人替你转达。\n'
    + '消息正文就是你说出口的话，不要加「我说：」这类前缀，也不要在消息之外补充说明。\n\n'
    + `--- 你的角色本 ---\n${input.roleBook}\n--- 角色本结束 ---\n\n`
    + '角色本没写的事，你就是不知道。想知道，去问别人。'
}

/** 一局里的玩家登记表。 */
export interface PlayerRegistry {
  /**
   * 让一位玩家上桌。
   * @param handle - 该玩家的座位、角色名与子会话句柄。
   */
  seat(handle: PlayerHandle): void
  /**
   * 按座位取回玩家。
   * @param seat - 座位 id。
   * @returns 该座位上的玩家；座位空着时为 `undefined`。
   */
  get(seat: string): PlayerHandle | undefined
  /**
   * 请一位玩家下桌。
   * @param seat - 座位 id。
   * @returns 原来在位子上为 `true`，本来就空着为 `false`。
   */
  unseat(seat: string): boolean
  /**
   * 桌上的玩家。
   * @returns 按上桌顺序排列的句柄数组（副本，改动它不影响登记表）。
   */
  list(): readonly PlayerHandle[]
}

/**
 * 建一张空的玩家登记表。
 *
 * 同座位重复上桌**抛错而不是替换**：第二次 spawn 会创建一个新的子会话，而第一个还挂在
 * 那个座位上、还在等消息——静默替换会把一个活着的 player 变成没人收的孤儿。
 * @returns 新的登记表。
 */
export function createRegistry(): PlayerRegistry {
  const bySeat = new Map<string, PlayerHandle>()
  return {
    seat(handle) {
      const sitting = bySeat.get(handle.seat)
      if (sitting !== undefined) {
        throw new Error(`座位 "${handle.seat}" 上已经有人了（${sitting.name}）；先 unseat 再 spawn。`)
      }
      bySeat.set(handle.seat, handle)
    },
    get(seat) {
      return bySeat.get(seat)
    },
    unseat(seat) {
      return bySeat.delete(seat)
    },
    list() {
      return [...bySeat.values()]
    },
  }
}
