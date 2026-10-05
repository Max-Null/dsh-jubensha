/**
 * 插件自带的示例本子 —— 列出 `cases/` 下有哪些本子可选。
 *
 * **只列表头，不返回全文**：面板要的是「有哪些可选」（编号、名字、类型、几个座位），
 * 而全文等真开那一局时由 `jubensha_case` 取。把四本本子的全文塞进一个每次打开面板都要拉的
 * 快照里，是白花流量。
 *
 * **目录按 `import.meta.url` 定位**：构建产物在 `lib/`，往上退一级就是包根，而 `cases/`
 * 在那儿（`files` 里带着）。dev 环境整个包是指回源码的 junction，所以同一行代码在两边都对。
 *
 * 坏本子**不会让列表整个失败**：一个本子解析不了就跳过它，并在条目里留一句为什么——
 * 面板上少一行，好过整张表打不开。
 *
 * @module @max-null/dsh-jubensha/cases
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadCase, sceneRelations } from './case.ts'
import type { RoomCase } from './room-types.ts'

/**
 * 这个形状就是面板读的那个（`room-types.ts` 里的 `RoomCase`），不另立一个同形接口——
 * 两边各写一份必然有一天漂开，而漂开的表现是面板上某个字段空着，不报错。
 */
export type CaseEntry = RoomCase

/**
 * 包根下的 `cases/`。
 *
 * 导出它是为了让 `jubensha_case` 能把「手打的相对路径」也认下来：`cases/04-三支药/case.yml`
 * 看上去就该相对这一份，而进程的工作目录其实是 profile 目录（2026-10-06 实测 ENOENT 落到
 * `profiles/ssid-dev/` 下面，把一次开局卡住了）。
 * @returns 插件自带本子的根目录。
 */
export function casesRoot(): string {
  return join(dirname(fileURLToPath(import.meta.url)), '..', 'cases')
}

/**
 * 列出能选的本子，按编号排序。
 *
 * 两个来源扫的是同一套逻辑，只是根不同：**插件自带的那份**（随包发，永远在）与**用户指的
 * 那几个目录**（见 `case-dirs.ts`）。同一个本子被两个目录都扫到时只留一份——按 id 判，
 * 那是它的身份。
 *
 * 读不到的、解析不了的都跳过——「这儿多一行少一行」不值得让整张表失败。
 * @param extraDirs - 额外要扫的目录；默认没有。
 * @returns 本子列表；一个目录都读不到时给空数组。
 */
export function listCases(extraDirs: readonly string[] = []): readonly CaseEntry[] {
  const found: CaseEntry[] = []
  const seen = new Set<string>()
  for (const root of [casesRoot(), ...extraDirs]) {
    let entries: string[]
    try {
      entries = readdirSync(root)
    } catch {
      // 这个目录不在（装的时候没带上 cases/，或者用户删了自指的目录）——跳过它，
      // 继续扫下一个。一个目录读不到不该让整张表空掉。
      continue
    }
    for (const entry of entries) {
      const file = join(root, entry, 'case.yml')
      try {
        if (!statSync(file).isFile()) continue
        const loaded = loadCase(readFileSync(file, 'utf8'))
        if (seen.has(loaded.id)) continue
        seen.add(loaded.id)
        found.push({
          id: loaded.id,
          title: loaded.title,
          genre: loaded.genre,
          seats: loaded.roles.length,
          humanSeats: loaded.roles.filter(role => role.player === 'human').length,
          path: file,
          roles: loaded.roles.map(role => ({
            id: role.id,
            name: role.name,
            player: role.player,
            public: role.publicIdentity,
          })),
          relations: sceneRelations(loaded).map(one => ({ ...one })),
        })
      } catch {
        // 坏本子跳过。`loadCase` 已经会为格式问题抛 `CaseFormatError`，
        // 而"面板上少一行"是这里唯一合适的处置——它不是个该让人修到能跑的错误。
        continue
      }
    }
  }
  return found.sort((left, right) => left.id.localeCompare(right.id))
}
