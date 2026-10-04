/**
 * 房间面板 —— 剧本杀的那张桌子。
 *
 * **它是附加层，不是第二条数据通道。** 宿主半边（工具、局面状态机、演员池）一行都不为它改：
 * 面板读的是**会话事件流**里那些 `jubensha_*` 工具调用的结果，与 chat-rail 从会话里读
 * 导航数据是同一条路。所以没装这个半边、或它加载失败时，对话形态照常能玩——这正是
 * 设计方案里「两条形态并存」那条约束的意思。
 *
 * 两块东西挂两个槽：
 *
 * - **入口按钮** → `conversation.input.dock`（输入框旁那一带）；
 * - **面板本体** → `shell.overlay`（应用级浮层槽，重命名对话框与快捷键面板都挂那里）。
 *
 * 两处靠 `store.ts` 共享"开着没有"——它们在不同的父槽下，组件局部状态传不过去。
 *
 * @module @max-null/dsh-jubensha/client
 */
// `Context` 必须从 `@deepseek-ai/cordis` 取：`ctx.slots` / `ctx.locale` 这些服务是靠声明合并
// 挂在这个包的 `Context` 上的，从 vendored 的 `cordis` 取会得到一个没有它们的类型。
import type { Context } from '@deepseek-ai/cordis'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { PropsStore } from '@deepseek-ai/dsh-client-store'
// 这几个 type-only import 拉入声明：槽位（`shell.overlay` 与 `conversation.input.dock` 都是
// 别人声明的槽，`slots.register` 进一个没人声明的槽会在装载时失败，类型上表现为槽名不满足
// `never` 约束）与服务（`ctx.slots` / `ctx.locale` 要有人声明才存在）。
//
// 子路径看包的形态：`ui-layout` / `ui-renderer` / `ui-conversation` 是**宿主+客户端**两半的包，
// 声明在 `/client`；而 `ui-slots` 自己就是浏览器半边的包，主入口即是（带 `/client` 反而找不到）。
// 入口与面板**必须同 scope**，因为一处 store 句柄只能挂一个 scope
// （踩过：挂到 `conversation.input.dock`（session）与 `shell.overlay`（root）两处，
// 装载时抛 `one handle, one scope`）。所以入口选 `sidebar.footer.action`——它也是 root。
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import { useEffect, useState } from 'react'
import { avatarSvg } from '../avatar.ts'
// 形状从 `room-types.ts` 取，不是从 `room.ts` 取：后者 import 了 cordis，而本文件要过
// 打包的纯度门（它拒掉 `@deepseek-ai/*` 的任何导入，类型导入也不例外）。
import type { RoomSnapshot } from '../room-types.ts'
import { createRoomStore } from './store.ts'
import { en, zh } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** 房间面板的文案。 */
    jubensha: keyof typeof zh
  }
}

/** 需要的服务。`locale` 注册文案，`slots` 挂两块东西。 */
export const inject = ['locale', 'slots']

type Store = PropsStore<ReturnType<typeof createRoomStore>>
type Locale = PropsLocale<'jubensha'>

/** 面板的样式。先写成一份常量：换成 CSS Module 要动构建配置，而那属于面板成型之后的事。 */
const panelStyle = {
  position: 'fixed' as const,
  top: '72px',
  right: '24px',
  width: '300px',
  maxHeight: '70vh',
  overflowY: 'auto' as const,
  padding: '14px 16px',
  borderRadius: '12px',
  border: '1px solid var(--dsw-border-subtle, rgba(127,127,127,0.28))',
  background: 'var(--dsw-surface-raised, rgba(28,30,36,0.96))',
  color: 'var(--dsw-text-primary, inherit)',
  boxShadow: '0 12px 32px rgba(0,0,0,0.28)',
  fontSize: '13px',
  lineHeight: 1.6,
  zIndex: 30,
}

/**
 * 侧栏底部那个入口按钮。
 * @param props - store 的动作与本地化文案。
 * @returns 一个按钮。
 */
export function RoomButton({ actions, t }: PropsRuntime<'sidebar.footer.action'> & Store & Locale) {
  return <button
    type="button"
    title={t('room.openTitle')}
    aria-label={t('room.openTitle')}
    onClick={() => actions.toggle()}
    style={{
      display: 'inline-flex', alignItems: 'center', height: '28px', padding: '0 10px',
      borderRadius: '8px', border: '1px solid var(--dsw-border-subtle, rgba(127,127,127,0.28))',
      background: 'transparent', color: 'inherit', font: 'inherit', fontSize: '12px', cursor: 'pointer',
    }}
  >{t('room.open')}</button>
}

/**
 * 面板本体。
 *
 * 开着的时候去拉一次宿主侧的快照（`/jubensha/room`，见 `../room.ts`）。**只在打开时拉，
 * 不做轮询**：局面变化都是对话驱动的，而用户看着面板的时候正是他不太可能在推进阶段的时刻；
 * 想看最新的，关掉再开一次就够。轮询要处理"拉到一半局面变了"这类问题，收益不抵。
 * @param props - store 的读取座位、动作与本地化文案。
 * @returns 面板，或者什么都不渲染。
 */
export function RoomPanel({ useStore, actions, t }: PropsRuntime<'shell.overlay'> & Store & Locale) {
  // 选择器只取用得到的那一个字段：`useStore` 的签名要一个选择器，而不是返回整份状态。
  const open = useStore(state => state.open)
  const [snapshot, setSnapshot] = useState<RoomSnapshot | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  useEffect(() => {
    if (!open) return undefined
    let cancelled = false
    void (async () => {
      try {
        const response = await fetch('/jubensha/room')
        const body = await response.json() as { ok?: boolean, value?: RoomSnapshot, error?: string }
        if (cancelled) return
        if (body.ok === true && body.value !== undefined) {
          setSnapshot(body.value)
          setProblem(null)
        } else {
          setProblem(body.error ?? `HTTP ${response.status}`)
        }
      } catch (cause: unknown) {
        if (!cancelled) setProblem(cause instanceof Error ? cause.message : String(cause))
      }
    })()
    return () => { cancelled = true }
  }, [open])

  if (!open) return null
  const game = snapshot?.game ?? null
  const actors = snapshot?.actors ?? []
  const players = snapshot?.players ?? []
  return <div style={panelStyle} role="dialog" aria-label={t('room.title')}>
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px' }}>
      <strong>{t('room.title')}</strong>
      <button
        type="button"
        aria-label={t('room.close')}
        onClick={() => actions.close()}
        style={{ background: 'transparent', border: 'none', color: 'inherit', cursor: 'pointer', font: 'inherit' }}
      >✕</button>
    </div>

    {problem !== null
      ? <p style={{ margin: '0 0 8px', color: 'var(--dsw-danger, #e06c75)' }}>{problem}</p>
      : null}

    {game === null
      ? <p style={{ margin: '0 0 10px', opacity: 0.85 }}>{t('room.empty')}</p>
      : <>
        <div style={{ marginBottom: '10px' }}>
          <div style={{ opacity: 0.7, fontSize: '12px' }}>{t('room.phase')} · {t('room.round')}</div>
          <div><b>{game.title}</b>（case {game.caseId}）</div>
          <div style={{ opacity: 0.85 }}>{game.phase} · 第 {game.round} 轮 · 线索 {game.revealedClues.length} 条</div>
        </div>
        <div style={{ marginBottom: '10px' }}>
          <div style={{ opacity: 0.7, fontSize: '12px' }}>{t('room.seats')}</div>
          {game.seats.map(seat => {
            const sitting = players.find(player => player.seat === seat)
            const mine = seat === game.humanSeat
            return <div key={seat} style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
              <span style={{ opacity: 0.6, width: '28px' }}>{seat}</span>
              <span>{sitting?.name ?? (mine ? `（${t('room.human')}）` : '—')}</span>
            </div>
          })}
        </div>
      </>}

    {actors.length > 0
      ? <div>
        <div style={{ opacity: 0.7, fontSize: '12px', marginBottom: '4px' }}>{t('room.actors')}</div>
        {actors.map(actor => <div key={actor.id} style={{ display: 'flex', gap: '8px', alignItems: 'center', marginBottom: '6px' }}>
          {actor.avatar === undefined
            // 内容是按 id 生成的几何图形，不含任何外部输入——这正是它敢用 innerHTML 的理由。
            // 换成自定义图片时走下面那条 <img>，不把用户给的东西塞进 SVG 里。
            ? <span style={{ display: 'inline-flex', width: '28px', height: '28px', borderRadius: '6px', overflow: 'hidden' }}
              dangerouslySetInnerHTML={{ __html: avatarSvg(actor.id, 28) }} />
            : <img src={actor.avatar} alt="" width={28} height={28}
              style={{ borderRadius: '6px', objectFit: 'cover' }} />}
          <div style={{ minWidth: 0 }}>
            <div>{actor.name}</div>
            <div style={{ opacity: 0.6, fontSize: '12px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {actor.style}
            </div>
          </div>
        </div>)}
      </div>
      : null}

    <p style={{ margin: '10px 0 0', opacity: 0.6, fontSize: '12px' }}>{t('room.hint')}</p>
  </div>
}

/**
 * 挂上入口按钮与面板。
 * @param ctx - 客户端的插件上下文。
 */
export function apply(ctx: Context): void {
  ctx.effect(() => ctx.locale.register('jubensha', { zh, en }), 'jubensha: dictionaries')
  const handle = createRoomStore()
  // 两个槽共用同一个 store 句柄——它们在不相干的父槽下，这是唯一能把"开着没有"传过去的路。
  const store: typeof handle = { ...handle, create: () => handle.create() }
  ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({
    name: 'sidebar.footer.action', id: 'jubensha.room.open', locale: 'jubensha', store,
  }, RoomButton))
  ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'shell.overlay', id: 'jubensha.room', locale: 'jubensha', store,
  }, RoomPanel))
}
