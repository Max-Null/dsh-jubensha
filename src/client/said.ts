/**
 * 「谁说了什么」——把会话里一批批收下来的话，投影给房间页读。
 *
 * **为什么要注册一个事件消费者**：房间页要显示"这一轮谁说了什么"，而那句话是**宿主 append
 * 的会话事件**。浏览器半边没有别的口子能读到它——`shell.overlay` 是帧级的、`conversation.view`
 * 的 owner props 里没有消息。所以唯一的办法是注册一个 `ConversationNodeDefinition`，把事件折成
 * 投影，再从座位里读投影。
 *
 * **投影的 key 就是 `kind`**（`'jubensha-said'`）——读它时用同一个名字，没有单独的注册步骤。
 *
 * **`visibility: 'hidden'`**：投影进得来、对话流里不出现。房间页有自己的渲染，不必在对话流里
 * 再插一行。
 *
 * **match `agent/inbox/spliced`**：它的 `data.inserted[]` 就是一批完整消息，所以不必去拼
 * `user/message`。而 `source.kind` 是分辨"谁说的"那个字段——真人是 `user`，注入是
 * `runtime-context` / `skill-catalog` / `time-context`，别的插件是 `plugin:<名字>`。
 *
 * @module @max-null/dsh-jubensha/client/said
 */
import type { ConversationNodeDefinition } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { ChatNode } from '@deepseek-ai/dsh-client-ui-chat/client'

/** 投影的名字。读它时用同一个字符串。 */
export const SAID_KIND = 'jubensha-said'

/** 一句话。 */
export interface SaidLine {
  /** 它来自哪个事件——排序与去重都用它。 */
  readonly seq: number
  /** 谁说的（`source.kind`）。 */
  readonly from: string
  /** 正文。 */
  readonly text: string
}

/** 一次 splice 收下来的那一批。 */
export interface SaidBatch {
  /** 事件序号。 */
  readonly seq: number
  /** 这一批里的话，按进来的顺序。 */
  readonly lines: readonly SaidLine[]
}

declare module '@deepseek-ai/dsh-client-ui-chat/client' {
  interface ChatNodeDataMap {
    /** 房间页右栏读的就是它。 */
    'jubensha-said': SaidBatch
  }
}

/**
 * 把一条消息的 `content` 拍成一段文字。
 *
 * 它是富结构（`[{ type: 'text', text }]` 起头，还可能有别的东西），而房间页只要一句话。
 * 非文字的部分**不猜**——拍不出来就给空串，让调用方把这条丢掉。
 * @param content - 事件里的 `content` 字段。
 * @returns 拼起来的文字；没有文字内容时给空串。
 */
function textOf(content: unknown): string {
  if (typeof content === 'string') return content.trim()
  if (!Array.isArray(content)) return ''
  const parts: string[] = []
  for (const item of content) {
    if (typeof item === 'string') {
      parts.push(item)
      continue
    }
    if (typeof item !== 'object' || item === null) continue
    const one = item as { type?: unknown, text?: unknown }
    if (one.type === 'text' && typeof one.text === 'string') parts.push(one.text)
  }
  return parts.join('\n').trim()
}

/**
 * 「谁说了什么」的投影定义。
 *
 * 每个 splice 一条 node（id 用事件序号），所以 `update` 直接回 `context.state` 就够——同一个
 * splice 不会被折叠第二次。
 */
export const saidDefinition: ConversationNodeDefinition<SaidBatch> = {
  kind: SAID_KIND,
  target: 'chat',
  match: event => event.type === 'agent/inbox/spliced'
    ? { id: String(event.seq), role: 'start' }
    : null,
  start: (_context, match) => {
    const event = match.event
    if (event.type !== 'agent/inbox/spliced') {
      throw new Error('jubensha-said: start requires agent/inbox/spliced')
    }
    const data = event.data as { inserted?: unknown }
    const inserted = Array.isArray(data.inserted) ? data.inserted : []
    const lines: SaidLine[] = []
    for (const item of inserted) {
      if (typeof item !== 'object' || item === null) continue
      const one = item as { content?: unknown, source?: { kind?: unknown } }
      const text = textOf(one.content)
      // 没有正文的丢掉：注入里有一大堆空的、或者只有工具调用的，它们不是"谁说了什么"。
      if (text === '') continue
      lines.push({
        seq: event.seq,
        from: typeof one.source?.kind === 'string' ? one.source.kind : '(没有来源)',
        text,
      })
    }
    return { seq: event.seq, lines }
  },
  update: context => context.state,
  buildViewNode: (context) => {
    const start = context.start ?? context.matches[0]
    if (start === undefined || context.state === undefined) return null
    return {
      key: context.key,
      kind: SAID_KIND,
      id: context.id,
      target: 'chat',
      anchorSeq: start.event.seq,
      location: start.location,
      // 投影进得来，对话流里不出现——房间页有自己的渲染，不必在那儿多一行。
      visibility: 'hidden',
      data: context.state,
    } satisfies ChatNode<typeof SAID_KIND>
  },
}
