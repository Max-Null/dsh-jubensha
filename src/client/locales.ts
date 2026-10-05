/**
 * 房间页的文案。
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

  // 五个阶段。顶栏那一排与中栏那几页共用这一组名字。
  'phase.self-intro': '自述',
  'phase.inquiry': '问话',
  'phase.search': '搜证',
  'phase.final': '发言投票',
  'phase.reveal': '复盘',

  // 左栏
  'left.table': '这一桌',
  'left.relations': '人物关系',
  'left.timeline': '时间线 · 你们说过的',
  'left.you': '你',
  'left.notSeated': '还没上桌',
  'left.nothingSaid': '其余时段还没有人交代',

  // 中栏
  'mid.script': '剧本正文',
  'mid.scriptHint': '（点这儿收起回看）',
  'mid.clues': '线索',
  'mid.cases': '可选的本子',
  'mid.clueSealed': '（还没发到桌上）',
  'mid.noGame': '还没开局。在对话里让主持人开一局，这里就会显示局面。',

  // 右栏
  'right.said': '桌上说了什么',
  'right.composer': '说话在下面那个输入框里——它就是对话页那一个，两种形态共用同一局。',
  'right.pending': '这一栏的消息流还没接上：它要从会话里读，而那条路还在选（conversation node 还是 useSession）。',

  // 阶段页各自的抬头与引导
  'intro.title': '逐个上桌',
  'intro.lead': '每个玩家从「我昨晚的经历」开始说。主持人一个个请他们上桌。',
  'inquiry.title': '问话',
  'inquiry.lead': '你可以问任何一个人任何问题，没有「不许问」的。',
  'search.title': '搜证',
  'search.lead': '主持人一次性把线索发到桌上。要指着哪条问，点「引用到对话」把它带进输入框。',
  'final.title': '发言与投票',
  'final.lead': '每人说一次「我怀疑谁、为什么」，然后投票。直接说就行。',
  'reveal.title': '复盘',
  'reveal.lead': '投票一结束就复盘：真相、时间线、以及三个「其实不是」。',
  'saidSoFar': '说过的',
  'notYet': '还没说',

  // 便签
  'note.add': '留一张便签',
  'note.placeholder': '写点什么……',
  'note.remove': '撕掉',
  'note.made': '便签加好了——点它就能改',

  // 通用
  'common.cancel': '算了',
  'common.loading': '载入中……',
}

/** English copy. */
export const en = {
  'view.team': 'Team',

  'phase.self-intro': 'Intros',
  'phase.inquiry': 'Questions',
  'phase.search': 'Search',
  'phase.final': 'Vote',
  'phase.reveal': 'Reveal',

  'left.table': 'At the table',
  'left.relations': 'Relations',
  'left.timeline': 'Timeline · what they said',
  'left.you': 'you',
  'left.notSeated': 'not seated',
  'left.nothingSaid': 'the rest of the night is still unaccounted for',

  'mid.script': 'Your script',
  'mid.scriptHint': '(click to collapse)',
  'mid.clues': 'Clues',
  'mid.cases': 'Cases',
  'mid.clueSealed': '(not dealt yet)',
  'mid.noGame': 'No game yet. Ask the host in the conversation to start one, and the table shows up here.',

  'right.said': 'What was said',
  'right.composer': 'You speak in the composer below — the same one the conversation page uses. Both share one game.',
  'right.pending': 'The feed here is not wired up yet: it has to read from the session, and that route is still being chosen (conversation node vs useSession).',

  'intro.title': 'Taking seats',
  'intro.lead': 'Each player starts with what they did last night. The host brings them to the table one by one.',
  'inquiry.title': 'Questions',
  'inquiry.lead': 'You can ask anyone anything there is no off-limits question.',
  'search.title': 'Search',
  'search.lead': 'The host deals the clues all at once. To point at one, use "quote to conversation" to carry it into the composer.',
  'final.title': 'Statements and vote',
  'final.lead': 'Everyone says who they suspect and why, then votes. Just say it.',
  'reveal.title': 'Reveal',
  'reveal.lead': 'The reveal starts the moment the vote ends: the truth, the night, and the three "it was not".',
  'saidSoFar': 'said',
  'notYet': 'not yet',

  'note.add': 'Leave a note',
  'note.placeholder': 'Write something…',
  'note.remove': 'Tear it off',
  'note.made': 'Note added — click it to edit',

  'common.cancel': 'Cancel',
  'common.loading': 'Loading…',
}
