/**
 * 房间快照的形状 —— 两半共用的那一份契约。
 *
 * **为什么单独一个文件**：宿主半边（`room.ts`）产生它、浏览器半边（`client/`）消费它，
 * 而两边各有各的依赖约束——`room.ts` 要 import cordis，浏览器半边的打包有一道纯度门，
 * 会拒掉任何 `@deepseek-ai/*` 的导入（类型导入也不例外，那道门看的是模块解析而不是擦除后
 * 的结果）。形状放在这个零依赖的文件里，两边都引得起，而且契约只有一处。
 *
 * 与 `avatar.ts` 同一个理由，也是同一个手法。
 *
 * @module @max-null/dsh-jubensha/room-types
 */

/** 死者。 */
export interface RoomVictim {
  /** 名字。 */
  readonly name: string
  /** 年龄。 */
  readonly age: number
  /** 怎么死的。 */
  readonly cause: string
  /** 法医给的死亡时间窗。 */
  readonly timeWindow: readonly string[]
}

/**
 * 一条线索，以及它**发到桌上没有**。
 *
 * 未发的那条也带着全文——**这不是泄漏**：DM 已经读过它了，而这一栏不给玩家的眼睛加锁
 * （他本来就能在对话里问）。`dealt` 是给界面用的：未发的显示成背面，那一眼就是「还差几条」。
 */
export interface RoomClue {
  /** 线索 id。 */
  readonly id: string
  /** 标题。 */
  readonly title: string
  /** 原文——发到桌上时给的那一段。 */
  readonly text: string
  /** 已经发到桌上了吗。 */
  readonly dealt: boolean
}

/** 面板要显示的一局。 */
export interface RoomGame {
  /** 本子编号。 */
  readonly caseId: string
  /** 本子名。 */
  readonly title: string
  /** 桌上的位子。 */
  readonly seats: readonly string[]
  /** 真人占的位子。 */
  readonly humanSeat: string
  /** 现在到哪个阶段。 */
  readonly phase: string
  /** 第几轮。 */
  readonly round: number
  /** 已经发到桌上的线索 id。 */
  readonly revealedClues: readonly string[]
  /** 是不是已经到复盘了。 */
  readonly finished: boolean
  /** 死者；本子没写全时为 `null`。 */
  readonly victim: RoomVictim | null
  /** 本子的线索，带「发了没有」。 */
  readonly clues: readonly RoomClue[]
  /** 真人那位拿到的角色本正文——**回看用**，与开局时发给他的那份是同一份。 */
  readonly script: string
}

/** 桌上的一位 AI 玩家。 */
export interface RoomPlayer {
  /** 座位 id。 */
  readonly seat: string
  /** 角色名。 */
  readonly name: string
}

/** 演员池里的一位。 */
export interface RoomActor {
  /** 演员 id。 */
  readonly id: string
  /** 人看的名字。 */
  readonly name: string
  /** 他怎么玩。 */
  readonly style: string
  /** 跨局印象（新的在前）。 */
  readonly notes: readonly string[]
  /** 头像图片；没配时面板按 id 生成一个。 */
  readonly avatar?: string
}

/** 本子里的一个位子。 */
export interface RoomCaseRole {
  /** 座位 id。 */
  readonly id: string
  /** 这个位子演谁。 */
  readonly name: string
  /** 归真人还是 AI。 */
  readonly player: 'human' | 'ai'
  /**
   * 这个人摆在明面上的身份——左栏列人时显示的就是它。
   *
   * 它**不是秘密**：秘密在角色本里（本子的 `roles[].private`），而这一句是开局就说给全桌的。
   */
  readonly public: string
}

/** 一条人物关系——关系图上的那根线。 */
export interface RoomCaseRelation {
  /** 从谁。写的是**名字**：图上除了角色还有死者，而死者没有座位号。 */
  readonly from: string
  /** 到谁。 */
  readonly to: string
  /** 什么关系，一句话。 */
  readonly label: string
}

/** 一个能选的本子。 */
export interface RoomCase {
  /** 本子编号。 */
  readonly id: string
  /** 本子名。 */
  readonly title: string
  /** 类型：`deduction` / `drama` / … */
  readonly genre: string
  /** 一共有几个座位。 */
  readonly seats: number
  /** 真人占几个位子。 */
  readonly humanSeats: number
  /** 那份 `case.yml` 的绝对路径——开一局时把它交给 `jubensha_case`。 */
  readonly path: string
  /** 每个位子演谁——布置面板按它排座，也按它算要几个 AI 玩家。 */
  readonly roles: readonly RoomCaseRole[]
  /** 人物关系（关系图的线）。本子没写时是空的。 */
  readonly relations: readonly RoomCaseRelation[]
}

/**
 * 一张便签。
 *
 * 形状与 `notes.ts` 的 `Note` 一致——这里再写一遍是因为那个文件 import 了 zod 与 storage，
 * 而浏览器半边引不起它们（打包的纯度门会拒掉 `@deepseek-ai/*`，类型导入也不例外）。
 * 同一个理由下 `room-types.ts` 这个文件本身就是零依赖的。
 */
export interface RoomNote {
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

/** 面板读的那一份快照。 */
export interface RoomSnapshot {
  /** 当前这一局；还没开局时为 `null`。 */
  readonly game: RoomGame | null
  /** 桌上的 AI 玩家。 */
  readonly players: readonly RoomPlayer[]
  /** 演员池。 */
  readonly actors: readonly RoomActor[]
  /** 能选的本子。 */
  readonly cases: readonly RoomCase[]
  /** 这个会话的便签。 */
  readonly notes: readonly RoomNote[]
}
