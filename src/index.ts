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
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
// 这几个 type-only import 拉入 Context 上的服务声明（agents / agentTeams / subagents）。
// 本模块**不**把它们写进 inject：缺哪一样都该只让对应的动作报错，而不是整个插件不加载——
// 取服务一律走运行时的 ctx.get。
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { SpawnTeammateResult } from '@deepseek-ai/dsh-experimental-agent-team'
import type {} from '@deepseek-ai/dsh-subagent'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { openActorPool } from './actor.ts'
import type { Actor, ActorPool } from './actor.ts'
import { bookPreview, bookRef, bookRefSeat, loadCase, openBeforeReveal, pickBookRef, roleBook, tableClues } from './case.ts'
import { createRegistry, playerBrief, PLAYER_TOOLS, SPEAK_TOOL } from './player.ts'
import type { PlayerHandle } from './player.ts'
import { mountRoomApi } from './room.ts'
import type { RoomSnapshot } from './room.ts'
import { advance, createGame, isFinished, isSealed, revealClues } from './state.ts'
import type { GameState } from './state.ts'

/** 插件名。 */
export const name = 'dsh-jubensha'

/**
 * 需要的服务。
 *
 * **`storage` 必须声明，不是"用 `ctx.get` 兜着就行"**：演员池用的 `DomainFacility` 与
 * `JsonStorageBackend` 内部按**属性**访问 `ctx.storage`，而属性代理只认声明过的注入。
 * 2026-10-05 实测的失败样子：五个演员动作全返回 `cannot get property "storage" without
 * inject`，连带着 `jubensha_player` 的 `spawn`（传了 `actor` 时）也一起挂——而**不传 actor
 * 的 spawn 一直正常**，所以这个错看起来像是"演员功能坏了"，实际是插件没有声明它依赖的服务。
 *
 * `webServer` / `webRuntime` 是房间端点用的：面板在浏览器里，与宿主不共享服务，
 * 只能走插件自己的 HTTP 端点（见 `room.ts`）。
 */
export const inject = ['tools', 'storage', 'webServer', 'webRuntime']

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

/** 本子工具名。 */
const CASE_TOOL = 'jubensha_case'

/** 演员工具名。 */
const ACTOR_TOOL = 'jubensha_actor'

/**
 * 上台说明里带几条跨局印象。
 *
 * 上限是判据不是省事：印象存在池子里会一直长，而 brief 每局都要重发一遍。三条够它认出
 * "上次栽在谁手里"，多出来的只会把角色本挤到后面去。
 */
const NOTES_IN_BRIEF = 3

/**
 * 演员池：跨局的那份名册。
 *
 * **开一次就够**：`storage.backend.register` 对重名抛 `duplicate-backend`，域也只开一次。
 * 存成一个 Promise 而不是已开好的对象，是因为工具的执行是异步的——第一个调用进来时它可能
 * 还在开，后来的调用应该等同一个 Promise，而不是各自去开第二份。
 */
let actors: Promise<ActorPool> | undefined

/**
 * 取演员池。
 *
 * 打开是**懒的**：没用到跨局记忆的局（比如试一本新本子）不该因为 storage 缺失而整个插件
 * 报错。缺 storage 时错误在这里抛，只影响真正要用它的那几个动作。
 * @param ctx - 插件上下文。
 * @returns 打开好的演员池。
 */
function requireActors(ctx: Context): Promise<ActorPool> {
  actors ??= openActorPool(ctx)
  return actors
}

/**
 * 把池子里的一条记录整理成工具返回值。
 *
 * 复制的理由与 `snapshot()` 一样：记录里的字段是 readonly，而工具的输出契约按可变数组声明
 * （schema 表达不了 readonly），直接交出去类型不符。
 * @param actor - 演员池里的一条记录。
 * @returns 可交给工具输出契约的形状。
 */
function toActorOut(actor: Actor) {
  return {
    id: actor.id,
    name: actor.name,
    style: actor.style,
    notes: [...actor.notes],
    // 缺省（没换过图）时**不带这个字段**，而不是给空串：界面据此决定"按 id 生成一个"，
    // 空串会让它去加载一张不存在的图。
    ...(actor.avatar === undefined ? {} : { avatar: actor.avatar }),
  }
}

/**
 * 写一条性格时该照着什么写。
 *
 * 这两条来自设计方案 §2.2，是**验收判据**不是修辞建议：写成形容词列表的性格影响不到任何
 * 决策（在票型上留不下痕迹），所以那样写等于没写。
 */
const STYLE_GUIDE = [
  '① 写成**决策偏好**，不要写成形容词列表。',
  '   「性格火爆、心直口快」一出手就被识破是表面功夫，也影响不到任何决策；',
  '   写成「抓到一点就往前压，宁可压错」，它才会在票型上留下痕迹。',
  '',
  '② 写到**「他想选什么，但实际做成了什么」**——欲望与能力的缺口。',
  '   原型是那个平时嘴上没把门、愿望偏偏是守口如瓶一次的人：他要的不是守住秘密，',
  '   是体验自己能守。而他漏出去的不是内容，是行为。',
].join('\n')

/** 本子文件名 —— 工具按 `<dir>/case.yml` 找，这份约定写在 `schema/case.schema.yml` 头部。 */
const CASE_FILE = 'case.yml'

/**
 * 这一局的玩家登记。
 *
 * 与 `current` 一样挂在模块上（单进程单局）。但它比局面状态短命得多：局面可以拿去复盘，
 * 登记表不能——里面的子会话 id 在进程结束后没有任何意义。
 */
const players = createRegistry()

/**
 * 封存的角色本：ref → 全文。
 *
 * **为什么要有它**：角色本是这一局最不该被看见的东西——每位玩家要瞒的事全在里面。而它
 * 进玩家手里之前必须经过 DM 的手，于是全文就落在 DM 的上下文里；玩家的界面能看到思考块
 * 与工具操作条（`docs/设计/2026-10-04-单机剧本杀-设计方案.md` §3.2 风险一），**展开就看见**。
 *
 * 所以改成过手不过目：`jubensha_case action="book"` 在复盘之前只返回一个 ref，
 * 全文留在这里；`jubensha_player` 收 ref 自己解开。DM 从头到尾没读到过。
 * 副作用是好的——它顺带堵死了"DM 自己转述角色本时抄漏一句"（那条路以前只靠描述里的警告）。
 */
const sealedBooks = new Map<string, string>()

/**
 * 把 `roleBook` 入参解成正文——它可能是一个封存引用，也可能是全文。
 *
 * 两种都收，因为两条路都有正当用法：上桌走引用（正文不过 DM 的手），复盘或临时补位时
 * 直接给全文更省事。认出引用就按引用走，认不出就当作全文。
 *
 * **引用要对着座位核一遍**：引用是当场按座位生成的，而 `spawn` 也自带一个座位号。
 * 两者不一致就是"把别人的本子发给了这个人"——角色本串位是信息隔离破得最彻底的一种，
 * 所以这一条按 `spawn` 的参数能查出来的事实来查，不靠 DM 记得住。
 * @param raw - 调用方给的 `roleBook`。
 * @param seat - 这次 `spawn` 的座位 id；只有引用用得上它。
 * @returns 要发给玩家的角色本正文。
 */
function resolveBook(raw: string, seat: string): string {
  const ref = pickBookRef(raw, sealedBooks)
  if (ref === undefined) return raw
  const bound = bookRefSeat(ref)
  if (bound !== undefined && bound !== seat) {
    throw new Error(`这份角色本是座位 "${bound}" 的，不能发给 "${seat}"——`
      + `每个座位只能拿到自己那一份。重新取一份 ${seat} 的。`)
  }
  // 走到这里 ref 一定来自登记表，取不到只可能是并发下被清掉——按最坏情况处理，别把空交出去。
  return sealedBooks.get(ref) ?? raw
}

/**
 * 现在还在不在封存期——判据本身在 `state.ts` 的 `isSealed`，这里只是把它接到这一局上。
 * @returns 复盘阶段之前一律 `true`。
 */
function sealed(): boolean {
  return isSealed(current)
}

/** 复盘之前拒答时给的出路；把「现在该用什么」直接写进去，而不是只说不行。 */
function sealNote(section: string): string {
  if (section === 'truth') {
    return '这一局还封着——真相里写着谁是真凶。带局要用的东西不在真相里：'
      + '流程看 briefing，线索进牌桌走 action="clue"，玩家推得对不对看线索的 supports。'
  }
  if (section === 'clues') {
    return '整段 clues 里带着 supports（"这条能推出什么"），所以整段封着——它只给 DM 判断用。'
      + '要把线索送到桌上，用 action="clue"，它只给原文。'
  }
  return '这一段的答案要等复盘（phase 走到 reveal）。'
}

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

/** 已经收窄过的玩家。`agent/created` 与 spawn 返回后各会调一次，靠它去重。 */
const confined = new WeakSet<Agent>()

/**
 * 正在等座位主人的 DM —— DM 的 session id → 那位待上桌玩家的座位与角色名。
 *
 * **为什么需要它**：收窄必须赶在玩家的第一个请求之前，而 `spawnTeammate` 返回时玩家可能
 * 已经跑起来了（2026-10-05 实测：头两个请求带着全套工具，第三个才是收窄后的）。`agent/created`
 * 比它早，但那一刻只拿得到一个 Agent、认不出它是不是玩家——这张登记表就是那个判据：
 * 以某位 DM 为父、而且这位 DM 正在等人，来者即玩家。
 */
const awaiting = new Map<string, { readonly seat: string; readonly name: string }>()

/** Team 里主持人固定的名字——`spawn_teammate` 给每个成员的初始说明里就写着它。 */
const LEAD_NAME = 'lead'

/**
 * 座位号后面缀什么才不撞名。
 *
 * Team 名册**跨进程持久**：一个名字在这个 DM 的会话里用过一次，就永远不能再用
 * （`roster.ts:271-273` 对重名抛 `TEAM_MEMBER_NAME_TAKEN`）。2026-10-05 踩了两轮才看清：
 * 先是同进程内第二次上桌就撞，改成单调计数；重启后又撞——**计数器是进程级的，名册不是**。
 * 所以后缀必须自带唯一性，不能依赖任何进程内状态。人看的是 `description`（label），
 * 这个 name 只有机器用，丑一点没关系。
 * @param seat - 座位 id。
 * @returns 一个不与既往用过的名字相撞的 teammate 名。
 */
function teammateName(seat: string): string {
  return `${seat}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`
}

/** 从一次调用的原始入参里取 `target`；取不到就由调用方当作「没有有效对象」。 */
function readTarget(raw: unknown): string | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined
  const target = (raw as Record<string, unknown>)['target']
  return typeof target === 'string' ? target : undefined
}

/** 从一次 `send_message` 的原始入参里取正文；空串按「没说」处理。 */
function readMessage(raw: unknown): string | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined
  const message = (raw as Record<string, unknown>)['message']
  return typeof message === 'string' && message.trim() !== '' ? message : undefined
}

/** 按座位取回玩家，取不到就直接抛——每个要用座位的动作都该在这里失败。 */
function requirePlayer(seat: string): PlayerHandle {
  const player = players.get(seat)
  if (player === undefined) throw new Error(`座位 "${seat}" 上没人（${tableText()}）。`)
  return player
}

/**
 * 把一句话送到几位玩家手里。
 *
 * **一个一个发，不等并发**：`sendMessage` 对忙着的目标按步边界投递，并发发多条并不会更快，
 * 只会让"发到一半失败"时说不清谁收到了。发不出去就直接抛——**静默漏掉一个人是这一块最坏的
 * 失败**，因为漏掉的那位不会知道自己漏了什么，而桌上其他人以为他听见了。
 * @param ctx - 插件上下文，用来取委派服务。
 * @param dm - 主持人 agent；消息由他发出。
 * @param listeners - 要送到的人。
 * @param text - 送出去的正文。
 * @param signal - 这次工具调用的取消信号。
 */
async function deliver(
  ctx: Context,
  dm: Agent,
  listeners: readonly PlayerHandle[],
  text: string,
  signal: AbortSignal,
): Promise<void> {
  const subagents = requireSubagents(ctx)
  for (const listener of listeners) {
    await subagents.sendMessage(dm, listener.childId, [{ type: 'text', text }], { signal })
  }
}

/**
 * 把一位玩家收窄到「只能说话」—— 两层，各管一段。
 *
 * **第一层 `restrict`** 管的是可见性：不在白名单里的工具对玩家**根本不存在**，模型不会去试。
 * 但它按定义只过滤 scope **继承**到的东西（`view()` 的 JSDoc：`never what its OWN layer
 * registers`），而内核的委派工具 `subagent` 正是每个 agent 创建时注册进**它自己那层**的
 * （`subagent/tool-subagent/src/index.ts:665-683` 用 `candidate.ctx`）——那一层它管不着。
 *
 * **第二层 `tools/pre-execute`** 管的是准不准执行：它在工具解析之后、执行之前跑，carrier 是
 * `scopeTarget(this, exec.agent)`（`core/tools/src/index.ts:1504-1505`），按**执行者本人**的
 * scope 路由，所以它不问那个工具注册在哪一层。第一层漏掉的都归它兜——2026-10-05 实测拦住了
 * own 层的 `list_agents`。
 *
 * 第二层还多管一件事：**说话只说给主持人**。Team 版的 `send_message` 收 teammate 名字，
 * 玩家理论上能点名任何一位同伴——那会变成串供。所以这里把对象也收成一个小集合。
 *
 * **集合里只有 `lead`，没有主持人的 session id。** 那个 id 不是成员名，Team 按名字解析
 * （`agent-team/src/mailbox.ts:120`），给了它也发不出去——2026-10-05 实测里那位玩家
 * 因此一个字都没说出口。**放行一个走不通的名字，比拒绝它更坏**：拒绝至少会当场报错。
 * @param agent - 那位玩家的 agent。
 * @param seat - 座位 id，只出现在拒绝理由里，让模型知道是谁被挡了。
 */
function confine(agent: Agent, seat: string): void {
  if (confined.has(agent)) return
  confined.add(agent)
  const allowed = new Set<string>(PLAYER_TOOLS)
  const audience = new Set<string>([LEAD_NAME])
  agent.ctx.tools.restrict({ allow: [...PLAYER_TOOLS] })
  agent.ctx.on('tools/pre-execute', (exec, next) => {
    if (!allowed.has(exec.name)) {
      return Promise.resolve({
        kind: 'deny',
        reason: `座位 ${seat} 上只做一件事：说话。${exec.name} 用不了。`,
      })
    }
    if (exec.name === SPEAK_TOOL) {
      const target = readTarget(exec.arguments)
      if (target === undefined || !audience.has(target)) {
        return Promise.resolve({
          kind: 'deny',
          reason: `座位 ${seat} 只能对主持人说话${target === undefined ? '' : `，"${target}" 不是主持人`}。`,
        })
      }
    }
    return next()
  })
  // 记下他刚说出口的那句话：桌上其他人要听见，得靠主持人转达，而主持人不该去抄内容——
  // `action="relay"` 从这里取原件。`tools/result` 是纯观察钩子（`@mode emit`），
  // 监听器抛错会被内核隔离，不会连累那次发言本身。
  agent.ctx.on('tools/result', (exec, result) => {
    if (exec.name !== SPEAK_TOOL || result.isError) return
    const said = readMessage(exec.arguments)
    if (said !== undefined) players.recordSaid(seat, said)
  })
}

/**
 * 从名册行取回 agent 再收窄。拿不到就抛——静默放过等于让一位不受限的玩家坐上了桌。
 * @param ctx - 插件上下文，用来取 agent 注册表。
 * @param member - `spawnTeammate` 返回的名册行。
 * @param seat - 座位 id。
 */
function confineMember(
  ctx: Context,
  member: SpawnTeammateResult['member'],
  seat: string,
): void {
  const agents = ctx.get('agents')
  if (agents === undefined) throw new Error(`这个部署里没有 agent 注册表，${PLAYER_TOOL} 收不了口。`)
  const agent = agents.get(member.id)
  if (agent === undefined) {
    throw new Error(`玩家 agent（${member.name}）不在注册表里，收窄没做成——先别让它上桌。`)
  }
  confine(agent, seat)
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
    + 'restricted to one tool — send_message, addressed to "lead" — so it can speak to you and read '
    + 'nothing else: not the case files, not another player\'s 角色本. Its 角色本 arrives as its first '
    + 'message, and every line it says reaches you as a send_message from it. action="say" only delivers '
    + 'your line; the player answers on its own turn, so never wait for a reply inside this call. '
    + 'Use action="say" with seat="*" to speak to the whole table in one call. A player hears only what '
    + 'you send it, so when one player says something the others should have heard, pass it on with '
    + 'action="relay" — that replays his own words from the record, so his line reaches the table as he '
    + 'said it rather than as you retold it. '
    + '剧本杀玩家工具：让 AI 玩家上桌 / 对某位玩家说话 / 把某位玩家的话转达给其他人 / 请他下桌 / 看桌上都有谁。'
    + 'spawn 之后玩家只拿到自己的角色本，且只能说话——他读不到本子文件，也读不到别人的角色本。'
    + 'say 带 seat="*" 是一次说给全桌听；玩家只听得见你发给他的东西，所以某人说了该让全桌听见的话时，'
    + '用 relay 转达——它把那位玩家的原话放回桌上，不经过你的复述。'
    + 'say 只负责把话送到；玩家的回答在他自己的回合里发回来，不在这次调用里等。'
}

/** 组装演员工具的描述：同样把「什么时候该调它」写在最前面。 */
function describeActorTool(): string {
  return 'Keep the cast of 剧本杀 players — the people who sit down, as opposed to the roles they play this '
    + 'time. A character comes from the case; who the player is comes from here, and it survives the session: '
    + 'the same actor can take a different seat with a different 角色本 next game and still remember what '
    + 'happened before. Use action="add" to bring someone in, action="note" after a game to record what he '
    + 'carries into the next one, and hand the actor id to jubensha_player when seating him. '
    + '剧本杀演员工具：管「这桌由谁来玩」——它跟这一局演什么角色是两回事。'
    + '角色来自本子，人来自这里，而且**跨局活着**：同一个演员下一局可以换座位、换角色本，'
    + '但他记得前面几局发生过什么。'
    + 'add 是招人，note 是一局结束后记下他该带走的东西，上桌时把 actor id 交给 jubensha_player。'
}

/** 组装本子工具的描述：同样把「什么时候该调它」写在最前面。 */function describeCaseTool(): string {
  return 'Read a 剧本杀 case file kept as data: which seats it has, one role\'s own brief, the clues as the '
    + 'table sees them, or one whole section (the scene, the briefing script, the review questions). Call '
    + 'action="load" first — it also reports the format problems it finds, and that check is the reason cases '
    + 'are data instead of prose. Use action="book" to get one role\'s brief: before the review it returns a '
    + 'sealed ref instead of the text, so hand that ref to jubensha_player as its roleBook verbatim — the '
    + 'brief never passes through your context, and a player can never be handed another seat\'s brief by '
    + 'mistake. Use action="clue" to put clues on the table: it returns only what the players get to read, '
    + 'never the "what it means" part. Sections holding the answer stay sealed until the review. '
    + '剧本杀本子工具：看这本有哪几个座位 / 取某个角色的角色本 / 取线索的牌桌原文 / 取本子的某一段'
    + '（场景、带局脚本、复盘脚本…）。先调 load，它会顺带报出格式问题——把本子做成数据就是为了这一步。'
    + '上桌时用 book 取角色本、把返回值（复盘前是一个封存 ref）**原样**填进 jubensha_player 的 roleBook，'
    + '不要自己转述，更不要把别的座位的发给他。线索送到桌上用 clue，它只给玩家要读的原文。'
    + '带答案的段（真相、整段线索）封到复盘，取不到是设计如此，报错里会说你该用什么。'
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
  console.info(`[${name}] loaded · registers ${STATE_TOOL}, ${PLAYER_TOOL}, ${CASE_TOOL}, ${ACTOR_TOOL}`)
  // 房间面板读的那一份快照。**只读**——开一局、推进阶段、发线索都在对话里说，
  // 面板不发号施令（设计方案里「界面是附加层」那条约束）。
  mountRoomApi(ctx, async (): Promise<RoomSnapshot> => {
    const actors = await requireActors(ctx).then(pool => pool.list())
    return {
      game: current === undefined ? null : {
        caseId: current.caseId,
        title: current.title,
        seats: [...current.seats],
        humanSeat: current.humanSeat,
        phase: current.phase,
        round: current.round,
        revealedClues: [...current.revealedClues],
        finished: isFinished(current),
      },
      players: players.list().map(player => ({ seat: player.seat, name: player.name })),
      actors: actors.map(actor => ({
        id: actor.id,
        name: actor.name,
        style: actor.style,
        notes: [...actor.notes],
        ...(actor.avatar === undefined ? {} : { avatar: actor.avatar }),
      })),
    }
  })
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
  // agent/created 比 spawnTeammate 返回得早，是能在玩家开口之前动手的时机。
  ctx.on('agent/created', ({ agent }) => {
    // 已在座上的玩家：续命子会话每次 activation 都是一个**新的 Agent 对象**，而收窄挂在
    // agent 的 ctx 上——所以每次都得认出来重挂一遍，否则第二个 turn 就漏了。
    const sitting = players.find(agent.session.header.id)
    if (sitting !== undefined) {
      confine(agent, sitting.seat)
      return undefined
    }
    // 正在上桌的那一位：agent/created 比 spawnTeammate 返回得早，这是唯一赶得上的时机。
    const parent = agent.session.header.parentSession
    if (parent === undefined) return undefined
    const pending = awaiting.get(parent)
    if (pending === undefined) return undefined
    awaiting.delete(parent)
    confine(agent, pending.seat)
    return undefined
  })
  ctx.tools.register(defineTool({
    name: CASE_TOOL,
    description: describeCaseTool(),
    parameters: {
      action: {
        type: 'string',
        enum: ['load', 'section', 'book', 'clue'],
        description: 'load = 加载并校验（默认）；section = 取某一段原文；book = 取某个角色的角色本；clue = 取线索的牌桌原文。',
      },
      dir: { type: 'string', description: '本子目录（读其中的 case.yml），或者直接给那份文件的路径。' },
      section: {
        type: 'string',
        description: 'section 用：段名，如 scene / truth / clues / emotional / briefing / style / audit / reveal。复盘之前带答案的段取不到，报错里会说该用什么代替。',
      },
      role: { type: 'string', description: 'book 用：座位 id，如 "p1"。' },
      clues: {
        type: 'array',
        items: { type: 'string' },
        description: 'clue 用：要取哪几条线索（id）；不填表示全部。',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          caseId: { type: 'string' },
          title: { type: 'string' },
          genre: { type: 'string' },
          seats: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                id: { type: 'string' },
                name: { type: 'string' },
                player: { type: 'string' },
              },
            },
          },
          sections: { type: 'array', items: { type: 'string' } },
          text: { type: 'string' },
          ref: { type: 'string' },
          sealed: { type: 'boolean' },
          missing: { type: 'array', items: { type: 'string' } },
          issues: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                level: { type: 'string' },
                message: { type: 'string' },
              },
            },
          },
        },
      },
      render: (args, value) => {
        // load 的结果是给 DM 看的一张表；section / clue / book 取的是原文，原样交出去——
        // 角色本尤其不能在这里被重新排版，它要一字不差地到玩家手上。
        if (value.sealed === true) {
          return [{
            type: 'text',
            text: `${value.text ?? ''}\n\n角色本全文已封存，不经过你的上下文。`
              + `上桌时 ${PLAYER_TOOL} 的 roleBook 只填下面这一串——只填这一串：\n`
              + `${value.ref ?? ''}`,
          }]
        }
        if ((args.action ?? 'load') !== 'load') {
          const missing = value.missing ?? []
          const note = missing.length > 0 ? `\n\n（这本里没有这些线索：${missing.join('、')}）` : ''
          return [{ type: 'text', text: `${value.text ?? ''}${note}` }]
        }
        const lines = [`《${value.title ?? ''}》（case ${value.caseId ?? ''}｜${value.genre ?? ''}）`]
        for (const seat of value.seats ?? []) lines.push(`  ${seat.id}  ${seat.name}（${seat.player}）`)
        lines.push(`  可取的段：${(value.sections ?? []).join('、')}`)
        for (const issue of value.issues ?? []) lines.push(`  [${issue.level}] ${issue.message}`)
        if ((value.issues ?? []).length === 0) lines.push('  校验：没有问题')
        return [{ type: 'text', text: lines.join('\n') }]
      },
    },
    execute(args) {
      const { dir } = args
      if (dir === undefined) throw new Error('要给 dir——本子目录，或那份 case.yml 的路径。')
      const file = /\.ya?ml$/.test(dir) ? dir : join(dir, CASE_FILE)
      let source: string
      try {
        source = readFileSync(file, 'utf8')
      } catch (error: unknown) {
        throw new Error(`读不到本子：${file}（${error instanceof Error ? error.message : String(error)}）`)
      }
      const loaded = loadCase(source)
      const issues = loaded.issues.map(issue => ({ level: issue.level, message: issue.message }))
      const action = args.action ?? 'load'

      if (action === 'load') {
        return Promise.resolve({
          caseId: loaded.id,
          title: loaded.title,
          genre: loaded.genre,
          seats: loaded.roles.map(role => ({ id: role.id, name: role.name, player: role.player })),
          sections: Object.keys(loaded.sections),
          issues,
        })
      }
      if (action === 'section') {
        const name = args.section
        if (name === undefined) throw new Error('section 要给段名。')
        const value = loaded.sections[name]
        if (value === undefined) {
          throw new Error(`这本里没有 "${name}" 这一段。有这些：${Object.keys(loaded.sections).join('、')}`)
        }
        // 白名单之外的一律封到复盘。这一段是"真相保险箱"的全部实现——它不靠 DM 自觉
        // 不去看，而是**看不到**：没读过的东西，连展开操作条也翻不出来。
        if (sealed() && !openBeforeReveal(name)) {
          throw new Error(`"${name}" 取不到。${sealNote(name)}`)
        }
        const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2)
        return Promise.resolve({ caseId: loaded.id, text, issues })
      }
      if (action === 'clue') {
        // 空 clues 有两种：段落不在（情感本，本就不该有搜证），和段落空（本子没写完）。
        // 两者都不该让 DM 拿到一个空字符串去猜——那看起来像工具坏了。
        const raw = loaded.sections['clues']
        if (!Array.isArray(raw) || raw.length === 0) {
          throw new Error(`这本（${loaded.genre}）没有搜证段——它不是靠线索推进的。`
            + `带局要看的是 briefing 段。`)
        }
        const { clues, missing } = tableClues(loaded, args.clues ?? [])
        // 拼成能直接贴到桌上的样子：DM 拿到手不用再排版，也就不会顺手把 supports 也带上。
        const text = clues
          .map(clue => `【线索 ${clue.id}${clue.title === '' ? '' : ` · ${clue.title}`}】\n${clue.text}`)
          .join('\n\n')
        return Promise.resolve({ caseId: loaded.id, text, missing, issues })
      }
      const seat = args.role
      if (seat === undefined) throw new Error('book 要给座位 id。')
      const role = loaded.roles.find(candidate => candidate.id === seat)
      if (role === undefined) {
        throw new Error(`这本里没有座位 "${seat}"。有这些：${loaded.roles.map(item => item.id).join('、')}`)
      }
      const full = roleBook(role)
      if (sealed()) {
        const ref = bookRef(loaded.id, seat)
        sealedBooks.set(ref, full)
        return Promise.resolve({ caseId: loaded.id, text: bookPreview(role), ref, sealed: true, issues })
      }
      return Promise.resolve({ caseId: loaded.id, text: full, issues })
    },
  }))
  ctx.tools.register(defineTool({
    name: ACTOR_TOOL,
    description: describeActorTool(),
    parameters: {
      action: {
        type: 'string',
        enum: ['list', 'add', 'draft', 'style', 'avatar', 'note', 'show'],
        description: 'list = 池子里都有谁（默认）；add = 招一个演员进来；draft = 取一份「怎么写性格」的骨架（给用户看，不落库）；style = 改他怎么玩；avatar = 给他换张头像图；note = 记一条跨局印象；show = 看某一个人的档案。',
      },
      actor: { type: 'string', description: 'note / show / draft / style / avatar 用：演员 id。add 用：新演员的 id（小写字母开头，只用小写字母、数字、下划线——它同时是存储里的记录键，也是头像生成用的种子）。' },
      name: { type: 'string', description: 'add 用：人看的名字，比如「老周」。' },
      style: { type: 'string', description: 'add / style 用：这个人怎么玩游戏——不是他这一次演的角色是什么样。先 action="draft" 看看该往哪儿写。' },
      image: { type: 'string', description: 'avatar 用：头像图片的路径；传空串表示换回按 id 生成的那个。' },
      note: { type: 'string', description: 'note 用：这一局结束后他该带走的事，一两句话。' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          actors: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                id: { type: 'string' },
                name: { type: 'string' },
                style: { type: 'string' },
                notes: { type: 'array', items: { type: 'string' } },
                avatar: { type: 'string' },
              },
            },
          },
          text: { type: 'string' },
        },
      },
      render: (args, value) => {
        if ((args.action ?? 'list') === 'draft') {
          return [{ type: 'text', text: value.text ?? '' }]
        }
        const list = value.actors ?? []
        if (list.length === 0) {
          return [{ type: 'text', text: '演员池是空的——用 action="add" 招一个进来。' }]
        }
        if ((args.action ?? 'list') === 'list') {
          return [{
            type: 'text',
            text: list.map(actor => `${actor.id}  ${actor.name ?? ''}｜印象 ${(actor.notes ?? []).length} 条`).join('\n'),
          }]
        }
        // 字段都当成可能缺的：输出契约由 JSON Schema 声明，那里的 properties 一律非必填，
        // 所以推断出来的类型是可选——不是存储可能给空，是契约没说它一定有。
        const actor = list[0]!
        const notes = actor.notes ?? []
        const lines = [`${actor.name ?? actor.id}（${actor.id}）`, actor.style ?? '']
        lines.push(actor.avatar === undefined || actor.avatar === ''
          ? '头像：按 id 生成的那个'
          : `头像：${actor.avatar}`)
        lines.push(notes.length === 0
          ? '印象：还没有——一局结束后用 action="note" 记一条。'
          : `印象：\n${notes.map(one => `  · ${one}`).join('\n')}`)
        return [{ type: 'text', text: lines.join('\n') }]
      },
    },
    async execute(args) {
      const pool = await requireActors(ctx)
      switch (args.action ?? 'list') {
        case 'add': {
          const { actor, name, style } = args
          if (actor === undefined || name === undefined || style === undefined) {
            throw new Error('add 需要 actor（id）/ name / style 三项都给。')
          }
          return { actors: [toActorOut(await pool.add({ id: actor, name, style }))] }
        }
        case 'draft': {
          // 只**给怎么写**，不替用户写，也不落库：写出来的那条是要跨局的（这个演员以后每局
          // 都这么玩），所以它必须经过人的眼睛。插件自己也没有调模型的通道——写属于主持人。
          const { actor } = args
          const existing = actor === undefined ? undefined : await pool.get(actor)
          if (actor !== undefined && existing === undefined) {
            throw new Error(`演员池里没有 "${actor}"——先 action="list" 看看都有谁。`)
          }
          const known = existing === undefined || existing.notes.length === 0
            ? '（这个演员还没有印象——这是他的第一条性格，随你写。）'
            : `已有的印象（新写的性格要与它相容，别打架）：\n${existing.notes.map(one => `  · ${one}`).join('\n')}`
          return {
            text: `${STYLE_GUIDE}\n\n${known}\n\n`
              + '写完先给用户过目，再调 action="add"（新演员）或 action="style"（改现有的）。\n'
              + '**不要自己直接落库**——它落进去就是跨局的，这个演员以后每一局都这么玩。',
          }
        }
        case 'style': {
          const { actor, style } = args
          if (actor === undefined || style === undefined) throw new Error('style 需要 actor 与 style 两项都给。')
          return { actors: [toActorOut(await pool.setStyle(actor, style))] }
        }
        case 'avatar': {
          const { actor, image } = args
          if (actor === undefined || image === undefined) {
            throw new Error('avatar 需要 actor 与 image 两项都给——image 传空串表示换回生成的那个。')
          }
          return { actors: [toActorOut(await pool.setAvatar(actor, image))] }
        }
        case 'note': {
          const { actor, note } = args
          if (actor === undefined || note === undefined) throw new Error('note 需要 actor 与 note 两项都给。')
          return { actors: [toActorOut(await pool.note(actor, note))] }
        }
        case 'show': {
          const { actor } = args
          if (actor === undefined) throw new Error('show 需要 actor。')
          const found = await pool.get(actor)
          if (found === undefined) throw new Error(`演员池里没有 "${actor}"——先 action="list" 看看都有谁。`)
          return { actors: [toActorOut(found)] }
        }
        default:
          return { actors: (await pool.list()).map(toActorOut) }
      }
    },
  }))
  ctx.tools.register(defineTool({
    name: PLAYER_TOOL,
    description: describePlayerTool(),
    parameters: {
      action: {
        type: 'string',
        enum: ['list', 'spawn', 'say', 'relay', 'unseat'],
        description: 'list = 看桌上都有谁（默认）；spawn = 让一位 AI 玩家上桌；say = 把一句话说给某位玩家或全桌；relay = 把某位玩家刚说的话转达给桌上其余人；unseat = 从座位上撤掉这位玩家。',
      },
      seat: { type: 'string', description: 'spawn / say / relay / unseat 用：座位 id，要与局面里的 seats 用同一套命名。say 也可以用 "*" 表示说给全桌听。' },
      name: { type: 'string', description: 'spawn 用：角色名。' },
      roleBook: {
        type: 'string',
        description: 'spawn 用：这个角色的角色本。复盘前 jubensha_case action="book" 给的是一个引用，把它（单独那一串）填进来即可——程序自己解开，正文不经过你的上下文；复盘后也可以直接给全文。只发给这一个玩家，绝不转述、绝不换座位。',
      },
      message: { type: 'string', description: 'say 用：要对这位玩家说的话——提问、转述，或阶段提示。' },
      actor: { type: 'string', description: 'spawn 用：由池子里的哪个演员来演这一局（jubensha_actor 的 id）。不填就是个新面孔——那样他不会记得这一局，下一局也没人记得他。' },
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
          const book = resolveBook(roleBook, seat)
          // 演员是「谁在玩」，与「这局演谁」无关。不填就是个一次性的面孔——他不记得上一局，
          // 下一局也没人记得他。填了就把池子里那份档案带进上台说明。
          const actorId = args.actor
          const actor = actorId === undefined
            ? undefined
            : await requireActors(ctx).then(pool => pool.get(actorId))
          if (actorId !== undefined && actor === undefined) {
            throw new Error(`演员池里没有 "${actorId}"——先 ${ACTOR_TOOL} action="list" 看看都有谁，`
              + '或者用 action="add" 招一个进来。')
          }
          // 先问座位空不空，再建子会话。反过来的话，座位被占时那个刚建好的子会话就没人管了
          // ——登记表自己也拦这一手，但那时已经晚了。
          const sitting = players.get(seat)
          if (sitting !== undefined) throw new Error(`座位 "${seat}" 上已经有人了（${sitting.name}）；先 unseat 再 spawn。`)
          const dm = exec.agent
          if (dm === undefined) throw new Error(`${PLAYER_TOOL} 需要一个调用它的 agent。`)
          const teams = ctx.get('agentTeams')
          if (teams === undefined) {
            throw new Error(`这个部署里没有 agent-team 服务，${PLAYER_TOOL} 用不了——需要 @deepseek-ai/dsh-experimental-agent-team 与 agent-team-profile。`)
          }
          // 先把判据挂上、再建人：这样 `agent/created` 一到就认得出这是谁，收窄能赶在
          // 它的第一个请求之前——而 spawnTeammate 返回后再收是赶不上的（实测输过）。
          awaiting.set(dm.id, { seat, name: playerName })
          try {
            const spawned = await teams.spawnTeammate(dm, {
              // 座位号 + 自带唯一性的后缀；中文角色名走 description，那才是 label。
              name: teammateName(seat),
              description: `玩家 ${playerName}（${seat}）`,
              prompt: [{ type: 'text', text: playerBrief({
                seat,
                name: playerName,
                roleBook: book,
                ...(actor === undefined ? {} : {
                  actor: {
                    name: actor.name,
                    style: actor.style,
                    notes: actor.notes.slice(0, NOTES_IN_BRIEF),
                  },
                }),
              }) }],
              context: 'fresh',
              provider: 'spawn',
              signal: exec.signal,
            })
            // 兜底：万一 agent/created 没赶上（或没触发），这里再收一次，`confine` 自己去重。
            confineMember(ctx, spawned.member, seat)
            players.seat({ seat, name: playerName, childId: spawned.member.id, dmId: dm.id })
          } finally {
            awaiting.delete(dm.id)
          }
          break
        }
        case 'say': {
          const { seat, message } = args
          if (seat === undefined || message === undefined) throw new Error('say 需要 seat 与 message 两项都给。')
          const dm = exec.agent
          if (dm === undefined) throw new Error(`${PLAYER_TOOL} 需要一个调用它的 agent。`)
          // seat="*" 是说给全桌听：桌上每个人都该听见，一条命令发出去，程序保证一个都不漏。
          // 逐个手发正是"漏掉某个人"的来源，而漏掉的那个不会知道自己漏了什么。
          const listeners = seat === '*' ? players.list() : [requirePlayer(seat)]
          if (listeners.length === 0) throw new Error('桌上还没有 AI 玩家。')
          await deliver(ctx, dm, listeners, message, exec.signal)
          delivered = listeners.map(listener => listener.name).join('、')
          break
        }
        case 'relay': {
          const { seat } = args
          if (seat === undefined) throw new Error('relay 需要 seat——要转达哪一位玩家刚说的话。')
          const speaker = requirePlayer(seat)
          const said = players.lastSaid(seat)
          if (said === undefined) {
            throw new Error(`${speaker.name} 还没开过口——没有可转达的话。`)
          }
          const dm = exec.agent
          if (dm === undefined) throw new Error(`${PLAYER_TOOL} 需要一个调用它的 agent。`)
          const others = players.list().filter(player => player.seat !== seat)
          if (others.length === 0) throw new Error(`桌上只有 ${speaker.name} 一个人，没有人可转达。`)
          // 带上说话人：收信人的默认预期是"主持人在跟我说话"，不加署名会把这句当成我的话。
          await deliver(ctx, dm, others, `（${speaker.name}）${said}`, exec.signal)
          delivered = others.map(other => other.name).join('、')
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
