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
import { Fragment, useState } from 'react'
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
    boxSizing: 'border-box',
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
/**
 * 人物关系：**中心一行，其余每行一个**。
 *
 * 前后试过两版图形布局，都撞：
 * · 正圆星形（中心在正中、其余按角度均分）——半径一大就出界、一小就重叠，中间没有可调的空档；
 * · 错开的树形（中心在上、其余两列往下走）——四条线的标签全落在中心附近那一小片，堆成一团。
 *
 * 根因是**这块地方只有 258px 宽**：「一个中心 + 四个节点 + 四条带字的连线」在这个宽度里无论
 * 怎么排都会打架——图上要放的东西比地方多。所以换掉图形，改成列表：一行一个人，名字在左、
 * 关系在右。它读起来仍然是「**其余每个人都是与他的关系**」，而那个意思原本就该由列表承担，
 * 用不着靠几何去表达。
 *
 * @param props - 关系列表、中心那个人、以及本子里所有角色名。
 * @returns 关系表。
 */
function RelationGraph({ relations, center, names, t }: Locale & {
  relations: readonly RoomCaseRelation[]
  center: string
  names: readonly string[]
}) {
  // 以中心那一端为轴分三类：他指向别人的、别人指向他的、以及不经过他的。前两类同一种读法，
  // 第三类单独列——**不能因为它没连到中心就不画**，那也是关系。
  const arms: { who: string, label: string }[] = []
  const between: RoomCaseRelation[] = []
  for (const one of relations) {
    if (one.from === center) arms.push({ who: one.to, label: one.label })
    else if (one.to === center) arms.push({ who: one.from, label: one.label })
    else between.push(one)
  }
  // 本子里写了关系、而那个人不在这一桌（比如死者本人）——那种也画一条，不去补空节点。
  // 反过来，本子里**没给某个人写关系**时也得把他列出来：漏一个人比少一条关系更让人摸不着头。
  const listed = new Set(arms.map(one => one.who))
  const missing = names.filter(one => one !== center && !listed.has(one))

  const row = (who: string, label: string, key: string) =>
    <div key={key} style={{ display: 'flex', gap: '8px', alignItems: 'baseline', minHeight: '22px' }}>
      {/* 一条竖线 + 一个小横杠连到名字上——比画 SVG 省地方，而「挂在中心下面」这层意思还在。 */}
      <span aria-hidden style={{
        width: '12px', flexShrink: 0, alignSelf: 'stretch', position: 'relative',
        borderLeft: '1px solid var(--dsw-border-subtle, rgba(127,127,127,0.38))',
      }}>
        <span style={{
          position: 'absolute', left: 0, top: '11px', width: '9px', height: '1px',
          background: 'var(--dsw-border-subtle, rgba(127,127,127,0.38))',
        }} />
      </span>
      <span style={{ fontSize: '11.5px', fontWeight: 500, flexShrink: 0, minWidth: '44px' }}>{who}</span>
      {label === ''
        ? <span style={{ fontSize: '10.5px', opacity: 0.45, fontStyle: 'italic' }}>{t('left.relationMissing')}</span>
        : <span style={{ fontSize: '10.5px', opacity: 0.68, lineHeight: 1.35 }}>{label}</span>}
    </div>

  return <div>
    <div style={{
      display: 'inline-flex', alignItems: 'center',
      padding: '3px 10px', borderRadius: '8px', marginBottom: '2px',
      background: 'var(--dsw-surface-sunken, rgba(127,127,127,0.14))',
      fontSize: '11.5px', fontWeight: 600,
    }}>{center}</div>
    {relations.length === 0 && names.length <= 1
      ? <div style={{ fontSize: '11px', opacity: 0.6, marginTop: '4px' }}>{t('left.noRelations')}</div>
      : <div style={{ marginTop: '1px' }}>
        {arms.map((one, index) => row(one.who, one.label, `a${index}`))}
        {missing.map((one, index) => row(one, '', `m${index}`))}
      </div>}
    {between.length > 0 && <div style={{ marginTop: '6px' }}>
      <div style={{ fontSize: '10px', opacity: 0.5, marginBottom: '2px' }}>{t('left.between')}</div>
      {between.map((one, index) => row(`${one.from} · ${one.to}`, one.label, `b${index}`))}
    </div>}
  </div>
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

  return <div style={{ padding: '14px 16px', boxSizing: 'border-box' }}>
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
        return <RelationGraph relations={relations} center={victimName} names={names} t={t} />
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

  return <div style={{
    // `boxSizing` 必须写：`width: 100%` 加 `padding: 20px` 在默认的 `content-box` 下总宽是
    // 「容器宽 + 40px」，窄屏上那 40px 就是溢出——它会盖到隔壁栏上去，看着像别人的内容压过来。
    maxWidth: '640px', width: '100%', margin: '0 auto', padding: '14px 20px 40px',
    boxSizing: 'border-box',
  }}>
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

  return <div style={{
    // 同 `MidColumn`：`width: 100%` 与 `padding` 一起出现时必须有 `boxSizing`，否则多出的
    // padding 会把这一栏顶出轨道。
    maxWidth: '640px', width: '100%', margin: '0 auto', padding: '14px 20px 40px',
    boxSizing: 'border-box',
  }}>
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
                borderRadius: '8px', fontSize: '11px', lineHeight: 1.5,
                // `pre-wrap` 只在空格处断行，而这段里最长的一行是个没有空格的 Windows 路径——
                // 不 `break-all` 它就横着撑破中栏。`maxWidth` 是跟 `overflow: auto` 一起用的：
                // 真遇到断不开的东西（比如一个超长英文单词）时给横向滚动，而不是让整页变宽。
                whiteSpace: 'pre-wrap', wordBreak: 'break-all', maxWidth: '100%',
                boxSizing: 'border-box',
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
function RightColumn({ t, said, started }: Locale & { said: readonly SaidLine[], started: boolean }) {
  const lines = said.filter(isSaid)
  return <div style={{ padding: '14px 16px', boxSizing: 'border-box' }}>
    <Heading>{t('right.said')}</Heading>
    {!started && lines.length > 0
      ? <div style={{ fontSize: '11.5px', opacity: 0.6, marginBottom: '8px', lineHeight: 1.5 }}>
        {t('right.notStarted')}
      </div>
      : null}
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
  // 宿主说现在走到哪一步。客户端**不自己记进度**——进度是局面的一部分，而局面在宿主那儿。
  const live: Phase = PHASES.includes(snapshot.game?.phase as Phase)
    ? snapshot.game?.phase as Phase
    : PHASES[0]
  const reached = snapshot.game === null ? -1 : PHASES.indexOf(live)
  // 回看：点了已经走过的哪一步，中栏就停在那儿；不点就跟着宿主走。
  const [peek, setPeek] = useState<Phase | null>(null)
  const shown = peek ?? live

  return <div data-jubensha-room="" style={{
    position: 'relative',
    // 高度定在**这一层**，减掉的两个数都是量出来的：
    // · 118 = 顶部两条栏（标签栏 + 标题栏）——窗口 873 减滚动容器 755；
    // · 128 = 下面那个输入框的占位（`.composerSeat`，实测高 128）。**它在滚动容器内部**，
    //   所以不扣掉它，整页就还能往下滚 128px；滚到底时上面那截被推出视野——表现就是
    //   「三栏各自滚了，而整页还能滚，且顶部被切掉一块」。
    // 上面那行阶段按钮（40px）不用单独扣：根做 flex 列，三栏那一层吃剩下的。
    height: 'calc(100vh - 246px)',
    display: 'flex',
    flexDirection: 'column',
  }}>
    {/* 阶段条。**没开局就整条不出现**——那时没有阶段可言，摆一条能点的横排只会让人以为
        自己漏了什么（用户提的就是这个）。走到哪亮到哪，而只有**已经走过的**能点：那一下是
        「回看」，不是「跳步」。没走到的点不动——否则可以一开局就点「复盘」，把整局推理跳掉。 */}
    {reached >= 0 && <div style={{
      display: 'flex', alignItems: 'center', gap: '0',
      padding: '10px 20px 8px',
    }}>
      {PHASES.map((one, index) => {
        const done = index < reached
        const now = index === reached
        const canPeek = index <= reached
        return <Fragment key={one}>
          {index > 0 && <div style={{
            width: '18px', height: '1px', flexShrink: 0,
            background: index <= reached
              ? 'var(--dsw-text-secondary, rgba(127,127,127,0.85))'
              : 'var(--dsw-border-subtle, rgba(127,127,127,0.28))',
          }} />}
          <button
            type="button"
            disabled={!canPeek}
            onClick={() => setPeek(one === live ? null : one)}
            title={canPeek ? undefined : t('step.notYet')}
            style={{
              display: 'flex', alignItems: 'center', gap: '6px',
              font: 'inherit', fontSize: '12px',
              padding: '3px 8px', borderRadius: '7px',
              border: 'none', background: shown === one && canPeek
                ? 'var(--dsw-surface-sunken, rgba(127,127,127,0.12))'
                : 'transparent',
              color: 'inherit',
              fontWeight: now ? 600 : 400,
              opacity: canPeek ? 1 : 0.35,
              cursor: canPeek ? 'pointer' : 'default',
            }}
          >
            <span aria-hidden style={{
              width: '7px', height: '7px', borderRadius: '50%', flexShrink: 0,
              boxSizing: 'border-box',
              // 走过的：实心。当前：实心 + 一圈。没走到：空心。
              background: index <= reached ? 'currentColor' : 'transparent',
              border: index <= reached ? 'none' : '1px solid currentColor',
              boxShadow: now ? '0 0 0 3px var(--dsw-surface-sunken, rgba(127,127,127,0.22))' : 'none',
              opacity: done ? 0.55 : 1,
            }} />
            {t(`phase.${one}`)}
          </button>
        </Fragment>
      })}
      {peek !== null && <button
        type="button"
        onClick={() => setPeek(null)}
        style={{
          font: 'inherit', fontSize: '11.5px', marginLeft: '10px', padding: '3px 8px',
          borderRadius: '7px', cursor: 'pointer', border: 'none', background: 'transparent',
          color: 'inherit', opacity: 0.6, textDecoration: 'underline',
        }}
      >{t('step.backToNow')}</button>}
    </div>}

    <div style={{
      display: 'grid',
      // **三栏各自滚动，页面本身不动。**
      //
      // 高度必须自己定：这个 slot 外面那层是 `flex: 1 0 auto`（实测 `viewArea`），它按内容长、
      // 不会缩——所以 `height: 100%` 拿到的是「内容有多高就是多高」，等于没定。而那 118px 是
      // 顶部两条栏（标签栏 + 标题栏）实测的高度：滚动容器实测 702，窗口 820。
      //
      // 两侧栏的 min 也要给：grid 会先让它们吃满各自的 `max`，中栏只能捡剩下的——1024 视口下
      // 中栏被压到一百多像素、文字竖着排。给它一个实在的下限（300），两侧才肯缩。
      gridTemplateColumns: 'minmax(150px, 286px) minmax(300px, 1fr) minmax(190px, 366px)',
      // 吃根剩下的高度（根定的是 `calc(100vh - 118px)`）。`minHeight: 0` 是必需的：
      // flex 子项默认 `min-height: auto`，不给它就会被内容顶开、又变回「跟着内容长」。
      flex: 1,
      minHeight: 0,
    }}>
      <div style={{
        // grid 子项默认 `min-width/min-height: auto`，内容一长就把轨道撑破——`minmax` 只让轨道
        // 能缩，挡不住子项自己溢出。三栏都要标这两句，再配 `overflowY`。
        minWidth: 0, minHeight: 0, overflowY: 'auto',
        borderRight: '1px solid var(--dsw-border-subtle, rgba(127,127,127,0.28))',
      }}>
        <LeftColumn snapshot={snapshot} t={t} />
      </div>
      <div style={{ minWidth: 0, minHeight: 0, overflowY: 'auto' }}>
        {snapshot.game === null
          ? <OpenGame snapshot={snapshot} t={t} />
          : <MidColumn snapshot={snapshot} phase={shown} t={t} />}
      </div>
      <div style={{
        minWidth: 0, minHeight: 0, overflowY: 'auto',
        borderLeft: '1px solid var(--dsw-border-subtle, rgba(127,127,127,0.28))',
      }}>
        <RightColumn t={t} said={said} started={snapshot.game !== null} />
      </div>
    </div>

    {notes}
  </div>
}
