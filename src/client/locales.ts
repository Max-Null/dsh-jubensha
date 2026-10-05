/**
 * 房间面板的文案。
 *
 * **为什么文案不写在组件里**：DSH 客户端有一条硬约定——每一个产品可见的字符串都必须来自
 * typed 字典，经 `t` 座位到达组件。这条不是形式主义：文案集中在一处才可能被翻译、被统一，
 * 散在 JSX 里的字符串则两样都做不到。命名空间键在 `index.tsx` 里用声明合并登记。
 *
 * @module @max-null/dsh-jubensha/client/locales
 */

/** 中文文案。 */
export const zh = {
  // 会话视图那个标签。**这个名字是要紧的**：它得与「对话 / 轨迹 / 上下文」并列而不显眼，
  // 而它显示的是这一局剧本杀——伪装性是刻意的（见 index.tsx 的模块注释）。
  'view.team': '团队',
  'room.phase': '阶段',
  'room.round': '第几轮',
  'room.seats': '桌上的位子',
  'room.actors': '演员',
  'room.cases': '可选的本子',
  'room.noCases': '没找到本子。本子放在插件的 cases/ 目录下，一个本子一个 case.yml。',
  'room.copy': '复制开局指令',
  'room.copied': '已复制',
  'room.pickActor': '（挑一个演员）',
  'room.human': '你',
  'room.empty': '还没开局。在对话里让主持人开一局，这里就会显示局面。',
  'room.hint': '这里是只读的，会跟着对话走——开一局、推进阶段、发线索都在对话里说。',
}

/** English copy. */
export const en = {
  'view.team': 'Team',
  'room.phase': 'Phase',
  'room.round': 'Round',
  'room.seats': 'Seats',
  'room.actors': 'Cast',
  'room.cases': 'Cases',
  'room.noCases': 'No cases found. They live under the plugin\'s cases/ directory, one case.yml each.',
  'room.copy': 'Copy the opening instruction',
  'room.copied': 'Copied',
  'room.pickActor': '(pick an actor)',
  'room.human': 'you',
  'room.empty': 'No game yet. Ask the host in the conversation to start one, and the table shows up here.',
  'room.hint': 'Read-only, and it follows the conversation — starting a game, advancing phases and dealing clues all happen in the chat.',
}
