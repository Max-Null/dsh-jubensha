# `spawn_player` 的可行方案 —— 「只给玩家说话能力」怎么实现

> 这份文档自包含：从「要解决什么」到「照哪个范例抄」，证据全部给到源码位置。
> 2026-10-05 已按它实现并实测通过（`src/player.ts` 与 `src/index.ts` 里的 `jubensha_player`）。
> §五 逐条标了哪些是读码确证、哪些已实测、哪些仍待办；§六 是那次实测的记录。

## 一、要解决什么

AI 玩家必须**只能说话**：它要知道自己的角色本、能上桌发言、能被人提问，
但**读不到本子文件**（工作区是共享的，真相手册、别人的角色本都在那儿）。

设计出处：[`2026-10-04-单机剧本杀-设计方案.md`](2026-10-04-单机剧本杀-设计方案.md) §3.4 第 2 条。
那条当时的结论是「**能否做成插件、怎么做到，需要单独验证，不能凭架构推断**」——
本文档就是那次验证的结果。

**已经排除的路**（2026-10-04 读码确证）：

- `spawn_teammate` 的入参**没有**权限或工具集字段。本会话实际拿到的工具 schema 只有
  `name` / `description` / `prompt` / `context` 四项，与当时读 `SpawnTeammateRequest` 的结论一致。
- 用文件策略（`danger-full-access` + 审批禁用）挡不住：审批在这个策略下自动拒绝，
  而且改会话策略会**连 DM 一起限**。

## 二、找到的机制：`ToolRuntime.restrict()`

`@deepseek-ai/dsh-tools` 的 `ToolRuntime` 上有一个现成 API：

```ts
/**
 * Restrict global tools for the calling agent scope. …
 * @param filter - global-tool mask: `allow` (keep only) and/or `deny` (remove).
 * @returns the exact disposer that lifts this restriction.
 */
restrict(filter: ToolRestriction): () => void

/** Per-scope filter over global tools. Restrictions intersect and do not affect
 *  scoped registrations or the reserved PTC mode transport. */
export interface ToolRestriction {
    /** Global tool names that stay visible; everything else is removed. */
    readonly allow?: readonly string[];
    /** Global tool names removed from visibility. */
    readonly deny?: readonly string[];
}
```

**关键性质**（全部摘自同一份类型声明 `dsh-tools/lib/types/index.d.ts`）：

| 性质 | 出处 | 对我们的意义 |
|---|---|---|
| 作用域是「**the calling agent scope**」 | `restrict` 的 JSDoc | 在**某一个 agent** 的 ctx 上调，不影响别人 —— DM 不受影响 |
| **不可见 = 从模型视角不存在** | `resolveExecution` 的 JSDoc：`Denial surfaces as UNKNOWN_TOOL … matching an absent definition`；`get()` 的 JSDoc：`a restricted-away global reads as absent` | 玩家**根本看不到**文件工具，不会去试 |
| 过滤的是**继承层**，**不含自己那层** | `view()` 的 JSDoc：`A restriction filters what a scope inherits — the global layer and every ancestor layer on its chain — and never what its OWN layer registers` | 关键：工具若被挪到 agent 平面（preset 就是这么干的），它们成为**祖先层贡献**，filter **仍然管得住** |
| 与 `guard` 是两套东西 | `guard()` 的 JSDoc：`a returned string denies the execution` | `restrict` **隐藏**、`guard` **拒绝**。给玩家用前者：他看不到就不会反复尝试 |

### 那条「曾经失效过」的历史正好是我们的安全保障

`view()` 的 JSDoc 里记着一次真实回归：

> Reading the exempt set as "the global layer" instead of "not mine" held only while every
> model-facing tool sat in the host composition. **Once presets moved them onto the agent plane
> they became an ANCESTOR contribution, so a child's filter silently stopped constraining
> anything it was given.**

也就是说：这条路径**坏过一次**（工具搬到 agent 平面后，子 agent 的过滤器静默失效），
而**现在修好了**。我们踩在修好的版本上，但这也提醒：**升级内核后要重测这条**。

### 2.1 官方已经把同一条路封装好了：`toolFilter`

**这是本文档最重要的一条** —— 要做的事，DSH 在**子 agent 创建**这条路上已经内建。
官方实现里就一行（`subagent/src/child-agent.ts:218`）：

```ts
if (composition.toolFilter !== undefined) childCtx.tools.restrict(composition.toolFilter)
```

也就是说：**`restrict()` 正是官方给子 agent 收窄工具时用的那个调用**，并被封装成了 spawn 请求的字段：

- 字段类型就是 §二 的 `ToolRestriction`（`subagent/src/types.ts:192`）
- 需要 provider 声明能力 `SubagentCapabilities.toolFilter`（`types.ts:134`）；
  `subagent-spawn-in-process` 声明了 `toolFilter: true`（其 `src/index.ts:46`），而
  **Agent Teams 的默认 provider 就是 `spawn`**（`agent-team-profile/cordis.patch.yml` 里的
  `freshProvider: spawn`）—— 所以这条路对我们是通的。

**两条行为已被官方测试固定**（`subagent-spawn-in-process/tests/`）：

| 行为 | 测试标题 |
|---|---|
| `deny` 的工具**既从子 agent 的提示里消失，也拒绝执行** | `toolFilter hides denied tools from the child prompt AND refuses their execution` |
| **filter 里写了不存在的工具名 → spawn 直接失败**，且不留孤儿 agent | `an unknown toolFilter name fails the spawn loudly with no orphaned child` |

第二条是**部署时就会炸**的错误，不是运行时静默失效 —— 这是好事，宁可它响亮地失败。

**两个已被官方处理的陷阱**：只给 `deny` 不给 `allow` 时**不会** materialize 成空 allow-list
（防 deny-all `it('a partial toolFilter (deny only) does not materialize an empty allow-list (deny-all trap)')`）；
而**空 filter（两个都不给）会在插件加载时直接报错**（`tool-subagent/src/index.ts:318`）。

## 三、照哪个范例抄

`@deepseek-ai/dsh-experimental-tool-agent-team` 做的就是同一件事——
**给一类 agent 装一套特定工具**。它的源码（`tool-agent-team/src/index.ts`）是我们的模板：

```ts
// :163-165  在「某一个 agent 自己的 scope」上注册
const scoped = agent.ctx
register(scoped.tools.register(defineTool({ name: 'spawn_teammate', … })))

// :190-192  创建成员走 Team 服务
const agent = callingAgent(exec.agent, 'spawn_teammate')
const result = await ctx.agentTeams.spawnTeammate(agent, { … })

// :401-421  安装模式：遍历现有 agent + 订阅后续创建
if (installed.has(agent) || ctx.agentTeams.tryMembership(agent) === undefined) return
for (const agent of ctx.agents.list()) maybeInstall(agent)
```

**我们要抄的是最后那段的结构**，把「安装工具」换成「施加限制」：

1. 订阅 agent 创建（`ctx.on('agent/created', …)`，与官方同一事件）
2. `ctx.agents.list()` 补扫已存在的
3. **认出哪些是我们的玩家**
4. 对它们：`agent.ctx.tools.restrict({ deny: [...] })`
5. **保留 disposer**，agent 销毁时撤销（官方同样按 disposer 逆序撤销）

## 四、方案

### 4.1 玩家怎么创建

**结论（读完 `agent-team` 的 spawn 实现后修正）**：原先倾向的「复用 Team」这条路**拿不到
`toolFilter`**。证据是死的 —— 请求类型里根本没有那个字段：

```ts
// agent-team/src/types.ts:166-173
export interface SpawnTeammateRequest {
  readonly name: string
  readonly description: string
  readonly prompt: ContentBlock[]
  readonly context: 'fresh' | 'fork'
  readonly provider: string
  readonly signal: AbortSignal        // ← 没有 toolFilter
}

// agent-team/src/roster.ts:282-291 —— spawn 时只透传了这两项
started = await this.ctx.subagents.startContinuable({
  childId, provider: request.provider, label: description,
  request: { prompt: request.prompt, parent: root },   // ← 没有 toolFilter
  signal,
})
```

**所以首选改为直连 subagent 服务**：

```ts
await ctx.subagents.startContinuable({
  childId, provider: 'spawn', label: '玩家 p1',
  request: { prompt, parent: leadAgent, toolFilter: { allow: [...] }, persona: 角色本 },
  signal,
})
```

**为什么这样反而更好**（不是退而求其次）：

- **`toolFilter` 直接可用** —— 官方在 `child-agent.ts:218` 替我们调 `restrict`，零自定义。
- **continuable 自带 sendMessage** —— 不必借 Team 的 mailbox 来给玩家发话。
- **玩家不该进 Team 的 roster** —— 它是玩家，不是同事。Team 那套（任务板、write scope、
  Lead 权限）对一张剧本杀的桌子全是噪声。

**原先那句「玩家进 Team 才收得到消息」是个假前提**：消息能力来自 continuable，
不是来自 Team。A 路唯一多给的是一套用不上的协作机制。

**兜底仍然成立**：即便将来 `toolFilter` 不可用，`restrict()` 是公开 API（§二），
插件可以在 `agent/created` 里自己调 —— 但那时需要「认出这是玩家」的判据（§4.2）。
**直连创建让我们在创建那一刻就知道是谁，那个判据问题随之消失。**

### 4.2 玩家的登记（不再是「识别」问题）

§4.1 改成直连创建之后，**「这个 agent 是不是玩家」不再需要事后识别** ——
创建那一刻就是我们自己调的，`childId` 一直在手里。

但登记仍然要有，只是作用变了：它承载的是**游戏数据**，而不只是身份标记 ——
哪个 child 演哪个角色、角色本是什么、这一局的发言记录挂在哪。

一个 `Map<SeatId, PlayerHandle>` 就够：键是游戏里的位子（`p1`/`p2`…），值是 child 句柄。
**注意与插件已有的 `state.ts` 对齐** —— `GameState.seats` 里存的就是这些位子 id，
两处别各造一套命名。

### 4.3 白名单里放什么

**只保留一个：`send_message`** —— 对 DM 说话。这就是「玩家只能说话」的全部实现。

**白名单式比逐个 deny 稳**：新内核会加新工具，逐个 deny 的清单会过期，而 `allow`
只保留点名的那些。代价是名单里的名字必须真实存在（`restrict()` 对未知名字抛错，
错误信息还会列出全部已知工具名）——而这里的失败模式恰好是我们想知道的：
少了 `send_message`，就等于玩家没法开口。

> 注意语义差别：`allow` 是「**只保留**这些，其余移除」，不是「额外放行」。

**一条实测出来的边界**（见 §六）：`allow` 只过滤 scope **继承**到的工具，管不到 agent
**自己那层**注册的。内核的委派工具 `subagent` 属于后者，所以玩家实际看到两个工具而不是一个。
要连它一起收，得另加 `tools.guard()`。

## 五、确证 / 已验证 / 仍待办

**读码确证**：

- `spawn_teammate` 工具无权限字段（运行时 schema 四项）
- `ToolRuntime.restrict(filter)` 存在，作用域是 calling agent scope，语义是隐藏
- `agent.ctx` 是 agent 自己的 scope（`tool-agent-team` 就这么用）
- 创建成员走 `ctx.agentTeams.spawnTeammate(caller, request)`
- 安装模式：遍历 `ctx.agents.list()` + 订阅创建事件 + disposer 撤销

**已实测**（2026-10-05，隔离实例，记录见 §六）：

1. **`toolFilter` 真的收窄了玩家的工具面** —— 玩家模型请求里的 `tools` 是
   `send_message, subagent`；同期 DM 那边有 `pwsh` / `read` / `render_ui` / `jubensha_*` 全套。
2. **`startContinuable` 返回 `{ childId, messageId }`**（`subagent/src/types.ts:53-58`）。
   `childId` 是跨 activation 稳定的 durable 子会话 id，拿它发话就够，不需要别的句柄。
3. **`restrict` 的 disposer 不用自己管** —— `applyChildComposition` 直接丢弃返回值
   （`subagent/src/child-agent.ts:218`），因为它是挂在子 scope 上的 effect，随 scope 销毁撤销。
4. **未知工具名响亮失败**，报错列出全部已知工具名，且不留孤儿子会话。

**仍待办**：

1. **`subagent` 绕过白名单**（§六 末尾）。它是 per-agent 注册的，`allow` 管不到。
   要连它一起收需要 `tools.guard()` —— 而**「guard 挡得住 own 层」这一条本身还没验过**，
   别当成已知结论用。
2. **升级内核后重测上面四条**（§二 末尾那条回归说明：这条路径坏过一次）。
3. **玩家会出戏汇报**：实测里玩家有几次不发台词，改发「进展（林晚侧）：已向主持人确认口径…」
   这类元层面汇报。上台说明需要更硬的约束。

**验证环境**：`.ssid-iso-test` 的隔离实例（已启用 Agent Teams + 本插件，见
`.ssid-iso-test/launch-dev-with-pluginset.ps1`）。探针：`probe-tool-call.mjs`（工具调用）、
`dump-session-tools.mjs`（请求里的工具面）、`grep-session.mjs`（按关键词取全文）、
`jubensha-drive.mjs`（驱动会话）。

## 六、一次实测：玩家上桌之后看到了什么

2026-10-05 在 `.ssid-iso-test` 的隔离实例上跑通：DM 调 `jubensha_player` 开出 p1「林晚」，
再用 `say` 和它对话了五轮。

**它真的上桌了** —— spawn 返回 `{"players":[{"seat":"p1","name":"林晚"}],"delivered":"林晚"}`，
`isError: false`；`sessions-ssid-dev` 下多出一个子会话（`162d4a39-…`）。

**它的工具面被收窄了**，这是直接证据而非行为推断。玩家会话日志里 `request/header` 事件的
`data.header.tools` 是：

    send_message, subagent

而同一会话根下 DM 自己的会话有 `pwsh`、`read`、`render_ui`、`jubensha_state`、
`jubensha_player` 一整套。

**为什么必须看请求里的清单，而不是问它「你能读文件吗」**：我确实下过一条指令，要玩家用
`read` 读一个宿主路径。它回：

> 你这句不是桌上该说的话。我是林晚，p1，玩家。你要文件里的字段，去找管这摊事的人，
> 别拿剧本来问我。

**这句话既像「我没有 read」，也像「我不干」。** 一个在角色里的 agent 拒绝出戏要求是正常反应。
行为证据在这里分不开这两种解释，只有请求里的 `tools` 清单能。

### 那个多出来的 `subagent`

`allow: ['send_message']` 按语义是「只保留这一个」，玩家却看到两个。原因不在配置写错，
而在 `restrict` 的定义边界：

- `view()` 的规则是限制只过滤 scope **继承**到的东西 —— global 层与链上每一层祖先 ——
  **从不包括它自己那层**（`core/tools/src/index.ts:1180-1209`）
- 而 `subagent` 是内核委派工具，每个 agent 创建时用**它自己的 ctx** 注册
  （`subagent/tool-subagent/src/index.ts:665-683` 的 `candidate.ctx`）

三条观察互相印证，机制闭合：

| 工具 | 结局 | 与机制一致 |
|---|---|---|
| `send_message` | 留下 | 在 `allow` 里，且全局注册 |
| `subagent` | 留下 | per-agent 注册（own 层），`restrict` 管不到 |
| `subagent_fork` | 移除 | 全局注册，可被过滤 |

第三条那份清单是顺手拿到的：往 `PLAYER_TOOLS` 里塞一个不存在的名字，spawn 会响亮失败并
吐回全部已知工具名 —— 表里有 `send_message` 和 `subagent_fork`，**没有** `subagent`。

**后果有多严重**：玩家能自己开子 agent。那些子 agent 的祖先链上带着同一个 restriction，
所以**读不到文件**这件事没有被破坏；但它不是设计想要的「只能说话」，而且会消耗 agent 配额。
修法是另加 `tools.guard()` —— guard 是执行时的检查，与工具注册在哪一层无关。
