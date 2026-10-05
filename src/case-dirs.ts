/**
 * 本子目录 —— 除了插件自带的那份，还能去哪儿找本子。
 *
 * **为什么它要存在**：`cases/` 里那三本是随包发的，而用户自己的本子放哪儿是他自己的事。
 * 没有这一层，面板上永远只有那三本可选——**而「创意工坊」那篇预研里说的"拷进目录就出现在
 * 面板上"，前提是面板知道要扫哪个目录**。
 *
 * 它和演员池、便签的关系：同一个存储根（`$DSH_HOME/storages`），第三个域。三者的生命周期
 * 各不相同——演员跟**人**走（换工作区还是同一批）、便签跟**会话**走、而这一份是**这台机器
 * 上的这个人**的一小份配置。
 *
 * @module @max-null/dsh-jubensha/case-dirs
 */
import { z } from 'zod'
import { defineDomain, domainTable, DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import { JsonStorageBackend } from '@deepseek-ai/dsh-storage-json'
import type { Context } from '@deepseek-ai/cordis'
import { actorRoot } from './actor.ts'

/** 那份配置存在哪个 key 下。只有一个 key——这里存的是"一组目录"，不是一张表。 */
const KEY = 'cases'

/** 存进域里的形状。 */
const storedSchema = z.object({
  dirs: z.array(z.string()),
})

/** 本子目录这份配置要能干的事。 */
export interface CaseDirPool {
  /**
   * 现在要扫哪些额外目录。
   * @returns 目录列表；没配过时给空数组。
   */
  list(): readonly string[]
  /**
   * 加一个目录。已经有的再加一次是**幂等**的——那不是错，用户点了两下。
   * @param dir - 目录的绝对路径。
   * @returns 加完之后的整份列表。
   */
  add(dir: string): Promise<readonly string[]>
  /**
   * 去掉一个目录。
   * @param dir - 目录的绝对路径。
   * @returns 去掉之后的整份列表。
   */
  remove(dir: string): Promise<readonly string[]>
}

/** 本子目录域。 */
const dirsSpec = defineDomain({
  name: 'jubensha_case_dirs',
  version: 1,
  tables: { config: domainTable<string, { dirs: string[] }>(storedSchema) },
})

/**
 * 打开本子目录配置。
 *
 * 与另外两个域同一套手法：backend 只注册一次（域名固定），调用方拿单例。
 * @param ctx - 插件上下文，用来取 storage 服务。
 * @returns 打开的配置池。
 */
export async function openCaseDirPool(ctx: Context): Promise<CaseDirPool> {
  ctx.storage.backend.register('jubensha_case_dirs', new JsonStorageBackend(actorRoot()))
  const facility = new DomainFacility(ctx, { backend: 'jubensha_case_dirs', routes: {} })
  const domain = await facility.open(dirsSpec)
  const table = domain.table('config')

  /**
   * 确保有一条记录。
   *
   * `KvTable.update` 要求 key 已经存在（实测不存在时抛 `has no record … to update`），而
   * 「还没配过任何目录」是最初的状态。所以写之前先垫一条空的；用 `get` 判，不是无条件 `put`
   * ——后者会把已有的配置清掉。
   */
  const ensure = async (): Promise<void> => {
    if (table.get(KEY) === undefined) await table.put(KEY, { dirs: [] })
  }

  return {
    list() {
      const current = table.get(KEY)
      return current === undefined ? [] : [...current.dirs]
    },
    async add(dir) {
      await ensure()
      const next = await table.update(KEY, current => ({
        // 幂等：已经有了就不重复加。用户点两下不该变成两条。
        dirs: current.dirs.includes(dir) ? current.dirs : [...current.dirs, dir],
      }))
      return [...next.dirs]
    },
    async remove(dir) {
      await ensure()
      const next = await table.update(KEY, current => ({
        dirs: current.dirs.filter(one => one !== dir),
      }))
      return [...next.dirs]
    },
  }
}
