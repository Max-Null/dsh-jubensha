/**
 * 房间 —— 剧本杀的那张桌子，装在会话视图的一个标签里，标签叫「团队」。
 *
 * **为什么叫「团队」**：它本来就在讲这件事——桌上坐着谁、谁演谁、这一局到哪一步了。
 * 一个叫「团队」的标签与「对话 / 轨迹 / 上下文」并列，看起来就是 Agent Teams 的名单。
 * 而**这个伪装性是有用的**：对话形态唯一的面板给不了的东西，就是「看起来在干别的」——
 * 那正是这个插件存在的第一个理由（用户原话「极其隐蔽，适合摸鱼」）。所以标签名不是随便起
 * 的，它得经得起旁边的人扫一眼。
 *
 * **只有这一处挂载。** 曾经还有侧栏底部一个入口按钮与一个 `shell.overlay` 浮层，去掉的理由是
 * 它们要一份 store 来共享开合状态、而标签不需要那件事：一个常驻的标签本身就是"一直开着"，
 * 再给同一份内容配一条开合的路，只是让同一块东西有两个入口、两套状态、两处要维护。
 *
 * **它属于某个会话，不是属于这个进程。** `conversation.view` 的 inject 会告诉我们是谁在看我，
 * 而快照按那个 id 取——局面是**每个会话各自一局**（见 `../index.ts` 里 `games` 的注释）。
 *
 * **它是附加层，不是第二条数据通道。** 宿主半边一行都没为它改：内容全部来自那个只读端点
 * `/jubensha/room`（见 `../room.ts`），而「排座」只生成一段文本交给主持人，不自己调工具。
 *
 * @module @max-null/dsh-jubensha/client
 */
import { useEffect, useState } from 'react'
import type { Context } from '@deepseek-ai/cordis'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { avatarSvg } from '../avatar.ts'
// 形状从 `room-types.ts` 取，不是从 `room.ts` 取：后者 import 了 cordis，而本文件要过
// 打包的纯度门（它拒掉 `@deepseek-ai/*` 的任何导入，类型导入也不例外）。
import type { RoomSnapshot } from '../room-types.ts'
import { openingInstruction } from '../instruction.ts'
import { en, zh } from './locales.ts'

// 这几个 type-only import 拉入声明：`conversation.view` 是别人声明的槽（注册进一个没人声明的槽
// 会在装载时失败，类型上表现为槽名不满足 `never` 约束），而 `ctx.slots` / `ctx.locale` 要有人
// 声明才存在。
//
// 子路径看包的形态：`ui-conversation` / `ui-renderer` 是**宿主+客户端**两半的包，声明在 `/client`；
// 而 `ui-slots` 自己就是浏览器半边的包，主入口即是。
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-locale/client'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** 团队标签的文案。 */
    jubensha: keyof typeof zh
  }
}

/** 需要的服务：`locale` 注册文案，`slots` 挂标签。 */
export const inject = ['locale', 'slots']

type Locale = PropsLocale<'jubensha'>

/** 视图注入面——只有一件事：谁在看我。 */
export interface RoomInjected {
  /** 这个标签属于哪个会话。快照按它取，因为局面是每个会话各自一局。 */
  sessionId: string
}

/** 一行小标题。 */
function Heading({ children }: { children: string }) {
  return <div style={{ opacity: 0.7, fontSize: '12px', marginBottom: '4px' }}>{children}</div>
}

/**
 * 房间的内容本身。
 *
 * **它自己拉数据**，每 4 秒一次（页面藏起来时不拉）。一开始不做轮询，理由是「用户看着它的时候
 * 正是他不太可能在推进阶段的时刻」——那个理由被推翻了：标签是**常驻**的，只在挂载时拉一次等于
 * 之后再不动，看着就像"房间和会话没有联动"。**该问的不是"用户会看多久"，是"这个界面活多久"。**
 * @param props - 本地化文案与这个标签属于哪个会话。
 * @returns 房间的内容。
 */
export function RoomBody({ t, sessionId }: Locale & { sessionId: string }) {
  const [snapshot, setSnapshot] = useState<RoomSnapshot | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  // 排座是**组件内部的状态**：只有这一处知道，也不跨挂载存活。
  const [chosen, setChosen] = useState<string | null>(null)
  const [cast, setCast] = useState<Record<string, string>>({})
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    let cancelled = false
    const load = async (): Promise<void> => {
      try {
        const response = await fetch(`/jubensha/room?session=${encodeURIComponent(sessionId)}`)
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
    }
    void load()
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void load()
    }, 4000)
    return () => { cancelled = true; window.clearInterval(timer) }
  }, [sessionId])

  const game = snapshot?.game ?? null
  const actors = snapshot?.actors ?? []
  const players = snapshot?.players ?? []
  const cases = snapshot?.cases ?? []
  const chosenEntry = cases.find(one => one.id === chosen) ?? null
  // 只把**已经挑了演员**的位子写进指令：给一个空着的位子编个名字写进去，主持人会以为那真是
  // 某人——而他照着做的时候才发现没有这个人。
  const assignment = chosenEntry === null ? [] : chosenEntry.roles
    .filter(role => role.player === 'ai')
    .flatMap((role) => {
      const actor = actors.find(one => one.id === cast[`${chosenEntry.id}:${role.id}`])
      return actor === undefined
        ? []
        : [{ seat: role.id, roleName: role.name, actorId: actor.id, actorName: actor.name }]
    })
  const copyInstruction = async (): Promise<void> => {
    if (chosenEntry === null) return
    try {
      await navigator.clipboard.writeText(openingInstruction(chosenEntry, assignment))
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1500)
    } catch (cause: unknown) {
      setProblem(cause instanceof Error ? cause.message : String(cause))
    }
  }

  return <>
    {problem !== null
      ? <p style={{ margin: '0 0 8px', color: 'var(--dsw-danger, #e06c75)' }}>{problem}</p>
      : null}

    {game === null
      ? <p style={{ margin: '0 0 10px', opacity: 0.85 }}>{t('room.empty')}</p>
      : <div style={{ marginBottom: '10px' }}>
        <Heading>{`${t('room.phase')} · ${t('room.round')}`}</Heading>
        <div><b>{game.title}</b>（case {game.caseId}）</div>
        <div style={{ opacity: 0.85 }}>{game.phase} · 第 {game.round} 轮 · 线索 {game.revealedClues.length} 条</div>
      </div>}

    <div style={{ marginBottom: '10px' }}>
      <Heading>{t('room.seats')}</Heading>
      {game === null
        ? <div style={{ opacity: 0.6 }}>—</div>
        : game.seats.map(seat => {
          const sitting = players.find(player => player.seat === seat)
          const mine = seat === game.humanSeat
          return <div key={seat} style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
            <span style={{ opacity: 0.6, width: '28px' }}>{seat}</span>
            <span>{sitting?.name ?? (mine ? `（${t('room.human')}）` : '—')}</span>
          </div>
        })}
    </div>

    <div style={{ marginBottom: '10px' }}>
      <Heading>{t('room.cases')}</Heading>
      {cases.length === 0
        ? <p style={{ margin: '2px 0 0', opacity: 0.8 }}>{t('room.noCases')}</p>
        : cases.map(entry => <div key={entry.id} style={{ marginBottom: '6px' }}>
          <label style={{ display: 'flex', gap: '6px', alignItems: 'baseline', cursor: 'pointer' }}>
            <input
              type="radio"
              name="jubensha-case"
              checked={chosen === entry.id}
              onChange={() => { setChosen(entry.id); setCopied(false) }}
            />
            <span>{entry.title}（case {entry.id}｜{entry.genre}）</span>
          </label>
          {/* 位子与角色名是排座的依据：要几个 AI 玩家、谁演谁，看这一行。 */}
          <div style={{ opacity: 0.65, fontSize: '12px', marginLeft: '20px' }}>
            {entry.roles.map(role => `${role.id} ${role.name}`).join(' · ')}
          </div>
          {chosen === entry.id
            ? <div style={{ marginLeft: '20px', marginTop: '5px' }}>
              {entry.roles.filter(role => role.player === 'ai').map(role => <div
                key={role.id}
                style={{ display: 'flex', gap: '6px', alignItems: 'center', marginBottom: '3px' }}
              >
                <span style={{ opacity: 0.6, width: '24px' }}>{role.id}</span>
                <span style={{ flex: 1 }}>{role.name}</span>
                <select
                  aria-label={`${role.id} ${role.name}`}
                  value={cast[`${entry.id}:${role.id}`] ?? ''}
                  onChange={(event) => {
                    setCast({ ...cast, [`${entry.id}:${role.id}`]: event.target.value })
                    setCopied(false)
                  }}
                >
                  <option value="">{t('room.pickActor')}</option>
                  {actors.map(actor => <option
                    key={actor.id}
                    value={actor.id}
                    // 一个演员同一局只能坐一个位子——同一个人演三个角色在物理上就不可能。
                    // 别的位子已经选了他，这里就禁掉，而不是等人排完再把这条指令发出去。
                    disabled={Object.entries(cast).some(([key, value]) =>
                      value === actor.id && key !== `${entry.id}:${role.id}`)}
                  >{actor.name}</option>)}
                </select>
              </div>)}
              <button
                type="button"
                onClick={() => void copyInstruction()}
                style={{
                  marginTop: '4px', padding: '3px 10px', borderRadius: '8px',
                  border: '1px solid var(--dsw-border-subtle, rgba(127,127,127,0.28))',
                  background: 'transparent', color: 'inherit', font: 'inherit',
                  fontSize: '12px', cursor: 'pointer',
                }}
              >{copied ? t('room.copied') : t('room.copy')}</button>
              {/* 指令也显示出来：用户可能只想看，或者只抄其中一段——剪贴板是顺手，不是唯一出口。 */}
              {assignment.length > 0
                ? <pre style={{
                  margin: '6px 0 0',
                  padding: '6px 8px',
                  maxHeight: '150px',
                  overflow: 'auto',
                  background: 'var(--dsw-surface-sunken, rgba(127,127,127,0.10))',
                  borderRadius: '8px',
                  fontSize: '11px',
                  lineHeight: 1.5,
                  whiteSpace: 'pre-wrap',
                }}>{openingInstruction(entry, assignment)}</pre>
                : null}
            </div>
            : null}
        </div>)}
    </div>

    {actors.length > 0
      ? <div>
        <Heading>{t('room.actors')}</Heading>
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
  </>
}

/**
 * 会话视图的那个标签。
 *
 * 标签文字由 `apply` 里的 `label` 给（「团队」），组件本身只要渲染内容——它没有框、没有关闭
 * 按钮，因为它跟「对话 / 轨迹 / 上下文」一样是常驻的一栏。
 * @param props - 本地化文案与注入面（谁在看我）。
 * @returns 房间的内容。
 */
export function TeamView({ t, sessionId }: PropsRuntime<'conversation.view'> & Locale & InjectFace<RoomInjected>) {
  return <div style={{ padding: '12px 16px', fontSize: '13px', lineHeight: 1.6 }}>
    <RoomBody t={t} sessionId={sessionId} />
  </div>
}

/**
 * 挂上那个标签。
 * @param ctx - 客户端的插件上下文。
 */
export function apply(ctx: Context): void {
  ctx.effect(() => ctx.locale.register('jubensha', { zh, en }), 'jubensha: dictionaries')
  ctx.slots.inject('conversation.view', () => ctx.slots.register({
    name: 'conversation.view',
    id: 'jubensha.team',
    // 排在「轨迹」后面。顺序只是位置，不是重要性。
    order: 20,
    locale: 'jubensha',
    label: () => ctx.locale.bind('jubensha')('view.team'),
    // 谁在看我——快照按这个 id 取。
    inject: (sessionId: string): RoomInjected => ({ sessionId }),
  }, TeamView))
}
