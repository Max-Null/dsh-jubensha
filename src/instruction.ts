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
    `开一局《${entry.title}》（case ${entry.id}）——**这一局要用团队模式**。`,
    '',
    '（第 ③ 步要让几位 AI 玩家上桌，而那是靠 team 的 spawn_teammate 创建的；DSH 默认不开团队，',
    '  所以要在这条消息里说清。少了这句，前两步会照常成功，第三步却报「这个部署里没有',
    '  agent-team 服务」——那看着像插件坏了，其实只差这一句。）',
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
      '③ 让这几位上桌（这一步是唯一需要团队模式的）。**一座一份**：用 jubensha_case '
        + 'action="book" 取到的是那个座位的引用，原样填进 roleBook，别转述、别换座位；'
        + 'actor 是他跨局的身份：',
    )
    for (const one of assignment) {
      lines.push(`   ${one.seat} ${one.roleName} → actor="${one.actorId}"（${one.actorName}）`)
    }
  }
  lines.push(
    '',
    '**真人那个位子（humanSeat）要等他。** 他不是 AI 玩家：把话头交给他就停下，不要替他发言，'
      + '也不要在他开口之前推进阶段。AI 玩家之间可以互相问、可以说个不停——而每一步什么时候'
      + '往下走，由真人决定。' +
      '（一条真事：少了这句，DM 会把四个阶段一口气推完、一次都不叫真人——那一局就变成 AI '
      + '自己演给自己看了，2026-10-06 用户报的。）',
    '',
    '**每个阶段都给他留一次话头，而且别把选项替他排好。** 一个阶段推到后半程才问他，他前面已经'
      + '插不进去了——他会觉得是「三个 AI 掐起来了，跟我没关系」。问题要具体到他能直接答'
      + '（「你那半小时在哪儿」好过「你想说什么」），而**不要替他做选择**：给他 A／B／C 三选一'
      + '、还标上哪个好，等于你替他把这一轮玩完了（用户原话：「作为 DM 的主 agent 给我都推荐完了，'
      + '我都没说话」）。问他、然后停下来听。',
    '',
    '**听到行踪就顺手记一笔**（`jubensha_state action="timeline"`）：某人说「我十点半走的」，'
      + '你就记一条 `{at:"22:30", seat:"p2", doing:"从正门离开"}`——房间页左栏那一栏读它，'
      + '而那一栏是玩家用来发现「谁在回避自己那段时间」的。**一条只记一件事**，照他说的记，'
      + '别替他补、也别替他圆；时刻一律转成 24 小时制，中文钟点排不了序。',
    '',
    '**一次只把话头交给一个人，他说完你就停。** 别把三个人的话一口气推完——停下来的时候，'
      + '真人才能插进来（用户原话：「我似乎不太方便插话？除非他们讨论完」）。\n'
      + '**注意这不是回合制**：剧本杀本来就没有轮次上限，只有自我介绍按顺序。所以不必造一个'
      + '轮流发言的框，只要**别连着替三个人说话**——一个人说完，停一下，看真人接不接；'
      + '他不接，你再叫下一个。',
    '',
    '**自述阶段第一个就是他，别跳过去。** 座位顺序里 `p0` 是真人，而「一个个请他们上桌」'
      + '天然从他开始——先叫他说完，再叫 AI 玩家（用户报过：三个 AI 先聊起来了，而他的板子上'
      + '还写着「还没上桌」）。叫他的方式就是把话头交出去然后停：你不需要、也不该替他说。',
  )
  lines.push('', '剩下的按本子来——开局第一句、节奏、什么时候该搜证，你比我清楚。')
  return lines.join('\n')
}
