/**
 * 设置页 —— 出现在「设置 → 插件 → 剧本杀」。
 *
 * **只放跨局的东西**：演员（谁在玩）与本子来源（去哪儿找本子）。判断是一句话——**换一局它
 * 还成立吗**：演员是，座位不是。所以一局里的东西（谁坐哪、线索发了几条、便签）都在「团队」
 * 标签里，不进这里。
 *
 * 挂 `settings.plugins.tab` 而**不是** `settings.section`：功能插件不占左边那列导航，只往
 * 「插件」那一栏贡献一个页面（`ui-settings-plugins` 的注释就是这么定的）。
 *
 * 性格在这里**手写**，LLM 起草仍留在对话里（`jubensha_actor action="draft"`）——设置页是
 * 浏览器半边，它调不了模型。
 *
 * @module @max-null/dsh-jubensha/client/settings
 */
import { useEffect, useState } from 'react'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { RoomActor } from '../room-types.ts'
import { Face } from './room.tsx'

type Locale = PropsLocale<'jubensha'>

/** 往演员端点发一个动作。 */
async function act(action: string, body: Record<string, unknown>): Promise<unknown> {
  const response = await fetch(`/jubensha/actor/${action}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  const parsed = await response.json() as { ok?: boolean, value?: unknown, error?: string }
  if (parsed.ok !== true) throw new Error(parsed.error ?? `HTTP ${response.status}`)
  return parsed.value
}

/** 读整个演员池。**不需要会话**——演员是跨会话的。 */
async function listActors(): Promise<RoomActor[]> {
  const response = await fetch('/jubensha/actor')
  const parsed = await response.json() as { ok?: boolean, value?: RoomActor[], error?: string }
  if (parsed.ok !== true || parsed.value === undefined) throw new Error(parsed.error ?? `HTTP ${response.status}`)
  return parsed.value
}

/** 一行小标题。 */
function Heading({ children }: { children: string }) {
  return <h3 style={{ fontSize: '13px', margin: '0 0 4px', fontWeight: 600 }}>{children}</h3>
}

/** 一张输入。 */
const inputStyle = {
  width: '100%',
  font: 'inherit',
  fontSize: '12.5px',
  padding: '6px 9px',
  borderRadius: '8px',
  border: '1px solid var(--dsw-border-subtle, rgba(127,127,127,0.28))',
  background: 'var(--dsw-surface, transparent)',
  color: 'inherit',
  boxSizing: 'border-box' as const,
}

/**
 * 演员那一区。
 * @param props - 演员、重读与本地化文案。
 * @returns 每张卡可改名字、性格、头像，可删；底下是招人。
 */
function Actors({ actors, reload, onProblem, t }: Locale & {
  actors: RoomActor[]
  reload: () => void
  onProblem: (message: string) => void
}) {
  const [draft, setDraft] = useState<{ id: string; name: string } | null>(null)

  const guard = async (work: () => Promise<unknown>): Promise<void> => {
    try {
      await work()
      reload()
    } catch (cause: unknown) {
      onProblem(cause instanceof Error ? cause.message : String(cause))
    }
  }

  return <>
    <Heading>{t('set.actors')}</Heading>
    <p style={{ opacity: 0.7, fontSize: '12px', margin: '0 0 10px' }}>{t('set.actorsLead')}</p>

    {actors.map(actor => <div key={actor.id} style={{
      display: 'flex', gap: '12px', alignItems: 'flex-start',
      border: '1px solid var(--dsw-border-subtle, rgba(127,127,127,0.28))',
      borderRadius: '10px',
      background: 'var(--dsw-surface-sunken, rgba(127,127,127,0.06))',
      padding: '12px',
      marginBottom: '10px',
    }}>
      <Face id={actor.id} {...actor.avatar === undefined ? {} : { avatar: actor.avatar }} size={44} />
      <div style={{ flex: 1, minWidth: 0, display: 'grid', gap: '7px' }}>
        <label style={{ display: 'block' }}>
          <span style={{ fontSize: '11px', opacity: 0.7, display: 'block', marginBottom: '2px' }}>{t('set.name')}</span>
          <input
            style={inputStyle}
            defaultValue={actor.name}
            onBlur={(event) => {
              const name = event.currentTarget.value.trim()
              if (name !== '' && name !== actor.name) void guard(() => act('rename', { id: actor.id, name }))
            }}
          />
        </label>
        <label style={{ display: 'block' }}>
          <span style={{ fontSize: '11px', opacity: 0.7, display: 'block', marginBottom: '2px' }}>{t('set.style')}</span>
          <textarea
            style={{ ...inputStyle, minHeight: '54px', lineHeight: 1.65, resize: 'vertical' }}
            defaultValue={actor.style}
            onBlur={(event) => {
              const style = event.currentTarget.value
              if (style !== actor.style) void guard(() => act('style', { id: actor.id, style }))
            }}
          />
        </label>
        <div style={{ fontSize: '12px', opacity: 0.7 }}>
          {/* 只读：那是每局复盘后自己攒起来的，让人手改等于伪造他的记忆。 */}
          <span style={{ display: 'block', fontSize: '11px', opacity: 0.8, marginBottom: '2px' }}>{t('set.notes')}</span>
          {actor.notes.length === 0
            ? <div>· {t('set.noNotes')}</div>
            : actor.notes.map((one, index) => <div key={index}>· {one}</div>)}
        </div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
        <button
          type="button"
          onClick={() => void guard(() => act('avatar', { id: actor.id, image: '' }))}
          style={{ font: 'inherit', fontSize: '12px', padding: '4px 10px', borderRadius: '7px', border: '1px solid var(--dsw-border-subtle, rgba(127,127,127,0.28))', background: 'transparent', color: 'inherit', cursor: 'pointer' }}
        >{t('set.resetFace')}</button>
        <button
          type="button"
          onClick={() => {
            // 不可逆——跨局印象跟着 id 一起没。所以先问一句。
            if (window.confirm(t('set.removeAsk').replace('{name}', actor.name))) {
              void guard(() => act('remove', { id: actor.id }))
            }
          }}
          style={{ font: 'inherit', fontSize: '12px', padding: '4px 10px', borderRadius: '7px', border: '1px solid var(--dsw-border-subtle, rgba(127,127,127,0.28))', background: 'transparent', color: 'var(--dsw-danger, #e06c75)', cursor: 'pointer' }}
        >{t('set.remove')}</button>
      </div>
    </div>)}

    {draft === null
      ? <button
        type="button"
        onClick={() => setDraft({ id: '', name: '' })}
        style={{ width: '100%', padding: '9px', borderRadius: '9px', border: '1px dashed var(--dsw-border-subtle, rgba(127,127,127,0.4))', background: 'transparent', color: 'inherit', font: 'inherit', fontSize: '12.5px', cursor: 'pointer' }}
      >{t('set.add')}</button>
      : <div style={{ border: '1px dashed var(--dsw-border-subtle, rgba(127,127,127,0.4))', borderRadius: '10px', padding: '12px', display: 'grid', gap: '7px' }}>
        <input
          style={inputStyle}
          placeholder={t('set.newId')}
          value={draft.id}
          onChange={(event) => setDraft({ ...draft, id: event.target.value })}
        />
        <input
          style={inputStyle}
          placeholder={t('set.newName')}
          value={draft.name}
          onChange={(event) => setDraft({ ...draft, name: event.target.value })}
        />
        <div style={{ display: 'flex', gap: '8px' }}>
          <button
            type="button"
            onClick={() => {
              const id = draft.id.trim()
              const name = draft.name.trim()
              if (id === '' || name === '') {
                onProblem(t('set.needBoth'))
                return
              }
              void guard(() => act('add', { id, name, style: '' })).then(() => setDraft(null))
            }}
            style={{ font: 'inherit', fontSize: '12px', padding: '4px 12px', borderRadius: '7px', border: '1px solid var(--dsw-accent, #4a7fd4)', background: 'transparent', color: 'var(--dsw-accent, #4a7fd4)', cursor: 'pointer' }}
          >{t('set.confirm')}</button>
          <button
            type="button"
            onClick={() => setDraft(null)}
            style={{ font: 'inherit', fontSize: '12px', padding: '4px 12px', borderRadius: '7px', border: '1px solid var(--dsw-border-subtle, rgba(127,127,127,0.28))', background: 'transparent', color: 'inherit', cursor: 'pointer' }}
          >{t('common.cancel')}</button>
        </div>
      </div>}
  </>
}

/**
 * 设置页。
 * @param props - 本地化文案。
 * @returns 演员与本子来源两区。
 */
export function SettingsTab({ t }: Locale) {
  const [actors, setActors] = useState<RoomActor[] | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const [nonce, setNonce] = useState(0)

  useEffect(() => {
    let cancelled = false
    void listActors().then((list) => {
      if (!cancelled) {
        setActors(list)
        setProblem(null)
      }
    }).catch((cause: unknown) => {
      if (!cancelled) setProblem(cause instanceof Error ? cause.message : String(cause))
    })
    return () => { cancelled = true }
  }, [nonce])

  const reload = (): void => setNonce(one => one + 1)

  return <div style={{ padding: '20px 24px 40px', fontSize: '13px', lineHeight: 1.6, maxWidth: '760px' }}>
    <h2 style={{ fontSize: '16px', margin: '0 0 4px', fontWeight: 600 }}>{t('set.title')}</h2>
    <p style={{ opacity: 0.7, fontSize: '12px', margin: '0 0 20px' }}>{t('set.lead')}</p>

    {problem !== null
      ? <div style={{ marginBottom: '12px', fontSize: '12px', color: 'var(--dsw-danger, #e06c75)' }}>{problem}</div>
      : null}

    {actors === null
      ? <div style={{ opacity: 0.7 }}>{t('common.loading')}</div>
      : <section style={{ marginBottom: '26px' }}>
        <Actors actors={actors} reload={reload} onProblem={setProblem} t={t} />
      </section>}

    <section>
      <Heading>{t('set.cases')}</Heading>
      {/* 本子来源这一块**只显示插件自带的那份**：自定义目录要一个「面板该扫哪些目录」的配置，
          那是宿主侧的新东西（界面设计 §5 第 4 条）。明说它没接，不画一个加不动的"加目录"。 */}
      <div style={{ fontSize: '12.5px', opacity: 0.75 }}>{t('set.casesPending')}</div>
    </section>
  </div>
}
