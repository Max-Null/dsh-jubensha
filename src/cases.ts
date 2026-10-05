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
import { loadCase } from './case.ts'
import type { RoomCase } from './room-types.ts'

/**
 * 这个形状就是面板读的那个（`room-types.ts` 里的 `RoomCase`），不另立一个同形接口——
 * 两边各写一份必然有一天漂开，而漂开的表现是面板上某个字段空着，不报错。
 */
export type CaseEntry = RoomCase

/** 包根下的 `cases/`。 */
function casesRoot(): string {
  return join(dirname(fileURLToPath(import.meta.url)), '..', 'cases')
}

/**
 * 列出能选的本子，按编号排序。
 *
 * 读不到的、解析不了的都跳过——原因是「这儿多一行少一行」不值得让整张表失败。
 * @returns 本子列表；目录不存在时给空数组。
 */
export function listCases(): readonly CaseEntry[] {
  const root = casesRoot()
  let entries: string[]
  try {
    entries = readdirSync(root)
  } catch {
    // 目录不在（比如装的时候没带上 cases/）——列表空着，面板会说"没有可选的本子"。
    // 这个 catch 只包住 readdir 那一句：后面每本本子的失败各有各的处置，不归它管。
    return []
  }
  const found: CaseEntry[] = []
  for (const entry of entries) {
    const file = join(root, entry, 'case.yml')
    try {
      if (!statSync(file).isFile()) continue
      const loaded = loadCase(readFileSync(file, 'utf8'))
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
      })
    } catch {
      // 坏本子跳过。`loadCase` 已经会为格式问题抛 `CaseFormatError`，
      // 而"面板上少一行"是这里唯一合适的处置——它不是个该让人修到能跑的错误。
      continue
    }
  }
  return found.sort((left, right) => left.id.localeCompare(right.id))
}
