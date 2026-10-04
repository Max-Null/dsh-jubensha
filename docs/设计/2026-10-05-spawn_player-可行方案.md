# AI 玩家「只能说话」怎么落地 —— `jubensha_player` 的实现

> 这份文档自包含：从「要解决什么」到源码位置，再到三次迭代踩过的坑。
> 2026-10-05 实现并实测通过。§五 标了哪些是读码确证、哪些已实测、哪些仍待办；§六 是那两个时序坑。

## 一、要解决什么

AI 玩家必须**只能说话**：它要知道自己的角色本、能上桌发言、能被人提问，
但**读不到本子文件**（工作区是共享的，真相手册、别人的角色本都在那儿）。

设计出处：[`2026-10-04-单机剧本杀-设计方案.md`](2026-10-04-单机剧本杀-设计方案.md) §3.4 第 2 条。
那条的实测依据是一次探针事故：**一个 agent 被明确告知「不要使用任何工具」，仍然调了 `memory_save`
并把测试串写进了记忆库。** 所以「靠 prompt 划边界」不足以作为方案。

## 二、选型

### 2.1 被排除的两条路

**① 子 agent 的 `toolFilter`**（官方在子 agent 创建窗口施加 `tools.restrict()` 的那个字段）。
它是**收窄工具最省事的**一条，但要放弃 Team：`SpawnTeammateRequest`（`packages/experimental/agent-team/src/types.ts:166-173`）
六个字段 `name / description / prompt / context / provider / signal` 里**没有它**，而 `roster.ts:286-289`
转发时也只传 `prompt` 与 `parent`。

**② 纯 prompt 纪律**（「你不许用工具」）。第一局实践过，就是 §一 那次事故。

### 2.2 采用的：Team 建人 + 插件两层收窄

**玩家用 `spawnTeammate` 创建，然后由插件在它的 agent ctx 上收窄。**

选 Team 不是审美偏好 —— 它有两局实测支撑（`cases/03-没拆的那封信/run-03-复盘.md:88-95`）：

| | case-01 | case-02 | case-03 |
|---|---|---|---|
| AI 实现 | `subagent`（一次性） | `teammate`（持久） | `teammate`（持久） |
| 记忆漂移 | **有**（被玩家抓包） | 无 | 无 |

第 1 局漂移的根源是**一次性**：每次调用新建一个 agent、没有会话记忆，DM 只能手抄重建，
重建必然有偏差。**持久性来自 `ctx.subagents.startContinuable`** —— 而 `spawnTeammate` 内部调的
就是它（`agent-team/src/roster.ts:282`）。所以「Team 拿不到 `toolFilter`」不是「Team 不行了」，
只是那一个字段不可用；收窄改由插件自己做。

## 三、创建

```ts
const spawned = await ctx.agentTeams.spawnTeammate(dm, {
  name: `${seat}-${++seatSerial}`,      // 见 §六 的第三次迭代
  description: `玩家 ${playerName}（${seat}）`,   // 这一项才是人看的 label
  prompt: [{ type: 'text', text: playerBrief({ seat, name: playerName, roleBook, dmId: dm.id }) }],
  context: 'fresh',
  provider: 'spawn',
  signal: exec.signal,
})
```

返回值 `SpawnTeammateResult.member.id` 是 `SessionId`（`agent-team/src/types.ts:59`），
拿它取回 agent 再收窄。

**两处容易踩的**：

- **`context` 必须是 `'fresh'`**。`'fork'` 会让玩家继承 DM 的对话历史——那里面有真相、
  有别人的角色本，**恰好是信息隔离要挡住的东西**。
- **`name` 有格式与唯一性约束**（lower-kebab-case，且同一 Team 内不可重名），
  中文角色名进不去，所以让它走 `description`。

## 四、收窄：两层，各管一段

### 4.1 第一层 `tools.restrict` —— 管「看不看得见」

```ts
agent.ctx.tools.restrict({ allow: ['send_message'] })
```

不在白名单里的工具对玩家**根本不存在**，模型不会去试。实测把继承层从 **146 个工具清到 0**。

但它有一条**定义上的边界**：`view()` 的 JSDoc 写着
`A restriction filters what a scope inherits … and never what its OWN layer registers`
（`packages/core/tools/src/index.ts:1180-1209`）。而内核的委派工具 `subagent` 正是每个 agent
创建时注册进**它自己那层**的（`subagent/tool-subagent/src/index.ts:665-683` 用 `candidate.ctx`）
——那一层它管不着。

### 4.2 第二层 `tools/pre-execute` —— 管「准不准执行」

```ts
agent.ctx.on('tools/pre-execute', (exec, next) => {
  if (!allowed.has(exec.name)) return Promise.resolve({ kind: 'deny', reason: … })
  return next()
})
```

**这是补上那个缺口的地方，也是官方自己指的路**：`shell/tool-bash/src/index.ts:9` 的 TODO 原文是
`deployment policy belongs in tools/pre-execute`。机制在 `core/tools/src/index.ts:1504-1519`：
它在**工具解析之后、执行之前**跑，carrier 是 `scopeTarget(this, exec.agent)` —— 按**执行者本人**
的 scope 路由，所以**它不问那个工具注册在哪一层**。deny 之后走 `materializeFinalResult`，
模型收到一条带理由的 `isError` 结果。

实测（玩家会话里的原话）：

```
Error: 座位 p2 上只做一件事：说话。list_agents 用不了。
```

> `tools.guard` 也能担这一层（它是 monotonic 的、只能 deny）。这里用 `pre-execute` 是因为它
> 还能读到 `exec.arguments` —— §4.3 要用。

### 4.3 顺带收掉「对谁说话」

Team 版的 `send_message` 收 teammate 名字或 session id，玩家理论上能点名任何一位同伴——
**那会变成串供**。所以同一道闸里再判一次对象：

```ts
if (exec.name === SPEAK_TOOL) {
  const target = readTarget(exec.arguments)
  if (target === undefined || !audience.has(target)) return deny(…)
}
```

`audience` = 主持人的 session id + `'lead'`（`spawn_teammate` 给每个成员的初始说明里就写着
Lead 叫这个名字）。

实测（玩家会话里的原话）：

```
Error: 座位 p1 只能对主持人说话，"table" 不是主持人。
```

## 五、确证 / 已验证 / 仍待办

**读码确证**：

- `SpawnTeammateRequest` 无工具集字段（`agent-team/src/types.ts:166-173`）
- `spawnTeammate` 内部调 `startContinuable`（`agent-team/src/roster.ts:282`）——持久性来自那里
- `restrict` 只过滤继承层（`core/tools/src/index.ts:1180-1209`）
- `pre-execute` 按执行者 scope 路由（同上 `:1504-1519`），官方指路见 `tool-bash/src/index.ts:9`

**已实测**（2026-10-05，隔离实例，记录见 §六）：

1. **玩家真的上桌了**：`spawn` 返回 `{"players":[{"seat":"p1","name":"林晚"}],"delivered":"林晚"}`，
   `isError: false`；会话目录里多出一个子会话。
2. **收窄生效且跨 activation 稳定**：玩家会话里 `[5 次] 10 个工具`，**只有一种签名**。
3. **第一层清了继承层**：146 个工具 → 0（玩家请求里再也看不到 `pwsh` / `read` / `edit` / `jubensha_*`）。
4. **第二层拦住 own 层**：`list_agents` 被拒（§4.2 的原文）。
5. **对象也收住了**：非主持人的 target 被拒（§4.3 的原文）。
6. **玩家能被 DM 盘问**：五轮对话，玩家在第 5 轮准确复述第一轮自己说的话与多轮前的追问方式——
   上下文保留（那是选 Team 的那条理由）。

**仍待办**：

1. **玩家看得见 10 个工具、只能用 1 个**。那 10 个是走 Team 的必然残留：Team 成员的
   `spawn_teammate` / `team_task_*×4` / `wait_agent` / `interrupt_agent` / `list_agents`，
   加上内核的 `subagent` —— 全部注册在 agent 自己那层，`restrict` 管不到。
   **安全上没问题**（闸兜住了），代价是占 prompt 空间、可能引它试一次。
   「进 roster」与「工具面绝对干净」在机制上不可兼得。
2. **一局结束后那些 teammate 名字不会释放**（§六 第三次迭代）。
3. **玩家会出戏**：实测里它几次不发台词，改发「进展（林晚侧）：已向主持人确认口径…」这类
   元层面汇报。上台说明（`playerBrief`）需要更硬的约束。
4. **升级内核后重测上面六条**。`restrict` 有过一次真实回归（工具搬到 agent 平面后子 agent 的
   过滤器静默失效，见 `view()` 的 JSDoc），这条路径是修好之后的版本。

**验证环境**：`.ssid-iso-test` 的隔离实例（`launch-dev-with-pluginset.ps1`，CDP 9222）。
探针：`jubensha-drive.mjs`（驱动会话）、`probe-tool-call.mjs`（工具调用）、
`dump-session-tools.mjs`（请求里的工具面）、`grep-session.mjs`（按关键词取全文）。

## 六、三次迭代与两个时序坑

这一节记的是**为什么最终长成这样**——三次迭代里有两次是被实测打回来的。

### 第一次：收窄挂在 spawn 返回之后 —— 输了

```ts
const spawned = await teams.spawnTeammate(dm, {…})
confineMember(ctx, spawned.member, seat)     // 来晚了
```

`startContinuable` 是 **resolve 在「inbox acceptance」** 的（`tool-subagent/src/index.ts:528`
的注释原话：`Resolves at inbox acceptance: the child owns its own turns from there`）——
也就是说 `spawnTeammate` 返回时，玩家的 turn **可能已经在跑**。

实测打脸：玩家会话的工具面是 `[2 次] 146 个工具` + `[1 次] 10 个工具` ——
**头两个请求带着全套工具**（`pwsh` / `read` / `edit` 都在），第三个才是收窄后的。

### 第二次：改用 `agent/created` —— 但只挂了一次

`agent/created` 比返回值早，是唯一赶得上的时机。但那一刻只拿得到一个 Agent、
**认不出它是不是玩家**，于是加了一张登记表：

```ts
const awaiting = new Map<string, { seat, name }>()   // DM 的 session id → 待上桌的那位
```

spawn 前登记、`agent/created` 里按 `parentSession` 认领。这一版**第一个请求就干净了**。

但换一个更长的会话再测，工具面又变成 `[1 次] 10 个工具` + `[4 次] 146 个工具` ——
**限制在第一个请求生效过，后面又变回全套。**

原因是**续命子会话每次 activation 都是一个新的 Agent 对象**（官方 `tool-subagent` 的
`installScoped` 用 `agent/created` + `agent/disposed` 维护映射，正是预期它会反复创建），
而收窄挂在 agent 的 ctx 上。所以 **`confine` 必须在每次 `agent/created` 时重挂**，判据不能是
「正在上桌」那张临时表，得是**在座登记表**：

```ts
ctx.on('agent/created', ({ agent }) => {
  const sitting = players.find(agent.session.header.id)   // 已在座的：重挂
  if (sitting !== undefined) { confine(agent, sitting.seat, sitting.dmId); return undefined }
  …                                                        // 正在上桌的：认领
})
```

`players.find(childId)` 就是为这条加的（`player.ts` 的 `PlayerRegistry`）。
修完实测 `[5 次] 10 个工具`、**只有一种签名**。

### 第三次：`TEAM_MEMBER_NAME_TAKEN`

用座位号当 teammate 名字，同一个座位第二次上桌就撞：

```json
{"name":"TeamError","code":"TEAM_MEMBER_NAME_TAKEN"}
```

`roster.ts:271-273` 对重名直接抛。**名字不随玩家下桌释放**，所以在同一个进程里
`p1` 只能用一次。改成 `${seat}-${++seatSerial}` —— 人看的是 `description`（label），
这个 name 只有机器用。

### 一条一般化教训

两次时序坑是同一类：**「什么时候挂上」和「挂在哪个对象上」，在生命周期里是两个独立的问题。**
第一次错在挂得太晚，第二次错在只挂给了一个会消失的对象。判据是：**问那个承载物会不会被重建** ——
会的，就得把挂载点挪到「每次重建都会触发的那个事件」上，而不是挪到「更早的时刻」。
