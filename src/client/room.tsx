/**
 * 房间页的三个栏。
 *
 * **它是附加层**：这里的每一块都从 `/jubensha/room` 那份只读快照来（见 `../room.ts`），
 * 宿主侧的工具与状态机不为它改结构。所以下面每个区块都要能回答「数据从哪儿来」——
 * 答不上来的地方就先**明说它缺**，而不是画一个空壳。
 *
 * 三栏的分工来自界面设计（`docs/设计/2026-10-05-房间与设置-界面设计.md` §2）：
 *
 * | 栏 | 管什么 |
 * |---|---|
 * | 左 | 这一局的人：座位、关系、时间线 |
 * | 中 | 主区：剧本正文（常驻回看）+ 当前阶段那一页 |
 * | 右 | 桌上说了什么 |
 *
 * **没有开局的位子**：中栏换成「开一局」——选本子、排座、生成指令。这是刻意的：那一区只在
 * 没有局面时出现，而有局面时中栏该是这一局本身。
 *
 * @module @max-null/dsh-jubensha/client/room
 */
import { useState } from 'react'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { RoomCase, RoomCaseRelation, RoomSnapshot } from '../room-types.ts'
import { avatarSvg } from '../avatar.ts'
import { openingInstruction } from '../instruction.ts'
import type { SaidLine } from './said.ts'

/**
 * 哪些来源**不是**「桌上说的话」。
 *
 * 右栏要的是人在桌上说的，而同一个通道里还流着上下文注入、技能目录、别的插件的通知、以及
 * 子 agent 的结算回执。这一串是**实测见到的非人话**——2026-10-06 从一次带两名玩家的真局里
 * 读出来的 `source.kind` 分布：真人是 `user`（21 条），玩家是 `agent-message`（11 条，直接在
 * 座）与 `team-message`（29 条，经 Team 的 send_message 发来），其余都不算。
 *
 * 用**排除法**而不是白名单：将来多出一种来源，多显示一句也比把玩家的话静默吃掉好。（这一条
 * 已经兑现过一次——`agent-message` 与 `team-message` 在实测之前是不知道的。）
 */
const NOT_SPOKEN = new Set([
  // 上下文注入（内核塞的）
  'runtime-context',
  'agent-instructions',
  'skill-catalog',
  'time-context',
  // 子 agent 的结算回执——那是「他干完了」，不是「他说了什么」
  'subagent-settled',
  // 工具重复调用的提醒
  'repeat-tool-reminder',
])

/** 这条是不是「桌上说的话」。 */
function isSaid(line: SaidLine): boolean {
  return !NOT_SPOKEN.has(line.from) && !line.from.startsWith('plugin:')
}

type Locale = PropsLocale<'jubensha'>

/** 五个阶段，按顺序。 */
const PHASES = ['self-intro', 'inquiry', 'search', 'final', 'reveal'] as const
type Phase = typeof PHASES[number]

/** 一行小标题。 */
function Heading({ children }: { children: string }) {
  return <div style={{ opacity: 0.7, fontSize: '12px', marginBottom: '5px' }}>{children}</div>
}

/** 一个方块。 */
function Card({ children }: { children: React.ReactNode }) {
  return <div style={{
    border: '1px solid var(--dsw-border-subtle, rgba(127,127,127,0.28))',
    borderRadius: '10px',
    background: 'var(--dsw-surface-sunken, rgba(127,127,127,0.06))',
    padding: '9px 12px',
    marginBottom: '8px',
  }}>{children}</div>
}

/** 头像：配了图就用图，没配就按演员 id 画一个。 */
export function Face({ id, avatar, size = 30 }: { id: string; avatar?: string; size?: number }) {
  const style = { width: `${size}px`, height: `${size}px`, borderRadius: '8px', flex: 'none', overflow: 'hidden' } as const
  if (avatar !== undefined) return <img src={avatar} alt="" style={{ ...style, objectFit: 'cover' }} />
  // 内容是按 id 生成的几何图形、不含任何外部输入——这正是它敢用 innerHTML 的理由。
  return <span style={style} dangerouslySetInnerHTML={{ __html: avatarSvg(id, size) }} />
}

/**
 * 关系图：死者居中，其余人排在四周，线按本子的 `relations` 画。
 *
 * **为什么不从 `scene.party` 推**：那是一句自由文本（「老陈 · 陈建国，61 岁，退休邮递员，
 * 老周三十年的棋友」），要连线就得先知道哪半句是名字、哪半句是关系——那是在解析自然语言。
 * 本子把这件事写清楚，这里只负责摆位置。
 *
 * 摆法是最简单的那种：中心一个、圆周上均分。关系是任意的图（两个角色之间也可能有线），
 * 而放射布局对"以某人为中心"的一局人来说够用，也不必引一个力导向库进来。
 * @param props - 关系、中心的那个人（死者）与图上要出现的人。
 * @returns 一张 SVG。
 */
function RelationGraph({ relations, center, names }: {
  relations: readonly RoomCaseRelation[]
  center: string
  names: readonly string[]
}) {
  const width = 258
  const height = 232
  const midX = width / 2
  const midY = height / 2
  const others = names.filter(one => one !== center)
  /** 某个人摆在哪儿。中心那个就摆在正中。 */
  const at = (name: string): { x: number; y: number } => {
    if (name === center) return { x: midX, y: midY }
    const index = others.indexOf(name)
    if (index < 0) return { x: midX, y: midY }
    // `-π/2` 让第一个落在正上方，然后顺时针均分。
    const angle = (index / Math.max(1, others.length)) * Math.PI * 2 - Math.PI / 2
    return { x: midX + Math.cos(angle) * 92, y: midY + Math.sin(angle) * 84 }
  }
  const known = new Set([center, ...others])

  return <svg viewBox={`0 0 ${width} ${height}`} style={{ width: '100%', height: 'auto' }}>
    {relations.map((one, index) => {
      // 线两头都得在图上——本子里写了别人不在场，那条线画不出来。
      if (!known.has(one.from) || !known.has(one.to)) return null
      const from = at(one.from)
      const to = at(one.to)
      return <g key={`e${index}`}>
        <line
          x1={from.x} y1={from.y} x2={to.x} y2={to.y}
          stroke="var(--dsw-border-subtle, rgba(127,127,127,0.5))"
          strokeWidth={1.2}
        />
        {one.label === '' ? null : <text
          x={(from.x + to.x) / 2} y={(from.y + to.y) / 2 - 3}
          textAnchor="middle" style={{ fontSize: '9px', fill: 'currentColor', opacity: 0.7 }}
        >{one.label}</text>}
      </g>
    })}
    {[center, ...others].map((name) => {
      const { x, y } = at(name)
      return <g key={name}>
        <rect
          x={x - 31} y={y - 15} width={62} height={30} rx={8}
          fill="var(--dsw-surface-sunken, rgba(127,127,127,0.10))"
          stroke="var(--dsw-border-subtle, rgba(127,127,127,0.28))"
        />
        <text x={x} y={y + 4} textAnchor="middle" style={{ fontSize: '10.5px', fill: 'currentColor' }}>
          {name}
        </text>
      </g>
    })}
  </svg>
}

/**
 * 左栏：这一局的人。
 * @param props - 快照与本地化文案。
 * @returns 三个区块。
 */
function LeftColumn({ snapshot, t }: Locale & { snapshot: RoomSnapshot }) {
  const game = snapshot.game
  const seats = game?.seats ?? []
  const caseEntry = snapshot.cases.find(one => one.id === game?.caseId)
  const roleOf = (seat: string): { name: string; public: string } | undefined =>
    caseEntry?.roles.find(role => role.id === seat) as { name: string; public: string } | undefined

  return <div style={{ padding: '14px 16px' }}>
    <section style={{ marginBottom: '18px' }}>
      <Heading>{t('left.table')}</Heading>
      {seats.length === 0
        ? <div style={{ opacity: 0.6 }}>—</div>
        : seats.map((seat) => {
          const sitting = snapshot.players.find(player => player.seat === seat)
          const mine = seat === game?.humanSeat
          const role = roleOf(seat)
          return <div key={seat} style={{ display: 'flex', alignItems: 'center', gap: '9px', padding: '5px 0' }}>
            <span style={{ opacity: 0.6, width: '20px', fontSize: '11px' }}>{seat}</span>
            {/* 头像按**演员**生成——同一个人换本子还是那张脸。没上桌就没有演员，给个灰块。 */}
            {sitting === undefined
              ? <span style={{ width: '30px', height: '30px', borderRadius: '8px', flex: 'none', background: 'var(--dsw-surface-sunken, rgba(127,127,127,0.12))' }} />
              : <Face id={seat} />}
            <span style={{ flex: 1, minWidth: 0 }}>
              <b>{sitting?.name ?? role?.name ?? seat}</b>
              <span style={{ display: 'block', opacity: 0.65, fontSize: '11.5px' }}>
                {role?.public ?? ''}
              </span>
            </span>
            {mine ? <span style={{ fontSize: '11px', color: 'var(--dsw-accent, #4a7fd4)' }}>{t('left.you')}</span> : null}
          </div>
        })}
    </section>

    <section style={{ marginBottom: '18px' }}>
      <Heading>{t('left.relations')}</Heading>
      {(() => {
        const relations = caseEntry?.relations ?? []
        const victimName = game?.victim?.name ?? ''
        if (relations.length === 0) {
          // 本子没写 relations 时退回人名单：画不出线就老实列人，而不是画一张没有线的"图"。
          return <div style={{ fontSize: '12px' }}>
            {(caseEntry?.roles ?? []).map(role => <div key={role.id} style={{ padding: '2px 0' }}>
              <b>{role.name}</b>
              <span style={{ opacity: 0.65 }}>　{role.public}</span>
            </div>)}
            {caseEntry === undefined ? <div style={{ opacity: 0.6 }}>—</div> : null}
          </div>
        }
        // 图上要出现的人：本子里写过关系的、还有死者。本子提到但不在座位上的名字也画——
        // 那是本子有意提的人（比如只在关系里出现的旧识）。
        const names = [...new Set([
          ...(victimName === '' ? [] : [victimName]),
          ...(caseEntry?.roles ?? []).map(role => role.name),
          ...relations.flatMap(one => [one.from, one.to]),
        ])]
        return <RelationGraph relations={relations} center={victimName} names={names} />
      })()}
    </section>

    <section>
      <Heading>{t('left.timeline')}</Heading>
      {/* 时间线要按座位把每个人说过的时段收集起来，那是一份新数据（界面设计 §5 第 2 条）。
          现在明说它还没接，而不是画一个空的时间线让人以为没人交代过。 */}
      <div style={{ fontSize: '12px', opacity: 0.6 }}>{t('left.nothingSaid')}</div>
    </section>
  </div>
}

/**
 * 中栏：剧本正文 + 当前阶段那一页。
 * @param props - 快照、当前看哪一页、以及切换用的回调。
 * @returns 主区。
 */
function MidColumn({
  snapshot, phase, t,
}: Locale & { snapshot: RoomSnapshot; phase: Phase }) {
  const game = snapshot.game
  const caseEntry = snapshot.cases.find(one => one.id === game?.caseId)
  const human = caseEntry?.roles.find(role => role.player === 'human')

  return <div style={{ maxWidth: '640px', width: '100%', margin: '0 auto', padding: '14px 20px 40px' }}>
    {game?.script !== undefined && game.script !== ''
      // **默认收起**。剧本正文是"偶尔回看"的东西，而它一展开就占满整屏——那样点了阶段页的
      // 人第一屏看到的还是剧本，得往下滚才看见他要看的那一页。（原型里是展开的，那是为了
      // 让人一眼看到全文；真界面上主区该是当前阶段。）
      ? <details style={{
        border: '1px solid var(--dsw-border-subtle, rgba(127,127,127,0.28))',
        borderRadius: '10px',
        background: 'var(--dsw-surface-sunken, rgba(127,127,127,0.06))',
        marginBottom: '14px',
      }}>
        <summary style={{ cursor: 'pointer', padding: '8px 12px', fontSize: '12px', opacity: 0.75, fontWeight: 600 }}>
          {t('mid.script')} · {human?.name ?? ''} {t('mid.scriptHint')}
        </summary>
        <div style={{ padding: '2px 20px 16px', fontSize: '13.5px', lineHeight: 1.95, whiteSpace: 'pre-wrap' }}>
          {game.script}
        </div>
      </details>
      : null}

    <h2 style={{ fontSize: '14px', margin: '0 0 4px', fontWeight: 600 }}>{t(`phase.${phase}`)}</h2>
    <p style={{ opacity: 0.7, fontSize: '12px', margin: '0 0 14px' }}>{leadOf(phase, t)}</p>

    {phase === 'self-intro'
      ? (game?.seats ?? []).map(seat => {
        const sitting = snapshot.players.find(player => player.seat === seat)
        const role = caseEntry?.roles.find(one => one.id === seat)
        return <Card key={seat}>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'baseline' }}>
            <b>{role?.name ?? seat}</b>
            <span style={{ opacity: 0.6, fontSize: '11.5px' }}>
              {sitting === undefined ? t('left.notSeated') : `${t('saidSoFar')} · ${sitting.name}`}
            </span>
          </div>
        </Card>
      })
      : null}

    {phase === 'inquiry'
      ? <Card><div style={{ fontSize: '12.5px', opacity: 0.75 }}>{t('mid.pending')}</div></Card>
      : null}

    {phase === 'search'
      ? (game?.clues ?? []).map(clue => <Card key={clue.id}>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'baseline', marginBottom: '3px' }}>
          <span style={{ fontSize: '11px', opacity: 0.6, border: '1px solid var(--dsw-border-subtle, rgba(127,127,127,0.28))', borderRadius: '5px', padding: '0 5px' }}>
            {clue.id.replace(/^c/, '')}
          </span>
          <b>{clue.title}{clue.dealt ? '' : ` ${t('mid.clueSealed')}`}</b>
        </div>
        <div style={{ fontSize: '12px', opacity: clue.dealt ? 0.85 : 0.5 }}>{clue.text}</div>
      </Card>)
      : null}

    {phase === 'final' || phase === 'reveal'
      ? <Card><div style={{ fontSize: '12.5px', opacity: 0.75 }}>{t('mid.pending')}</div></Card>
      : null}
  </div>
}

/** 每个阶段那一句引导。 */
function leadOf(phase: Phase, t: PropsLocale<'jubensha'>['t']): string {
  switch (phase) {
    case 'self-intro': return t('intro.lead')
    case 'inquiry': return t('inquiry.lead')
    case 'search': return t('search.lead')
    case 'final': return t('final.lead')
    case 'reveal': return t('reveal.lead')
  }
}

/**
 * 没开局时中栏显示的那一区：选本子、排座、拿指令。
 *
 * **排座只是组件状态**：排完就发出去，关掉就该忘——所以它不进 store、也不用端点。
 * 便签才要端点，因为那是要留下来的东西。
 * @param props - 能选的本子、演员池与本地化文案。
 * @returns 开一局那一区。
 */
function OpenGame({ snapshot, t }: Locale & { snapshot: RoomSnapshot }) {
  const [chosen, setChosen] = useState<string | null>(null)
  const [cast, setCast] = useState<Record<string, string>>({})
  const cases = snapshot.cases
  const entry: RoomCase | undefined = cases.find(one => one.id === chosen)
  const assignment = entry === undefined ? [] : entry.roles
    .filter(role => role.player === 'ai')
    .flatMap((role) => {
      const actor = snapshot.actors.find(one => one.id === cast[`${entry.id}:${role.id}`])
      return actor === undefined
        ? []
        : [{ seat: role.id, roleName: role.name, actorId: actor.id, actorName: actor.name }]
    })

  /**
   * 把池子里的人随机分给这一桌的 AI 位子。
   *
   * **整桌重排，不是只补空位**——点「随机」就是要把挑好的换掉；只补空位会让人以为按钮坏了。
   * 用 Fisher-Yates 而不是 `sort(() => Math.random() - 0.5)`：后者不是洗牌，多数引擎下分布偏。
   * @param one - 要给哪个本子排座。
   */
  const shuffle = (one: RoomCase): void => {
    const pool = snapshot.actors.map(actor => actor.id)
    for (let i = pool.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1))
      const held = pool[i]!
      pool[i] = pool[j]!
      pool[j] = held
    }
    const next: Record<string, string> = {}
    one.roles.filter(role => role.player === 'ai').forEach((role, index) => {
      const pick = pool.length === 0 ? undefined : pool[index % pool.length]
      // 池子比座位少时宁可让位子空着，也不让同一个人坐两个位子——一个人演三个角色在物理上
      // 就不可能，而那种排法到了桌上才发现。
      if (pick !== undefined) next[`${one.id}:${role.id}`] = pick
    })
    setCast(next)
  }

  return <div style={{ maxWidth: '640px', width: '100%', margin: '0 auto', padding: '14px 20px 40px' }}>
    <h2 style={{ fontSize: '14px', margin: '0 0 4px', fontWeight: 600 }}>{t('mid.noGame')}</h2>
    <Heading>{t('mid.cases')}</Heading>
    <div style={{ marginTop: '14px' }}>
      {cases.map(one => <div key={one.id} style={{ marginBottom: '8px' }}>
        <label style={{ display: 'flex', gap: '6px', alignItems: 'baseline', cursor: 'pointer' }}>
          <input type="radio" name="jubensha-case" checked={chosen === one.id} onChange={() => setChosen(one.id)} />
          <span>{one.title}（case {one.id}｜{one.genre}）</span>
        </label>
        <div style={{ opacity: 0.65, fontSize: '12px', marginLeft: '20px' }}>
          {one.roles.map(role => `${role.id} ${role.name}`).join(' · ')}
        </div>
        {chosen === one.id
          ? <div style={{ marginLeft: '20px', marginTop: '5px' }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: '9px', marginBottom: '7px' }}>
              <button
                type="button"
                onClick={() => shuffle(one)}
                style={{
                  font: 'inherit', fontSize: '12px', padding: '3px 11px', borderRadius: '7px', cursor: 'pointer',
                  border: '1px solid var(--dsw-accent, #4a7fd4)',
                  background: 'transparent', color: 'var(--dsw-accent, #4a7fd4)',
                }}
              >{t('mid.shuffle')}</button>
              <span style={{ fontSize: '11.5px', opacity: 0.6 }}>{t('mid.shuffleHint')}</span>
            </div>
            {one.roles.filter(role => role.player === 'ai').map(role => <div
              key={role.id}
              style={{ display: 'flex', gap: '6px', alignItems: 'center', marginBottom: '3px' }}
            >
              <span style={{ opacity: 0.6, width: '24px' }}>{role.id}</span>
              <span style={{ flex: 1 }}>{role.name}</span>
              <select
                aria-label={`${role.id} ${role.name}`}
                value={cast[`${one.id}:${role.id}`] ?? ''}
                onChange={(event) => setCast({ ...cast, [`${one.id}:${role.id}`]: event.target.value })}
              >
                <option value="">—</option>
                {snapshot.actors.map(actor => <option
                  key={actor.id}
                  value={actor.id}
                  // 一个演员同一局只能坐一个位子——同一个人演三个角色在物理上就不可能。
                  disabled={Object.entries(cast).some(([key, value]) =>
                    value === actor.id && key !== `${one.id}:${role.id}`)}
                >{actor.name}</option>)}
              </select>
            </div>)}
            {assignment.length > 0
              ? <pre style={{
                margin: '6px 0 0', padding: '6px 8px', maxHeight: '150px', overflow: 'auto',
                background: 'var(--dsw-surface-sunken, rgba(127,127,127,0.10))',
                borderRadius: '8px', fontSize: '11px', lineHeight: 1.5, whiteSpace: 'pre-wrap',
              }}>{openingInstruction(one, assignment)}</pre>
              : null}
          </div>
          : null}
      </div>)}
    </div>
  </div>
}

/**
 * 右栏：桌上说了什么。
 * @param props - 本地化文案与已经读到的那些话。
 * @returns 消息流那一栏。
 */
function RightColumn({ t, said }: Locale & { said: readonly SaidLine[] }) {
  const lines = said.filter(isSaid)
  return <div style={{ padding: '14px 16px' }}>
    <Heading>{t('right.said')}</Heading>
    {lines.length === 0
      ? <div style={{ fontSize: '12px', opacity: 0.7, marginBottom: '10px' }}>{t('right.empty')}</div>
      : <div style={{ marginBottom: '10px' }}>
        {lines.map((line, index) => <div key={`${line.seq}-${index}`} style={{
          padding: '5px 0',
          borderBottom: '1px solid var(--dsw-border-subtle, rgba(127,127,127,0.16))',
        }}>
          <div style={{ fontSize: '11px', opacity: 0.6, marginBottom: '2px' }}>
            {line.from === 'user'
              ? t('right.you')
              // 玩家有两条路进来：直接在座说的，与经 Team 的 send_message 发来的。对读的人来说
              // 都是「玩家」，而 `kind` 这个内部名字不该出现在界面上。
              : line.from === 'agent-message' || line.from === 'team-message'
                ? t('right.player')
                : line.from}
          </div>
          <div style={{ fontSize: '12.5px', lineHeight: 1.7, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
            {line.text}
          </div>
        </div>)}
      </div>}
    <div style={{ borderTop: '1px solid var(--dsw-border-subtle, rgba(127,127,127,0.28))', paddingTop: '10px' }}>
      <div style={{ fontSize: '11.5px', opacity: 0.65 }}>{t('right.composer')}</div>
    </div>
  </div>
}

/**
 * 房间页：三栏。
 *
 * 容器是 `position: relative`——**便签层挂在这上面**（`position: absolute`，坐标相对容器）。
 * 这一条是「切走跟着走、切回来位置不变」的全部实现：不靠算坐标，靠挂载点。
 * @param props - 快照、本地化文案、会话 id 与便签层。
 * @returns 三栏。
 */
export function RoomView({
  snapshot, t, said, notes,
}: Locale & { snapshot: RoomSnapshot; said: readonly SaidLine[]; notes: React.ReactNode }) {
  const [phase, setPhase] = useState<Phase>(
    PHASES.includes(snapshot.game?.phase as Phase) ? snapshot.game?.phase as Phase : 'self-intro',
  )

  return <div data-jubensha-room="" style={{ position: 'relative', minHeight: '100%' }}>
    <div style={{ display: 'flex', gap: '4px', padding: '10px 20px 8px', flexWrap: 'wrap' }}>
      {PHASES.map(one => <button
        key={one}
        type="button"
        onClick={() => setPhase(one)}
        style={{
          display: 'flex', alignItems: 'center', gap: '6px',
          font: 'inherit', fontSize: '12px', padding: '3px 8px', borderRadius: '7px', cursor: 'pointer',
          border: 'none',
          background: phase === one ? 'var(--dsw-surface-sunken, rgba(127,127,127,0.12))' : 'transparent',
          color: 'inherit',
          fontWeight: phase === one ? 600 : 400,
          opacity: phase === one ? 1 : 0.6,
        }}
      >{t(`phase.${one}`)}</button>)}
    </div>

    <div style={{
      display: 'grid',
      gridTemplateColumns: '286px minmax(0,1fr) 366px',
      alignItems: 'start',
    }}>
      <div style={{ borderRight: '1px solid var(--dsw-border-subtle, rgba(127,127,127,0.28))' }}>
        <LeftColumn snapshot={snapshot} t={t} />
      </div>
      <div>
        {snapshot.game === null
          ? <OpenGame snapshot={snapshot} t={t} />
          : <MidColumn snapshot={snapshot} phase={phase} t={t} />}
      </div>
      <div style={{ borderLeft: '1px solid var(--dsw-border-subtle, rgba(127,127,127,0.28))' }}>
        <RightColumn t={t} said={said} />
      </div>
    </div>

    {notes}
  </div>
}
