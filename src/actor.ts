/**
 * 演员 —— 跨局存在的那个人，与它这一局演什么角色无关。
 *
 * **为什么需要它**：`spawn_teammate` 建出来的玩家是**会话内**的成员，一局打完就散。
 * 而设计方案把人设分成两层（§2.2）：角色人设是本子给的，**玩家性格**——这个人怎么玩游戏
 * ——是**跨局稳定**的。「同一份剧本换个人玩，玩法完全不同」这句话要成立，就得有一个不随
 * 会话消失的载体。那就是演员：一局里他坐在某个位子上、拿某个角色本；下一局可能换位子、
 * 换本子，但「他是谁」不变。
 *
 * 这条在「一局一个会话」拍板之后从「锦上添花」变成了**必须**：跨局的连续性再没有第二个
 * 地方可放。
 *
 * **落盘走宿主提供的 storage，不自己写文件**：域有 zod schema 校验，一条不合格的记录会让
 * 整个打开失败（fail loud）；手写的 JSON 坏掉时是静默半坏，而这份数据是跨局的——坏一次
 * 会跟着所有后续的局。机制与调用顺序照 `dsh-memory/src/engine.ts` 的存储层。
 *
 * @module @max-null/dsh-jubensha/actor
 */
import { defineDomain, domainTable, DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import { JsonStorageBackend } from '@deepseek-ai/dsh-storage-json'
// 这两个 type-only import 拉入 Context 上的服务声明。`storage` 必须在插件的 `inject` 里声明
// （见 `index.ts`）——`DomainFacility` 内部按属性访问 `ctx.storage`，那只看声明过的注入。
import type {} from '@deepseek-ai/dsh-storage'
import type {} from '@deepseek-ai/dsh-storage-domain'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { z } from 'zod'
import type { Context } from '@deepseek-ai/cordis'

/** 存储里一条演员记录的字段；zod 是它的唯一定义处，类型由它推。 */
const storedActorSchema = z.object({
  /** 稳定 id。 */
  id: z.string(),
  /** 人看的名字，比如「老周」。 */
  name: z.string(),
  /** 这个人怎么玩游戏——第二层人设，跨局稳定。 */
  style: z.string(),
  /** 跨局攒下来的印象，**新的在前**。 */
  notes: z.array(z.string()),
  /**
   * 头像图片的位置。
   *
   * **没配就是不配**——缺省时界面按 id 生成一个 SVG（见 `avatar.ts`）。所以这里不需要一个
   * `kind: 'svg'` 的分支：生成是缺省行为，存下来的只会是"用户真的换了张图"。
   */
  avatar: z.string().optional(),
})

/** 一个演员。 */
export type Actor = z.infer<typeof storedActorSchema>

/**
 * 演员域的声明。
 *
 * 域名与表名都要匹配 `UNIT_NAME_RE`（`/^[a-z][a-z0-9_]*$/`，`storage/src/backend.ts:10`），
 * 因为它同时是文件名与 SQL 标识符的一段。`defineDomain` 在**模块加载时**就校验这些，
 * 早于任何介质被触碰。
 */
const actorSpec = defineDomain({
  name: 'jubensha',
  version: 1,
  tables: { actors: domainTable<string, Actor>(storedActorSchema) },
})

/** 演员池：跨局的那份名册。 */
export interface ActorPool {
  /**
   * 池子里所有演员，按名字排序。
   * @returns 演员数组（副本）。
   */
  list(): Promise<readonly Actor[]>
  /**
   * 按 id 取一个演员。
   * @param id - 演员 id。
   * @returns 那个演员；不在池子里时为 `undefined`。
   */
  get(id: string): Promise<Actor | undefined>
  /**
   * 新建一个演员；id 已存在时抛。
   * @param input - 名字与风格。
   * @returns 建好的演员。
   */
  add(input: { readonly id: string; readonly name: string; readonly style: string }): Promise<Actor>
  /**
   * 给一个演员追加一条跨局印象。
   * @param id - 演员 id。
   * @param text - 这次要记下的事。
   * @returns 更新后的演员。
   */
  note(id: string, text: string): Promise<Actor>
  /**
   * 改这个演员**怎么玩**。
   *
   * 与 `add` 分开是因为改风格是常事（用户看过一局之后想调），而重新招一个人会丢掉印象——
   * 名字与印象都不动，只换这一件。
   * @param id - 演员 id。
   * @param style - 新的玩法描述。
   * @returns 更新后的演员。
   */
  setStyle(id: string, style: string): Promise<Actor>
  /**
   * 给他换一张头像图；传空串表示换回按 id 生成的那个。
   * @param id - 演员 id。
   * @param image - 图片路径，或者空串。
   * @returns 更新后的演员。
   */
  setAvatar(id: string, image: string): Promise<Actor>
}

/**
 * 演员池落在哪。
 *
 * 跟 `dsh-memory` 的 `memory.json` 同目录——一个宿主 home 一份，**跟着人走而不是跟着工作区
 * 走**：换个工作区开一局，坐下来的还是同一批演员。这也是它不进 `<cwd>/.dsh/storages` 的
 * 理由（那个根随 git 分享，而演员池是私人的）。
 * @returns 存储根目录。
 */
export function actorRoot(): string {
  return join(process.env['DSH_HOME'] ?? join(homedir(), '.dsh'), 'storages')
}

/**
 * 打开演员池。
 *
 * `register` 对重名抛 `duplicate-backend`，所以 backend **只注册一次**：域名固定为
 * `jubensha`，同进程重复打开会撞上它。调用方拿单例（`index.ts` 的 `requireActors`）。
 * @param ctx - 插件上下文，用来取 storage 服务。
 * @returns 打开的演员池。
 */
export async function openActorPool(ctx: Context): Promise<ActorPool> {
  ctx.storage.backend.register('jubensha_actors', new JsonStorageBackend(actorRoot()))
  const facility = new DomainFacility(ctx, { backend: 'jubensha_actors', routes: {} })
  const domain = await facility.open(actorSpec)
  const table = domain.table('actors')

  // `KvTable` 是**同步读、异步写**：`get` / `entries` 直接从内存里给，`put` / `update` 才等落盘。
  // 所以下面这些方法包一层 Promise 只是为了让调用方不必记住哪一半是同步的。
  return {
    list() {
      const all = [...table.entries()].map(([, actor]) => actor)
      return Promise.resolve(all.sort((left, right) => left.name.localeCompare(right.name, 'zh')))
    },
    get(id) {
      return Promise.resolve(table.get(id))
    },
    async add(input) {
      if (table.get(input.id) !== undefined) {
        throw new Error(`演员池里已经有 "${input.id}" 了——换一个 id，或者用 action="note" 给他记一条。`)
      }
      const actor: Actor = { id: input.id, name: input.name, style: input.style, notes: [] }
      await table.put(input.id, actor)
      return actor
    },
    note(id, text) {
      if (table.get(id) === undefined) {
        throw new Error(`演员池里没有 "${id}"。先 action="list" 看看都有谁。`)
      }
      // 追加走域的写队列（`update`），不是自己 `get` 完再 `put`：那样连着记两条会丢一条。
      // 新的在前——brief 里只带最近几条，上一局的事才是这一局用得上的。
      return table.update(id, current => ({ ...current, notes: [text, ...current.notes] }))
    },
    setStyle(id, style) {
      if (table.get(id) === undefined) {
        throw new Error(`演员池里没有 "${id}"。先 action="list" 看看都有谁。`)
      }
      return table.update(id, current => ({ ...current, style }))
    },
    setAvatar(id, image) {
      if (table.get(id) === undefined) {
        throw new Error(`演员池里没有 "${id}"。先 action="list" 看看都有谁。`)
      }
      return table.update(id, current => {
        if (image !== '') return { ...current, avatar: image }
        // 空串 = 换回按 id 生成的那个：**删掉字段**，而不是存一个空路径。空路径会让界面去
        // 加载一张不存在的图，而"没这个字段"与"有张图"是两件不同的事。
        const { avatar: _dropped, ...withoutAvatar } = current
        return withoutAvatar
      })
    },
  }
}
