/**
 * 把「选好的阵容」写成一段话，交给主持人。
 *
 * **为什么是生成一段文本，而不是面板自己去调工具**：设计方案 §5 拍板记录第 4 条把界面定为
 * **附加层**——宿主侧的工具与状态机不得依赖客户端存在。面板一旦会发号施令，它就从「另一块屏」
 * 变成了「第二条控制通道」，而那条约束是靠**面板只产出文本**守住的，不是靠自觉。
 *
 * 顺带解决一件小事：用户不必去记 `jubensha_player` 的参数长什么样。
 *
 * 这是个零依赖的纯函数，所以浏览器半边引得起，也测得了。
 *
 * @module @max-null/dsh-jubensha/instruction
 */
import type { RoomCase } from './room-types.ts'

/** 排好的一个位子。 */
export interface SeatAssignment {
  /** 座位 id。 */
  readonly seat: string
  /** 这个位子演谁。 */
  readonly roleName: string
  /** 谁来演——演员池里的 id。 */
  readonly actorId: string
  /** 演员的名字，写给人看的那一份。 */
  readonly actorName: string
}

/**
 * 写一段交给主持人的开局指令。
 *
 * 它**不替主持人决定**：角色本怎么取、上桌顺序、开局第一句说什么，都留着。这里给的是
 * 那一局的骨架——本子在哪、谁坐哪、谁演谁——剩下的按本子与人的现场判断来。
 * @param entry - 选中的本子。
 * @param assignment - 排好的座位；只含 AI 位子，真人位子不在这里（它是你自己）。
 * @returns 一段可以直接粘进对话的文本。
 */
export function openingInstruction(entry: RoomCase, assignment: readonly SeatAssignment[]): string {
  const seats = entry.roles.map(role => role.id)
  const human = entry.roles.filter(role => role.player === 'human').map(role => role.id)
  const lines = [
    `开一局《${entry.title}》（case ${entry.id}）。`,
    '',
    '① 取本子（先 load，它会顺带报出格式问题）：',
    `   jubensha_case —— action="load", dir="${entry.path}"`,
    '',
    '② 开局：',
    `   jubensha_state —— action="start", caseId="${entry.id}", title="${entry.title}", `
      + `seats=${JSON.stringify(seats)}, humanSeat="${human[0] ?? ''}"`,
  ]
  if (assignment.length > 0) {
    lines.push(
      '',
      '③ 让这几位上桌。**一座一份**：用 jubensha_case action="book" 取到的是那个座位的引用，'
        + '原样填进 roleBook，别转述、别换座位；actor 是他跨局的身份：',
    )
    for (const one of assignment) {
      lines.push(`   ${one.seat} ${one.roleName} → actor="${one.actorId}"（${one.actorName}）`)
    }
  }
  lines.push('', '剩下的按本子来——开局第一句、节奏、什么时候该搜证，你比我清楚。')
  return lines.join('\n')
}
