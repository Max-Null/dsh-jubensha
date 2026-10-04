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

/** 玩家唯一的对外通道：对主持人说话。 */
export const SPEAK_TOOL = 'send_message'

/**
 * 玩家能做的全部事情。
 *
 * 这份名单是**两层收窄**共同的输入（`index.ts` 的 `confine`）：
 *
 * - `tools.restrict({ allow: PLAYER_TOOLS })` 管**看不看得见**。不在名单里的工具对玩家根本不
 *   存在，模型不会去试，省掉一轮浪费。
 * - `tools/pre-execute` 上的兜底闸管**准不准执行**。`restrict` 按定义只过滤 scope **继承**到的
 *   东西（`view()` 的 JSDoc：`never what its OWN layer registers`），而内核的委派工具
 *   `subagent` 正是每个 agent 创建时注册进**它自己那层**的（`tool-subagent/src/index.ts:665-683`
 *   用 `candidate.ctx`）——那一层只有这道闸拦得住。
 *
 * **用白名单而不是黑名单**：新内核会加新工具，逐个 `deny` 的清单会随时间过期，而白名单只保留
 * 点名的那些，天然免疫这件事。代价是名字必须真实存在——`restrict()` 对未知名字直接抛错，而那
 * 个失败模式正好是我们想知道的：名单里少了 `send_message`，就等于玩家没法开口。
 *
 * 两层机制的实测、源码位置与那次「假名字换出可过滤工具全表」的实验见
 * `docs/设计/2026-10-05-spawn_player-可行方案.md`。
 */
export const PLAYER_TOOLS = [SPEAK_TOOL] as const

/** 一位已上桌的 AI 玩家。 */
export interface PlayerHandle {
  /** 座位 id，与 `GameState.seats` 用的是同一套命名。 */
  readonly seat: string
  /** 角色名，开场时报给桌上的那个。 */
  readonly name: string
  /** 这个玩家的子会话 id，DM 用它给玩家发话。 */
  readonly childId: PlayerChildId
  /** 主持人的 session id：收窄时要拿它当「这位玩家能对谁说话」的目标之一。 */
  readonly dmId: string
}

/** 拼上台说明需要的输入。 */
export interface BriefInput {
  /** 座位 id。 */
  readonly seat: string
  /** 角色名。 */
  readonly name: string
  /** 角色本正文 —— DM 交给这个玩家的全部信息，也是他要守住的东西。 */
  readonly roleBook: string
  /** 谁来演这一局。不填就是一个新面孔，上台说明里也不提这件事。 */
  readonly actor?: ActorBrief
}

/**
 * 上台说明里要交代的演员。
 *
 * **它与角色本是两层，别混**：角色本说「你这次演谁」，这里说「你是谁、你怎么玩」。
 * 同一个人换一本子还是同一个人——这正是设计方案 §2.2 那第二层人设。
 */
export interface ActorBrief {
  /** 演员的名字（人看的，不是角色名）。 */
  readonly name: string
  /** 这个人怎么玩游戏。 */
  readonly style: string
  /** 跨局攒下来的印象，新的在前。 */
  readonly notes: readonly string[]
}

/**
 * 演员那一段。**不写座位**——同一批演员换位子是常事，写了反而让他以为换了人。
 * @param actor - 谁来演这一局。
 * @returns 插在角色本之前的那一段。
 */
function actorSection(actor: ActorBrief): string {
  const parts = [
    `--- 谁在玩这个角色 ---\n这一局由「${actor.name}」来演。你怎么玩这个游戏，跟你这次拿到什么角色无关：`,
    actor.style,
  ]
  if (actor.notes.length > 0) {
    parts.push('你还记得这些（都是**前面几局**的事，跟这一局的人无关）：')
    parts.push(actor.notes.map(note => `- ${note}`).join('\n'))
  }
  return parts.join('\n')
}

/**
 * 拼一位玩家的上台说明 —— 他这个子会话收到的第一段话。
 *
 * **只说 `lead`，不说 session id。** Team 的 `send_message` 按成员**名字**解析目标
 * （`agent-team/src/mailbox.ts:120` 的 `resolveActiveMember(root, state, request.target)`），
 * 找不到就抛 `active teammate "…" not found`（`roster.ts:52`）。而主持人的 session id
 * **不是**一个成员名——2026-10-05 实测：告诉玩家 session id，它十次全失败，一个字都没说出口；
 * 那一局从外面看只是"这位玩家很安静"。所以这里只给一个走得通的名字，闸也只放这一个。
 *
 * 只写游戏层的事：他是谁、话怎么传到桌上、他的角色本是什么。**不写**「你没有别的工具」
 * 这类权限说明——内核已经给每个子 agent 注入了委派范围声明（`SUBAGENT_DELEGATION_CONTEXT`），
 * 再说一遍只是噪声。
 * @param input - 座位、角色名、角色本，以及谁来演这一局。
 * @returns 作为子会话首条用户消息的文本。
 */
export function playerBrief(input: BriefInput): string {
  const parts = [
    `你是「${input.name}」，坐在 ${input.seat} 号位。这是一桌剧本杀，你是**玩家**，不是助手：`
      + '你要以这个角色的身份说话、被人盘问、也盘问别人，而不是帮谁完成任务。',
  ]
  if (input.actor !== undefined) parts.push(actorSection(input.actor))
  parts.push(
    '你的每一句发言都用 send_message 发给 "lead"——那就是主持人，target 就填这一串。'
      + '发言没发出去，就等于你什么都没说——桌上没有人替你转达。\n'
      + '消息正文就是你说出口的话，不要加「我说：」这类前缀，也不要在消息之外补充说明。',
  )
  parts.push(`--- 你的角色本 ---\n${input.roleBook}\n--- 角色本结束 ---`)
  parts.push('角色本没写的事，你就是不知道。想知道，去问别人。')
  return parts.join('\n\n')
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
   * 按子会话 id 找玩家。
   *
   * **这条是给 `agent/created` 用的**：续命子会话每次 activation 都会是一个**新的 Agent
   * 对象**，而收窄挂在 agent 的 ctx 上——所以每次都得认出来再收一遍，靠座位表认不出来。
   * @param childId - 那个玩家的子会话 id。
   * @returns 对应的句柄；不在座上时为 `undefined`。
   */
  find(childId: string): PlayerHandle | undefined
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
  /**
   * 记下这个座位刚刚说出口的一句话。
   *
   * 玩家的发言只到主持人那里（他的唯一通道就是发给 `lead`），他要被桌上其他人听见，
   * 得由主持人转达——而**主持人手里的原话是抄来的**。记在这里的那一句才是原件：
   * `jubensha_player action="relay"` 直接从这儿取，不用主持人复述。
   * @param seat - 座位 id。
   * @param text - 他刚说出口的那句话。
   */
  recordSaid(seat: string, text: string): void
  /**
   * 这个座位最后说出口的那句话。
   * @param seat - 座位 id。
   * @returns 那句话；他还没开过口时为 `undefined`。
   */
  lastSaid(seat: string): string | undefined
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
  const said = new Map<string, string>()
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
    find(childId) {
      for (const handle of bySeat.values()) {
        if (handle.childId === childId) return handle
      }
      return undefined
    },
    unseat(seat) {
      // 连他最后那句话一起忘掉：下桌之后那句话不该还能被转达给一桌新人。
      said.delete(seat)
      return bySeat.delete(seat)
    },
    list() {
      return [...bySeat.values()]
    },
    recordSaid(seat, text) {
      said.set(seat, text)
    },
    lastSaid(seat) {
      return said.get(seat)
    },
  }
}
