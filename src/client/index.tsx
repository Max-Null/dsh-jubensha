/**
 * 「团队」标签 —— 会话视图里的那个房间。
 *
 * **为什么叫「团队」**：它本来就在讲这件事——桌上坐着谁、谁演谁、这一局到哪一步了。
 * 一个叫「团队」的标签与「对话 / 轨迹 / 上下文」并列，看起来就是 Agent Teams 的名单。
 * 而**这个伪装性是有用的**：对话形态唯一的面板给不了的东西，就是「看起来在干别的」——
 * 那正是这个插件存在的第一个理由（用户原话「极其隐蔽，适合摸鱼」）。
 *
 * **它属于某个会话，不是属于这个进程。** `conversation.view` 的 inject 会告诉我们是谁在看我，
 * 而快照按那个 id 取——局面是每个会话各自一局（见 `../index.ts` 里 `games` 的注释）。
 *
 * **它是附加层，不是第二条数据通道。** 宿主半边不为它改结构：内容全部来自那个只读端点
 * `/jubensha/room`（见 `../room.ts`），而「排座」只生成一段文本交给主持人，不自己调工具。
 *
 * 三块东西各有各的文件：这一份只管接线，三栏在 `room.tsx`，便签层在 `notes.tsx`。
 *
 * @module @max-null/dsh-jubensha/client
 */
import { useEffect, useState } from 'react'
import type { Context } from '@deepseek-ai/cordis'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
// 这几个 type-only import 拉入声明：`conversation.view` 是别人声明的槽（注册进一个没人声明的槽
// 会在装载时失败，类型上表现为槽名不满足 `never` 约束），而 `ctx.slots` / `ctx.locale` 要有人
// 声明才存在。
//
// 子路径看包的形态：`ui-conversation` / `ui-renderer` 是**宿主+客户端**两半的包，声明在 `/client`；
// 而 `ui-slots` 自己就是浏览器半边的包，主入口即是。
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type { RoomSnapshot } from '../room-types.ts'
import { RoomView } from './room.tsx'
import { NoteLayer } from './notes.tsx'
import { SettingsTab } from './settings.tsx'
import { en, zh } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** 房间 / 团队标签的文案。 */
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

/**
 * 多久拉一次快照。
 *
 * **一开始没做轮询**，理由是「用户看着它的时候正是他不太可能在推进阶段的时刻」——那个理由
 * 被推翻了：标签是**常驻**的，只在挂载时拉一次等于之后再不动，看着就像"房间和会话没有联动"。
 * 该问的不是"用户会看多久"，是"这个界面活多久"。
 */
const POLL_MS = 4000

/**
 * 房间标签。
 * @param props - 本地化文案与注入面（谁在看我）。
 * @returns 三栏 + 便签层。
 */
export function TeamView({ t, sessionId }: PropsRuntime<'conversation.view'> & Locale & InjectFace<RoomInjected>) {
  const [snapshot, setSnapshot] = useState<RoomSnapshot | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  /** 便签改过之后加一，让那个 effect 重跑一次——比手写一份本地便签副本少一处会不同步的状态。 */
  const [nonce, setNonce] = useState(0)

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
    // 页面藏起来时不拉——那是最没意义的一档。
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void load()
    }, POLL_MS)
    return () => { cancelled = true; window.clearInterval(timer) }
  }, [sessionId, nonce])

  if (snapshot === null) {
    return <div style={{ padding: '18px 20px', fontSize: '12.5px', opacity: 0.7 }}>
      {problem ?? t('common.loading')}
    </div>
  }
  return <>
    {problem !== null
      ? <div style={{ padding: '8px 20px', fontSize: '12px', color: 'var(--dsw-danger, #e06c75)' }}>{problem}</div>
      : null}
    <RoomView
      snapshot={snapshot}
      t={t}
      notes={<NoteLayer
        t={t}
        sessionId={sessionId}
        notes={snapshot.notes}
        onChanged={() => setNonce(one => one + 1)}
        onProblem={setProblem}
      />}
    />
  </>
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
  // 设置页。挂 `settings.plugins.tab` 而**不是** `settings.section`：功能插件不占左边那列导航，
  // 只往「插件」那一栏贡献一个页面——所以它出现在「设置 → 插件 → 剧本杀」。
  ctx.slots.inject('settings.plugins.tab', () => ctx.slots.register({
    name: 'settings.plugins.tab',
    id: 'jubensha',
    // 排在「全部插件」之后。
    order: 20,
    locale: 'jubensha',
    label: () => ctx.locale.bind('jubensha')('set.tab'),
  }, SettingsTab))
}
