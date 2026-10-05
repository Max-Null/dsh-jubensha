/**
 * 便签层 —— 在房间页任意位置留的备忘。
 *
 * **它挂在标签页容器里**（`position: absolute`，坐标相对容器），所以切到别的标签时它跟着这一页
 * 一起消失，切回来位置不变。这条是靠**挂载点**守住的，不是靠算坐标——挂到 `body` 上再用
 * `fixed`，它的"位置"就成了屏幕上的位置，切走照样飘着。
 *
 * **状态在宿主侧**（按会话存，见 `../notes.ts`）：标签切走时组件会卸载，而便签要活下来。
 * 这也正是它需要端点、而不像排座那样只用组件状态的原因。
 *
 * 便签**不进对话、不进模型上下文**——它给自己看，不是发言。
 *
 * @module @max-null/dsh-jubensha/client/notes
 */
import { useEffect, useState } from 'react'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { RoomNote } from '../room-types.ts'

/** 房间页根节点上的标记——右键落在它里面才算「在房间里留便签」。 */
export const ROOM_ATTR = 'data-jubensha-room'

/** 九色。白底排第一格——它在这套界面里最隐蔽。 */
const FILL: Record<string, string> = {
  white: '#fffefb',
  amber: '#ffe9a8',
  green: '#cdead0',
  blue: '#cfe4f7',
  pink: '#f9d5de',
  violet: '#ded2f5',
  orange: '#ffd9b8',
  teal: '#c3ecea',
  slate: '#dde1e6',
}

/** 拖动时最多到这个频率写一次盘——拖一下几十个 mousemove，一个都写一遍是白费。 */
const DRAG_WRITE_MS = 300

type Locale = PropsLocale<'jubensha'>

/** 便签层的入参。 */
export interface NoteLayerProps extends Locale {
  /** 这个标签属于哪个会话。 */
  sessionId: string
  /** 宿主侧那板便签。 */
  notes: readonly RoomNote[]
  /** 便签变了（加/改/删）之后叫一声，让调用方重新拉快照。 */
  onChanged: () => void
  /** 出错了就说一声——便签写不进去时用户该知道。 */
  onProblem: (message: string) => void
}

/**
 * 往便签端点发一个动作。
 * @param action - `add` / `edit` / `remove`。
 * @param body - 请求体，会被并上 `session`。
 * @returns 端点回的那个值。
 */
async function post(action: string, body: Record<string, unknown>): Promise<unknown> {
  const response = await fetch(`/jubensha/note/${action}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  const parsed = await response.json() as { ok?: boolean, value?: unknown, error?: string }
  if (parsed.ok !== true) throw new Error(parsed.error ?? `HTTP ${response.status}`)
  return parsed.value
}

/**
 * 便签层。
 * @param props - 本地化文案、会话 id、那板便签与两个回调。
 * @returns 便签层；右键弹出的色板也在这一层里。
 */
export function NoteLayer({ t, sessionId, notes, onChanged, onProblem }: NoteLayerProps) {
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)
  const [dragging, setDragging] = useState<string | null>(null)

  const guard = async (work: () => Promise<unknown>): Promise<void> => {
    try {
      await work()
      onChanged()
    } catch (cause: unknown) {
      onProblem(cause instanceof Error ? cause.message : String(cause))
    }
  }

  /** 右键落在页面上（不是落在便签上）时弹色板。 */
  const openMenu = (event: MouseEvent): void => {
    const root = document.querySelector(`[${ROOM_ATTR}]`)
    if (root === null || !root.contains(event.target as Node)) return
    // 便签自己不吃右键（那一下留给"撕掉"之类以后可能加的东西）。
    if ((event.target as HTMLElement).closest('[data-note]') !== null) return
    event.preventDefault()
    const box = root.getBoundingClientRect()
    setMenu({ x: event.clientX - box.left, y: event.clientY - box.top })
  }

  // 监听挂在 **document** 上，不是这个层上：容器为了不吃三栏的点击用了
  // `pointer-events: none`，于是落在三栏上的右键根本到不了这个层的 handler——
  // 那是个只有真点一下才会发现的坑。挂在 document 上、再按房间页的范围过滤，
  // 既不挡下层，也收得到。
  useEffect(() => {
    const closeMenu = (): void => setMenu(null)
    document.addEventListener('contextmenu', openMenu)
    // 点别处也要收起色板——同一个理由挂 document：这个层自己收不到点击。
    document.addEventListener('click', closeMenu)
    return () => {
      document.removeEventListener('contextmenu', openMenu)
      document.removeEventListener('click', closeMenu)
    }
  })

  return <div
    style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}
  >
    {notes.map(note => <div
      key={note.id}
      data-note={note.id}
      onMouseDown={(event) => {
        // 拖它挪位置。**写盘只在松手时**——拖一下几十个 mousemove，每个都写一遍是白费。
        if ((event.target as HTMLElement).dataset['kill'] !== undefined) return
        const box = event.currentTarget.parentElement?.getBoundingClientRect()
        if (box === undefined) return
        setDragging(note.id)
        const startX = event.clientX
        const startY = event.clientY
        let last = 0
        const move = (moveEvent: MouseEvent): void => {
          const x = note.x + moveEvent.clientX - startX
          const y = note.y + moveEvent.clientY - startY
          const target = document.querySelector<HTMLElement>(`[data-note="${note.id}"]`)
          if (target !== null) {
            target.style.left = `${Math.max(0, x)}px`
            target.style.top = `${Math.max(0, y)}px`
          }
          // 节流：拖动过程中最多每 DRAG_WRITE_MS 写一次，松手时再补一次最终的。
          const now = Date.now()
          if (now - last > DRAG_WRITE_MS) {
            last = now
            void post('edit', { session: sessionId, id: note.id, x: Math.max(0, x), y: Math.max(0, y) }).catch(() => {})
          }
        }
        const up = (upEvent: MouseEvent): void => {
          window.removeEventListener('mousemove', move)
          window.removeEventListener('mouseup', up)
          setDragging(null)
          void guard(() => post('edit', {
            session: sessionId,
            id: note.id,
            x: Math.max(0, note.x + upEvent.clientX - startX),
            y: Math.max(0, note.y + upEvent.clientY - startY),
          }))
        }
        window.addEventListener('mousemove', move)
        window.addEventListener('mouseup', up)
      }}
      style={{
        position: 'absolute',
        left: `${note.x}px`,
        top: `${note.y}px`,
        width: '170px',
        minHeight: '54px',
        padding: '16px 10px 20px',
        borderRadius: '8px',
        background: FILL[note.color] ?? FILL['white'],
        border: note.color === 'white' ? '1px solid rgba(0,0,0,.10)' : '1px solid transparent',
        boxShadow: '0 4px 14px rgba(0,0,0,.13)',
        color: '#23231f',
        fontSize: '12px',
        lineHeight: 1.55,
        pointerEvents: 'auto',
        cursor: dragging === note.id ? 'grabbing' : 'grab',
        outline: 'none',
        zIndex: 20,
      }}
    >
      <span style={{
        position: 'absolute', left: '7px', top: '3px', fontSize: '10px',
        opacity: 0.5, fontVariantNumeric: 'tabular-nums',
      }}>#{note.seq}</span>
      <span
        data-kill="1"
        title={t('note.remove')}
        onClick={() => void guard(() => post('remove', { session: sessionId, id: note.id }))}
        style={{ position: 'absolute', right: '6px', bottom: '3px', cursor: 'pointer', opacity: 0.45, fontSize: '11px' }}
      >✕</span>
      {/* 只有这一段可编辑。序号与 ✕ 是它的**兄弟**，不是子节点——它们在编辑区外，
          所以全选之后打字不会把它们一起抹掉。 */}
      <div
        contentEditable
        suppressContentEditableWarning
        onBlur={(event) => {
          const text = event.currentTarget.textContent ?? ''
          if (text !== note.text) void guard(() => post('edit', { session: sessionId, id: note.id, text }))
        }}
        style={{ outline: 'none', minHeight: '18px', cursor: 'inherit' }}
      >{note.text}</div>
    </div>)}

    {menu !== null
      ? <div
        onClick={(event) => event.stopPropagation()}
        style={{
          position: 'absolute', left: `${menu.x}px`, top: `${menu.y}px`, zIndex: 30,
          background: 'var(--dsw-surface-raised, #fff)', border: '1px solid var(--dsw-border-subtle, rgba(0,0,0,.12))',
          borderRadius: '9px', padding: '6px', boxShadow: '0 8px 22px rgba(0,0,0,.18)', pointerEvents: 'auto',
        }}
      >
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 24px)', gap: '6px' }}>
          {Object.entries(FILL).map(([color, fill]) => <span
            key={color}
            data-swatch={color}
            onClick={() => {
              const at = { x: menu.x, y: menu.y }
              setMenu(null)
              void guard(() => post('add', {
                session: sessionId, color, text: t('note.placeholder'), x: at.x, y: at.y,
              }))
            }}
            style={{
              width: '24px', height: '24px', borderRadius: '6px', cursor: 'pointer', background: fill,
              boxShadow: color === 'white' ? 'inset 0 0 0 1px rgba(0,0,0,.14)' : 'none',
            }}
          />)}
        </div>
        <div style={{ fontSize: '11px', opacity: 0.6, margin: '6px 2px 2px' }}>{t('note.add')}</div>
      </div>
      : null}
  </div>
}
