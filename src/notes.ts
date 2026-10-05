/**
 * 便签 —— 在房间页任意位置留的备忘，**按会话分**。
 *
 * 与演员池的区别就在这个「按会话」上：演员跟着**人**走（换台机器、换工作区，坐下来的还是
 * 同一批），便签跟着**这一局**走——它是你给这一局做的批注，下一局不该看见上一局的。
 * 所以存储根一样（`$DSH_HOME/storages`，见 `actorRoot`），但 key 是 sessionId。
 *
 * **便签不进对话、不进模型上下文**：它是给自己看的，不是发言。
 *
 * 存放处**不是浏览器**：便签要跟着会话活，而浏览器那一侧切走就没了。这也正是它需要一个
 * 宿主侧端点、而不像面板的排座那样只用组件状态的原因。
 *
 * @module @max-null/dsh-jubensha/notes
 */
import { z } from 'zod'
import { defineDomain, domainTable, DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import { JsonStorageBackend } from '@deepseek-ai/dsh-storage-json'
import type { Context } from '@deepseek-ai/cordis'
import { actorRoot } from './actor.ts'

/** 一张便签。 */
export interface Note {
  /** 便签 id。 */
  readonly id: string
  /** 序号，自增、删了不回收——它是给人「引用」用的（「便签 3 那条」）。 */
  readonly seq: number
  /** 颜色名。 */
  readonly color: string
  /** 写的什么。 */
  readonly text: string
  /** 相对标签页容器的横坐标。 */
  readonly x: number
  /** 相对标签页容器的纵坐标。 */
  readonly y: number
}

/** 一个会话的那块便签板。 */
export interface NoteBoard {
  /** 下一个序号。删掉的号不回收，所以它只增不减。 */
  readonly seq: number
  /** 板上的便签。 */
  readonly notes: readonly Note[]
}

/** 改一张便签时能改的东西——传哪几项就改哪几项。 */
export interface NotePatch {
  /** 换色。 */
  readonly color?: string
  /** 改文字。 */
  readonly text?: string
  /** 挪位置。 */
  readonly x?: number
  /** 挪位置。 */
  readonly y?: number
}

/** 便签板要能干的事。 */
export interface NotePool {
  /**
   * 取某个会话的板子。没有就给一块空的——「没有便签」与「查不到」对界面是一回事。
   * @param sessionId - 哪个会话。
   * @returns 那个会话的便签板。
   */
  board(sessionId: string): NoteBoard
  /**
   * 留一张新的。
   * @param sessionId - 哪个会话。
   * @param input - 颜色、文字与位置。
   * @returns 新便签（带上分给它的序号）。
   */
  add(sessionId: string, input: { color: string; text: string; x: number; y: number }): Promise<Note>
  /**
   * 改一张。传哪几项就改哪几项。
   * @param sessionId - 哪个会话。
   * @param id - 便签 id。
   * @param patch - 要改的字段。
   * @returns 改完的便签。
   */
  edit(sessionId: string, id: string, patch: NotePatch): Promise<Note>
  /**
   * 撕掉一张。序号**不回收**——下一张接着编。
   * @param sessionId - 哪个会话。
   * @param id - 便签 id。
   * @returns 被撕掉的 id。
   */
  remove(sessionId: string, id: string): Promise<string>
}

/** 存进域里的一张便签。 */
const storedNoteSchema = z.object({
  id: z.string(),
  seq: z.number().int().positive(),
  color: z.string(),
  text: z.string(),
  x: z.number(),
  y: z.number(),
})

/** 存进域里的一块板子。 */
const storedBoardSchema = z.object({
  seq: z.number().int().nonnegative(),
  notes: z.array(storedNoteSchema),
})

/**
 * 便签域。
 *
 * 与演员池**同一个 backend 根目录、另一个域**：它们的生命周期不同（一个跟人走、一个跟会话走），
 * 混在一张表里会让"清掉某个会话"变成一次遍历删除，而分开就是删一个 key。
 */
const notesSpec = defineDomain({
  name: 'jubensha_notes',
  version: 1,
  tables: { boards: domainTable<string, NoteBoard>(storedBoardSchema) },
})

/** 一块空板子。 */
function emptyBoard(): NoteBoard {
  return { seq: 0, notes: [] }
}

/**
 * 打开便签池。
 *
 * `register` 对重名抛 `duplicate-backend`，所以 backend **只注册一次**：域名固定为
 * `jubensha_notes`，同进程重复打开会撞上它。调用方拿单例（`index.ts` 的 `requireNotes`）。
 * @param ctx - 插件上下文，用来取 storage 服务。
 * @returns 打开的便签池。
 */
export async function openNotePool(ctx: Context): Promise<NotePool> {
  ctx.storage.backend.register('jubensha_notes', new JsonStorageBackend(actorRoot()))
  const facility = new DomainFacility(ctx, { backend: 'jubensha_notes', routes: {} })
  const domain = await facility.open(notesSpec)
  const table = domain.table('boards')

  /** 读一块板子；没有就给空的。`KvTable` 的读是同步的。 */
  const read = (sessionId: string): NoteBoard => table.get(sessionId) ?? emptyBoard()

  /**
   * 确保这个会话有一块板子。
   *
   * `KvTable.update` **要求 key 已经存在**——实测不存在时抛
   * `domain 'jubensha_notes' table 'boards' has no record '…' to update`，而「这个会话还没
   * 留过便签」是最正常不过的状态（第一次留之前，它就是没有）。所以每个写动作前先垫一块空的。
   *
   * 用 `get` 判而不是无条件 `put`：无条件 put 会把已有便签的板子整个清掉。
   * @param sessionId - 哪个会话。
   */
  const ensure = async (sessionId: string): Promise<void> => {
    if (table.get(sessionId) === undefined) await table.put(sessionId, emptyBoard())
  }

  return {
    board(sessionId) {
      // 回一份浅拷贝：调用方（端点）会把它塞进 JSON 响应，不该拿到域里的活引用。
      const board = read(sessionId)
      return { seq: board.seq, notes: board.notes.map(note => ({ ...note })) }
    },
    async add(sessionId, input) {
      await ensure(sessionId)
      // 序号从板子上那份计数器来，`update` 在域的写队列里跑，所以两个便签同时建也不会撞号。
      let created: Note | undefined
      await table.update(sessionId, (current) => {
        const board = current ?? emptyBoard()
        const seq = board.seq + 1
        created = { id: `n${seq}`, seq, color: input.color, text: input.text, x: input.x, y: input.y }
        return { seq, notes: [...board.notes, created] }
      })
      // `created` 在 update 的回调里赋值；回调一定跑过，所以这里不会是 undefined——
      // 但类型上要收窄，收不了就说明 update 没调回调，那是个真 bug，该炸出来。
      if (created === undefined) throw new Error('便签没建起来——写回调没跑。')
      return created
    },
    async edit(sessionId, id, patch) {
      await ensure(sessionId)
      let updated: Note | undefined
      await table.update(sessionId, (current) => {
        const board = current ?? emptyBoard()
        const notes = board.notes.map((note) => {
          if (note.id !== id) return note
          // 只覆盖传了的字段：`undefined` 表示"这次不动它"，而不是"把它清成空"。
          const next: Note = {
            id: note.id,
            seq: note.seq,
            color: patch.color ?? note.color,
            text: patch.text ?? note.text,
            x: patch.x ?? note.x,
            y: patch.y ?? note.y,
          }
          updated = next
          return next
        })
        return { seq: board.seq, notes }
      })
      if (updated === undefined) throw new Error(`这块板上没有便签 "${id}"。`)
      return updated
    },
    async remove(sessionId, id) {
      await ensure(sessionId)
      let found = false
      await table.update(sessionId, (current) => {
        const board = current ?? emptyBoard()
        const notes = board.notes.filter((note) => {
          if (note.id === id) found = true
          return note.id !== id
        })
        // `seq` 原样带下去：删掉的号不回收，下一张接着编。
        return { seq: board.seq, notes }
      })
      if (!found) throw new Error(`这块板上没有便签 "${id}"。`)
      return id
    },
  }
}
