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
import { Fragment, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { RoomCase, RoomCaseRelation, RoomSnapshot } from '../room-types.ts'
import { avatarShape, avatarSvg } from '../avatar.ts'
import { fillComposer } from './hidden-entry.ts'
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

/**
 * 这一句是谁说的——**座位号的唯一推导处**。
 *
 * 这个函数是被一次真事逼出来的：原先「这一句是谁说的」在三处各写了一遍（气泡底色、问话页
 * 分组、投票页统计），而其中两遍是这样的——
 *
 * ```ts
 * const seat = line.who === undefined ? null : line.who.split('-')[0] ?? null
 * if (seat === null) continue
 * ```
 *
 * **它把真人整个跳过了。** 真人的发言没有 Team 信封，所以 `who` 是 `undefined`——于是那两处
 * 把他认成「入不了座位的发言」而丢掉。症状：问话页显示「林默 还没出过声」，而他明明说了两段
 * （用户 2026-10-06 报的）。
 *
 * **这是同一个 gap 的第四次浮现**：`players` 那张表里从来没有真人（他是人，不是我们 spawn 的
 * teammate），而每个直接遍历它的读者都会漏掉他。前三次是：DM 自己把局跑完、真人头像渲染成
 * 灰块、自述页写「还没上桌」。所以修法不是在每个读者那里补一句，而是**只留一个推导处**。
 *
 * @param line - 桌上的一句话。
 * @param humanSeat - 真人的座位号（局面里的 `humanSeat`）；没有局面时传 `undefined`。
 * @returns 座位号；认不出来（注入、背景子代理）时是空串。
 */
function seatOf(line: SaidLine, humanSeat: string | undefined): string {
  if (line.who !== undefined) return line.who.split('-')[0] ?? ''
  return line.from === 'user' ? (humanSeat ?? '') : ''
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
 * 登录头像——页面上左下角那个。
 *
 * **从页面上读，而不是去问某个服务。** 那个 URL 归 DSH 的账户插件管，而它的读取口
 * （`useAccount`）是 provide 给「设置」那一处的 hook——别的插件拿不到，`AccountProfile`
 * 又是客户端与宿主之间那条链上的东西。页面上那枚元素于是成了它唯一的公开呈现，判据是 `src`
 * 里那段 `user-avatar`：那是 DeepSeek 的头像地址，不随布局改。
 *
 * 读不到就给 `undefined`，调用方退回按 id 生成的那张脸（那是缺省行为）。
 * @returns 头像 URL；没登录、或者页面还没把它渲染出来时给 `undefined`。
 */
function loginAvatar(): string | undefined {
  const image = document.querySelector<HTMLImageElement>('img[src*="user-avatar"]')
  const src = image?.src
  return src === undefined || src === '' ? undefined : src
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
/** 大图上一个人：名字、一句身份、是不是你、是不是死者。 */
interface Person {
  readonly name: string
  readonly blurb: string
  readonly mine: boolean
  readonly dead: boolean
}

/**
 * 放大后的关系图：**连线图**。这一层才有画它的地方。
 *
 * 缩略（左栏那 258px）用列表，点开之后弹窗给足空间——连线图那套本来就需要宽度：节点摆在四角、
 * 标签写在线旁，而这两样都要地方。原型画的就是这个（`docs/设计/原型/房间-原型.html`），当时
 * 画得对是因为它假定标签只有两三个字；在弹窗里那个假定重新成立——四个标签各占一方，互不相干。
 *
 * @param props - 关系、中心那个人、以及关闭回调。
 * @returns 遮罩 + 弹窗。
 */
function RelationDialog({ relations, center, people, onClose, t }: Locale & {
  relations: readonly RoomCaseRelation[]
  center: string
  people: readonly Person[]
  onClose: () => void
}) {
  // Esc 也关。监听挂在 document 上，因为焦点不一定在弹窗里。
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => { if (event.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const width = 660
  const height = 470
  const midX = width / 2
  const midY = height / 2
  /** 四角。角上空间最大，而标签就写在从中心过去的路途中。 */
  const corners = [
    { x: 92, y: 78 },
    { x: width - 92, y: 72 },
    { x: 82, y: height - 74 },
    { x: width - 82, y: height - 80 },
  ]
  // 关系的两端都出现在这本子里才画。顺序按 relations 自己的顺序，好让角上的位置稳定。
  const ends: string[] = []
  for (const one of relations) {
    if (one.from === center && !ends.includes(one.to)) ends.push(one.to)
    else if (one.to === center && !ends.includes(one.from)) ends.push(one.from)
  }
  const at = (name: string): { x: number, y: number } => {
    if (name === center) return { x: midX, y: midY }
    const index = ends.indexOf(name)
    return index < 0 ? { x: midX, y: midY } : corners[index % corners.length] ?? corners[0]!
  }

  return <div
    // 点遮罩关掉。`role="presentation"` 是给静态检查看的：它只接点击，不是控件。
    role="presentation"
    onClick={onClose}
    style={{
      position: 'fixed', inset: 0, zIndex: 60,
      background: 'rgba(0,0,0,0.42)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      // 从缩略那边「长出来」的感觉：遮罩淡入、弹窗放大到 1。
      animation: 'jubensha-fade 140ms ease-out',
    }}
  >
    <style>{`
      @keyframes jubensha-fade { from { opacity: 0 } to { opacity: 1 } }
      @keyframes jubensha-grow { from { opacity: 0; transform: scale(0.88) } to { opacity: 1; transform: scale(1) } }
    `}</style>
    <div
      role="dialog"
      aria-label={t('left.relations')}
      onClick={event => event.stopPropagation()}
      style={{
        width: `min(${width + 48}px, 94vw)`,
        maxHeight: '88vh', overflow: 'auto',
        background: 'var(--dsw-surface, #fff)',
        borderRadius: '14px',
        boxShadow: '0 18px 60px rgba(0,0,0,0.32)',
        padding: '16px 24px 20px',
        boxSizing: 'border-box',
        animation: 'jubensha-grow 170ms cubic-bezier(0.2, 0.9, 0.3, 1)',
      }}
    >
      <div style={{
        display: 'flex', alignItems: 'baseline', justifyContent: 'space-between',
        marginBottom: '4px',
      }}>
        <div style={{ fontSize: '13px', fontWeight: 600 }}>{t('left.relations')}</div>
        <button
          type="button"
          onClick={onClose}
          style={{
            font: 'inherit', fontSize: '12px', padding: '3px 10px', borderRadius: '7px',
            cursor: 'pointer', border: '1px solid var(--dsw-border-subtle, rgba(127,127,127,0.3))',
            background: 'transparent', color: 'inherit',
          }}
        >{t('common.close')}</button>
      </div>
      <svg viewBox={`0 0 ${width} ${height}`} style={{ width: '100%', height: 'auto', display: 'block' }}>
        {relations.map((one, index) => {
          const from = at(one.from)
          const to = at(one.to)
          return <line
            key={`e${index}`}
            x1={from.x} y1={from.y} x2={to.x} y2={to.y}
            stroke="var(--dsw-border-subtle, rgba(127,127,127,0.45))"
            strokeWidth={1.3}
          />
        })}
        {/* 标签画在线的**靠中心那一头**（0.38 处）——那一段是从中心散开的地方，四个方向彼此
            分开得最彻底，所以四条标签各占一方。这正是 258px 里做不到、而这里做得到的事。 */}
        {relations.map((one, index) => {
          const from = at(one.from)
          const to = at(one.to)
          const px = from.x + (to.x - from.x) * 0.38
          const py = from.y + (to.y - from.y) * 0.38
          return <text
            key={`l${index}`}
            x={px} y={py} textAnchor="middle"
            style={{
              fontSize: '10.5px', fill: 'currentColor', opacity: 0.72,
              // 描边把线遮断，标签读起来是「贴在线上的一句话」而不是「被线划掉的字」。
              paintOrder: 'stroke', stroke: 'var(--dsw-surface, #fff)', strokeWidth: '4px',
              strokeLinejoin: 'round',
            }}
          >{one.label}</text>
        })}
        {/* 节点用 `foreignObject` 装 HTML，而不是 `<text>`——因为身份是一句会换行的话，而 SVG 的
            `text` 不自动折行。这里要的是「名字一行、身份一行」，正好是 HTML 的本行。 */}
        {[center, ...ends].map(name => {
          const { x, y } = at(name)
          const isCenter = name === center
          const person = people.find(one => one.name === name)
          const boxW = isCenter ? 156 : 172
          const boxH = isCenter ? 46 : 50
          return <foreignObject
            key={name}
            x={x - boxW / 2} y={y - boxH / 2} width={boxW} height={boxH}
          >
            <div style={{
              width: '100%', height: '100%', boxSizing: 'border-box',
              display: 'flex', flexDirection: 'column', justifyContent: 'center',
              padding: '5px 10px', borderRadius: '10px',
              // **底色必须不透明。** 连线画到的是节点中心，所以它必然伸进卡片里一半；底色
              // 半透明时那条线会透出来，看着像「线穿过了卡片」（用户报的）。层次改用边框加
              // 阴影来表达，而不靠透明度——中心那张靠字体加粗与边框加深来突出。
              background: 'var(--dsw-surface, #fff)',
              border: isCenter
                ? '1px solid var(--dsw-border-strong, rgba(127,127,127,0.5))'
                : '1px solid var(--dsw-border-subtle, rgba(127,127,127,0.3))',
              boxShadow: isCenter
                ? '0 2px 8px rgba(0,0,0,0.13)'
                : '0 1px 3px rgba(0,0,0,0.08)',
              textAlign: 'center', overflow: 'hidden',
            }}>
              <div style={{ fontSize: isCenter ? '12.5px' : '12px', fontWeight: 600, lineHeight: 1.3 }}>
                {name}
                {person?.mine === true
                  ? <span style={{ marginLeft: '5px', fontSize: '10px', fontWeight: 400, color: 'var(--dsw-accent, #4a7fd4)' }}>{t('left.you')}</span>
                  : null}
                {person?.dead === true
                  ? <span style={{ marginLeft: '5px', fontSize: '10px', fontWeight: 400, opacity: 0.55 }}>{t('left.dead')}</span>
                  : null}
              </div>
              {person === undefined || person.blurb === '' ? null : <div style={{
                fontSize: '9.5px', opacity: 0.62, lineHeight: 1.28, marginTop: '2px',
                // 身份长就让它折行；折不下就截——大图的价值在「一眼看清谁是谁」，不是把每句读完。
                overflow: 'hidden', display: '-webkit-box',
                WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
              }}>{person.blurb}</div>}
            </div>
          </foreignObject>
        })}
      </svg>
    </div>
  </div>
}

/**
 * 人物关系：**缩略一行一个，点开是连线图**。
 *
 * 试过三版图形布局都撞（正圆星形、错开的树形、以及把标签挪来挪去）——根因是**地方不够**：
 * 这块只有 258px 宽，「一个中心 + 四个节点 + 四条带字的连线」在这个宽度里无论怎么排都会打架。
 *
 * 用户给的解法比我的三版都好：**缩略用列表、点开弹窗画连线图**——「就像缩略图和原图的关系」。
 * 于是两件事各自成立：列表在窄栏里好读、而连线图拿到足够宽度之后才能画（原型那套本来就需要
 * 宽度，它的标签假定是两三个字）。
 *
 * @param props - 关系列表、中心那个人、以及本子里所有角色名。
 * @returns 关系表（可点开）。
 */
function RelationGraph({ relations, center, names, people, t }: Locale & {
  relations: readonly RoomCaseRelation[]
  center: string
  names: readonly string[]
  people: readonly Person[]
}) {
  const [expanded, setExpanded] = useState(false)  // 以中心那一端为轴分三类：他指向别人的、别人指向他的、以及不经过他的。前两类同一种读法，
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
  // 弹窗里画得下才给它入口：一条关系都没有时点开也没东西看。
  const canExpand = relations.length > 0

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

  const body = <>
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
  </>

  if (!canExpand) return <div>{body}</div>

  return <div>
    <button
      type="button"
      onClick={() => setExpanded(true)}
      title={t('left.expandHint')}
      style={{
        // 整块可点，而外观仍像原来的那张表——只在鼠标经过时给一点反馈。
        display: 'block', width: '100%', textAlign: 'left',
        font: 'inherit', color: 'inherit', cursor: 'zoom-in',
        padding: '4px 6px 6px', margin: '-4px -6px -6px',
        borderRadius: '9px', border: 'none', background: 'transparent',
      }}
      onMouseEnter={event => { event.currentTarget.style.background = 'var(--dsw-surface-sunken, rgba(127,127,127,0.08))' }}
      onMouseLeave={event => { event.currentTarget.style.background = 'transparent' }}
    >{body}</button>
    <div style={{ fontSize: '10px', opacity: 0.45, marginTop: '4px' }}>{t('left.expandHint')}</div>
    {expanded && <RelationDialog
      relations={relations} center={center} people={people} t={t}
      onClose={() => setExpanded(false)}
    />}
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
    {/* 现场：谁死了、怎么死的、大概是几点。
        放在最上面，因为这是开局就该知道的事——原先它只在「搜证」页的线索卡里间接露面，
        而玩家读到「后脑撞在工位隔断的金属包边上」时已经问了三轮话（用户 2026-10-06 报的：
        「关于韩松死亡和验尸的描述，我没有在事件背景或搜证里看到」）。 */}
    {game?.victim == null ? null : <section style={{ marginBottom: '18px' }}>
      <Heading>{t('left.scene')}</Heading>
      <div style={{ fontSize: '12px', lineHeight: 1.6 }}>
        <b>{game.victim.name}</b>
        {game.victim.age === 0 ? null : <span style={{ opacity: 0.65 }}>　{game.victim.age} 岁</span>}
        {game.victim.cause === ''
          ? null
          : <div style={{ opacity: 0.85, marginTop: '2px' }}>{game.victim.cause}</div>}
        {game.victim.timeWindow.length < 2
          ? null
          : <div style={{ opacity: 0.65, fontSize: '11.5px', marginTop: '3px' }}>
            {t('left.deathWindow')}　{game.victim.timeWindow.join(' – ')}
          </div>}
      </div>
    </section>}

    <section style={{ marginBottom: '18px' }}>
      <Heading>{t('left.table')}</Heading>
      {seats.length === 0
        ? <div style={{ opacity: 0.6 }}>—</div>
        : seats.map((seat) => {
          const sitting = snapshot.players.find(player => player.seat === seat)
          const mine = seat === game?.humanSeat
          const role = roleOf(seat)
          // 这一刻的状态。**它优先于「还没上桌」那三个字**：正在上桌、上桌失败、此刻在生成
          // ——三样都比一句静态的话有信息。没开团队时这一份是空的，那就退回原来的显示。
          const row = snapshot.table.find(one => one.seat === seat)
          const status = row === undefined
            ? undefined
            : row.phase === 'provisioning'
              ? { text: t('left.provisioning'), busy: false }
              : row.phase === 'failed'
                ? { text: t('left.seatFailed'), busy: false }
                : row.running
                  ? { text: t('left.thinking'), busy: true }
                  : undefined
          return <div key={seat} style={{ display: 'flex', alignItems: 'center', gap: '9px', padding: '5px 0' }}>
            <span style={{ opacity: 0.6, width: '20px', fontSize: '11px' }}>{seat}</span>
            {/* 头像按**演员**生成——同一个人换本子还是那张脸。没上桌就没有演员，给个灰块。
                **真人那位用他自己登录的头像**：这一栏是「谁坐在那儿」，而他就是你。
                判据是 `mine` 而不是 `sitting`——`players` 表里只有 spawn 过的 AI，真人从来不在
                里面，照着它判会把真人位永远画成灰块。 */}
            {mine
              ? <Face id={seat} avatar={loginAvatar()} />
              : sitting === undefined
                ? <span style={{ width: '30px', height: '30px', borderRadius: '8px', flex: 'none', background: 'var(--dsw-surface-sunken, rgba(127,127,127,0.12))' }} />
                : <Face id={seat} />}
            <span style={{ flex: 1, minWidth: 0 }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                {/* 名字用这个座位的色——与他的头像、他在中间那一栏的气泡同一个色。 */}
                <b style={{
                  padding: '0 6px', borderRadius: '5px',
                  background: mine ? tintOf(seat, 0.24) : tintOf(seat, 0.18),
                }}>{sitting?.name ?? role?.name ?? seat}</b>
                {status === undefined
                  ? null
                  : <span style={{ fontSize: '10.5px', opacity: 0.75, display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                    {/* 「正在想」给一个呼吸的圆点——那一栏里唯一会自己变的东西值得一个亮点，
                        而其余两种状态是静止的，不抢眼。 */}
                    {status.busy
                      ? <span aria-hidden style={{
                        width: '5px', height: '5px', borderRadius: '50%', flex: 'none',
                        background: 'var(--dsw-accent, #4a7fd4)',
                        animation: 'jubensha-breathe 1.4s ease-in-out infinite',
                      }} />
                      : null}
                    {status.text}
                  </span>}
              </span>
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
        // 每个人带一句身份——那正是「这一桌」里那几行 `public`。小图上只有名字与关系，
        // 谁是谁要回左栏去对；放进大图才看得全（用户提的）。
        const people = [
          ...seats.map((seat) => {
            const role = roleOf(seat)
            return {
              name: role?.name ?? seat,
              blurb: role?.public ?? '',
              mine: seat === game?.humanSeat,
              dead: false,
            }
          }),
          // 死者的身份栏留空：名字旁边那个「死者」标记已经说完了这件事，再写一遍就是同一句
          // 话出现在两行里（第一版就是这样，图上「周明远 死者 / 死者」）。
          ...(victimName === '' ? [] : [{
            name: victimName, blurb: '', mine: false, dead: true,
          }]),
        ]
        return <RelationGraph
          relations={relations} center={victimName} names={names}
          people={people} t={t}
        />
      })()}
    </section>

    <section>
      <Heading>{t('left.timeline')}</Heading>
      {(() => {
        const rows = [...(game?.timeline ?? [])].sort((left, right) =>
          left.at.localeCompare(right.at, 'en'))
        // 还没交代的人：这一栏真正有用的地方是它——谁回避了自己那段时间，一眼看得出来。
        const silent = seats.filter(seat => !rows.some(one => one.seat === seat))
        if (rows.length === 0) {
          return <div style={{ fontSize: '12px', opacity: 0.6 }}>{t('left.nothingSaid')}</div>
        }
        return <>
          {rows.map((one, index) => <div key={`${one.at}-${one.seat}-${index}`} style={{
            display: 'flex', gap: '7px', alignItems: 'baseline', padding: '3px 0',
            borderTop: index === 0 ? 'none' : '1px solid var(--dsw-border-subtle, rgba(127,127,127,0.14))',
          }}>
            <span style={{ fontSize: '11px', opacity: 0.65, flexShrink: 0, minWidth: '38px' }}>{one.at}</span>
            <span style={{ fontSize: '11.5px', fontWeight: 500, flexShrink: 0, minWidth: '42px' }}>
              {roleOf(one.seat)?.name ?? one.seat}
            </span>
            <span style={{ fontSize: '11.5px', opacity: 0.85, lineHeight: 1.5 }}>{one.doing}</span>
          </div>)}
          {silent.length === 0
            ? null
            : <div style={{ fontSize: '11px', opacity: 0.55, marginTop: '6px' }}>
              {t('left.timelineSilent')}　{silent.map(seat => roleOf(seat)?.name ?? seat).join('、')}
            </div>}
        </>
      })()}
    </section>
  </div>
}

/**
 * 房间根该多高——**量出来，不是算常数**。
 *
 * 这一段是「父容器的高度依赖我、我的高度依赖父容器」那个死循环的出口。父容器
 * `.AMI9gG_viewArea` 是 `flex: 1 0 auto`——`basis: auto` 加 `shrink: 0`，意思是「我要内容那么高」，
 * 而它的内容就是这个房间；房间里三栏摊开一万多像素。纯 CSS 里两边都等对方先说，浏览器只能取
 * 「内容的高」，于是整页滚。
 *
 * 所以从这里问一个**不依赖父容器**的数：滚动容器 `.AMI9gG_scrollBody` 的高是确定的（它的
 * 上面几层都是 `flex: 1 1 0%`，一路到有确定高度的根），减掉我在它里面的位置、再减掉底下
 * composer 那一段——**而那一段正是 `ask_user_question` 的卡片会撑高的地方**，也就是用户报的那
 * 两次滚动的来源（2026-10-06）。
 *
 * @param root - 房间根元素。
 * @returns 可用的高（像素）；量不出来时给 `null`，调用方退回一个保守值。
 */
function measureRoomHeight(root: HTMLElement): number | null {
  const scroll = root.closest('[class*="scrollBody"]')
  if (scroll === null) return null
  const scrollBox = scroll.getBoundingClientRect()
  if (scrollBox.height <= 0) return null
  const above = root.getBoundingClientRect().top - scrollBox.top
  const seat = scroll.querySelector('[class*="composerSeat"]')
  const below = seat === null ? 0 : scrollBox.bottom - seat.getBoundingClientRect().top
  // 240 是下限：再矮就三栏都看不见东西了，那时候宁可让整页滚一下。
  return Math.max(240, Math.round(scrollBox.height - above - below))
}

/**
 * 房间根，按量出来的高度撑开。
 *
 * 首次渲染还没有量过的值时给一个保守的常数——`useLayoutEffect` 在绘制前就会把它换成真值，
 * 所以那一帧用户看不见。
 *
 * ref 用回调式而不是 `useRef`：这个项目的 `@types/react` 把 `useRef<T>(null)` 定成
 * `RefObject<T | null>`，而 `ref` 属性在它那份声明里只收 `RefObject<T>`，两者对不上。
 * @returns 挂到根上的 ref 与当下的高度。
 */
function useRoomHeight(): { ref: (node: HTMLDivElement | null) => void, height: number | null } {
  const [root, setRoot] = useState<HTMLDivElement | null>(null)
  const [height, setHeight] = useState<number | null>(null)
  useLayoutEffect(() => {
    if (root === null) return undefined
    const measure = (): void => {
      const next = measureRoomHeight(root)
      if (next !== null) setHeight(next)
    }
    measure()
    // composer 那一段变高（弹窗）、窗口缩放、侧栏折叠——都会改变可用空间，所以两个都看着。
    const scroll = root.closest('[class*="scrollBody"]')
    const observer = new ResizeObserver(measure)
    observer.observe(scroll ?? root)
    const seat = scroll?.querySelector('[class*="composerSeat"]')
    if (seat !== null && seat !== undefined) observer.observe(seat)
    return () => observer.disconnect()
  }, [root])
  return { ref: setRoot, height }
}

/**
 * 中栏：剧本正文 + 当前阶段那一页。
 * @param props - 快照、当前看哪一页、以及切换用的回调。
 * @returns 主区。
 */
function PhaseColumn({
  snapshot, phase, said, t,
}: Locale & { snapshot: RoomSnapshot, phase: Phase, said: readonly SaidLine[] }) {
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
        // **真人那一位不适用 `players` 表**：那张表只装 spawn 过的 AI，真人从来不在里面——
        // 照它判会把他显示成「还没上桌」，而他从一开始就坐在那儿（用户 2026-10-06 报的：
        // 「我还没机会自述，他们就先聊起来了」，而板子上写着「林默 还没上桌」）。
        const mine = seat === game?.humanSeat
        // **而「轮到你」也不能一直挂着。** 第一版把它写成了无条件：真人那一支永远是「轮到你」，
        // 于是他说完之后那句还留在那儿——他自己看得见的中栏里有他的发言，而这一栏说他还欠一个
        // 自我介绍（用户 2026-10-06 报的：自述完了，右栏还写「陈曼 轮到你」）。
        //
        // 判据走 `seatOf`（真人那条路由它认），与右栏、问话页同一处推导。
        const spoken = said.filter(isSaid).filter(line => seatOf(line, game?.humanSeat) === seat).length
        return <Card key={seat}>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'baseline' }}>
            <b>{role?.name ?? seat}</b>
            <span style={{ opacity: mine ? 0.85 : 0.6, fontSize: '11.5px' }}>
              {mine
                ? spoken === 0 ? t('intro.yourTurn') : `${t('saidSoFar')} · ${role?.name ?? seat}`
                : sitting === undefined ? t('left.notSeated') : `${t('saidSoFar')} · ${sitting.name}`}
            </span>
          </div>
        </Card>
      })
      : null}

    {phase === 'inquiry'
      ? (() => {
        // 资料与投票页同源（右栏那套投影），而**这一页要的是全部**而不是最近一段：问话阶段读的
        // 是「他有没有改口、有没有漏掉自己那段时间」，那要全文。而一个人可能说几千字，所以按人
        // 折叠，summary 给条数与第一句——想追的时候展开，不想追的时候它不占地方。
        const bySeat = new Map<string, string[]>()
        for (const line of said.filter(isSaid)) {
          const seat = seatOf(line, game?.humanSeat)
          if (seat === '') continue
          const list = bySeat.get(seat) ?? []
          list.push(line.text)
          bySeat.set(seat, list)
        }
        return (game?.seats ?? []).map(seat => {
          const role = caseEntry?.roles.find(one => one.id === seat)
          const lines = bySeat.get(seat) ?? []
          return <Card key={seat}>
            <div style={{ display: 'flex', gap: '8px', alignItems: 'baseline', marginBottom: '4px' }}>
              <b>{role?.name ?? seat}</b>
              <span style={{ fontSize: '11.5px', opacity: 0.55 }}>
                {lines.length === 0 ? t('inquiry.silent') : t('inquiry.spoke', { n: lines.length })}
              </span>
            </div>
            {lines.map((text, index) => <details key={index} style={{ marginTop: index === 0 ? 0 : '3px' }}>
              <summary style={{ cursor: 'pointer', fontSize: '11.5px', opacity: 0.7, lineHeight: 1.6 }}>
                {text.slice(0, 42)}{text.length > 42 ? '…' : ''}
              </summary>
              <div style={{ fontSize: '12px', opacity: 0.85, lineHeight: 1.7, padding: '4px 0 4px 10px', whiteSpace: 'pre-wrap' }}>
                {text}
              </div>
            </details>)}
          </Card>
        })
      })()
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
        {/* 还没发到桌上的线索不给这个按钮：它不在桌上，拿着它去问是作弊。
            引导语里那句「点『引用到对话』把它带进输入框」说的就是这个按钮（用户 2026-10-06
            报的：那句话写着，而按钮不在）。 */}
        {clue.dealt && clue.text !== ''
          ? <button
            type="button"
            onClick={() => { fillComposer(`${clue.title}：\n${clue.text}`) }}
            style={{
              font: 'inherit', fontSize: '11.5px', padding: '2px 9px', borderRadius: '6px', cursor: 'pointer',
              marginTop: '7px', border: '1px solid var(--dsw-border-subtle, rgba(127,127,127,0.4))',
              background: 'transparent', color: 'inherit', opacity: 0.85,
            }}
          >{t('mid.quote')}</button>
          : null}
      </Card>)
      : null}

    {phase === 'final'
      ? (() => {
        // **这一轮谁说过话。** 右栏那套投影已经在读了（`said` 是同一个来源，从 `RoomView`
        // 传下来），而这一页要的是按座位归集的版本：每人最近那一段，以及「还没出声」的人。
        // 投票阶段最要紧的信息就是这个——不然玩家不知道该等谁、也不知道自己漏听了谁。
        const latest = new Map<string, string>()
        for (const line of said.filter(isSaid)) {
          const seat = seatOf(line, game?.humanSeat)
          if (seat !== '') latest.set(seat, line.text)
        }
        return (game?.seats ?? []).map(seat => {
          const role = caseEntry?.roles.find(one => one.id === seat)
          const spoken = latest.get(seat)
          return <Card key={seat}>
            <div style={{ display: 'flex', gap: '8px', alignItems: 'baseline', marginBottom: spoken === undefined ? 0 : '4px' }}>
              <b>{role?.name ?? seat}</b>
              {spoken === undefined
                ? <span style={{ fontSize: '11.5px', opacity: 0.55 }}>{t('final.notSpoken')}</span>
                : null}
            </div>
            {spoken === undefined
              ? null
              : <div style={{
                fontSize: '12px', opacity: 0.8, lineHeight: 1.6,
                // 只给最近那一段，而且限高——这一页是「他要你说什么」，不是把对话再倒一遍。
                display: '-webkit-box', WebkitLineClamp: 4, WebkitBoxOrient: 'vertical',
                overflow: 'hidden',
              }}>{spoken}</div>}
          </Card>
        })
      })()
      : null}

    {phase === 'reveal'
      ? (game?.truth === undefined
        // **字段整个不在**，不是「还没到复盘」——那是客户端换了而宿主没重启。宿主半边没有
        // 热更新，所以这个组合真的会出现（2026-10-06 用户就撞上了，而两种情形显示成同一句话，
        // 我只能隔着屏幕猜）。说清楚它是什么，比一句含糊的「还没开始」有用。
        ? <Card><div style={{ fontSize: '12.5px', opacity: 0.75 }}>{t('reveal.staleHost')}</div></Card>
        : game?.truth === null
          ? <Card><div style={{ fontSize: '12.5px', opacity: 0.75 }}>{t('reveal.waiting')}</div></Card>
          : <>
          <Card>
            <div style={{ fontSize: '11.5px', opacity: 0.6, marginBottom: '4px' }}>{t('reveal.narrative')}</div>
            <div style={{ fontSize: '12.5px', lineHeight: 1.85, whiteSpace: 'pre-wrap' }}>{game.truth.narrative}</div>
          </Card>
          {game.truth.timeline.length === 0 ? null : <Card>
            <div style={{ fontSize: '11.5px', opacity: 0.6, marginBottom: '5px' }}>{t('reveal.timeline')}</div>
            {game.truth.timeline.map((step, index) => <div key={`${step.at}-${index}`} style={{
              display: 'flex', gap: '8px', padding: '3px 0', alignItems: 'baseline',
              borderTop: index === 0 ? 'none' : '1px solid var(--dsw-border-subtle, rgba(127,127,127,0.14))',
            }}>
              <span style={{ fontSize: '11px', opacity: 0.6, flexShrink: 0, minWidth: '52px' }}>{step.at}</span>
              <span style={{ fontSize: '11.5px', flexShrink: 0, minWidth: '34px', fontWeight: 500 }}>{step.who}</span>
              <span style={{ fontSize: '12px', opacity: 0.85, lineHeight: 1.6 }}>{step.doing}</span>
            </div>)}
          </Card>}
          {game.truth.misdirections.length === 0 ? null : <Card>
            <div style={{ fontSize: '11.5px', opacity: 0.6, marginBottom: '4px' }}>{t('reveal.notIt')}</div>
            {game.truth.misdirections.map((one, index) => <div key={index} style={{
              fontSize: '12px', opacity: 0.85, lineHeight: 1.6, marginTop: index === 0 ? 0 : '5px',
            }}>· {one}</div>)}
          </Card>}
          {game.truth.after.length === 0 ? null : <Card>
            <div style={{ fontSize: '11.5px', opacity: 0.6, marginBottom: '4px' }}>{t('reveal.after')}</div>
            {game.truth.after.map((one, index) => <div key={index} style={{
              fontSize: '12px', opacity: 0.85, lineHeight: 1.6, marginTop: index === 0 ? 0 : '3px',
            }}>· {one}</div>)}
          </Card>}
        </>)
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
    // 同 `PhaseColumn`：`width: 100%` 与 `padding` 一起出现时必须有 `boxSizing`，否则多出的
    // padding 会把这一栏顶出轨道。
    maxWidth: '640px', width: '100%', margin: '0 auto', padding: '14px 20px 40px',
    boxSizing: 'border-box',
  }}>
    <h2 style={{ fontSize: '14px', margin: '0 0 4px', fontWeight: 600 }}>
      {snapshot.preparing ? t('mid.preparingTitle') : t('mid.noGame')}
    </h2>
    {/* 「主持人正在准备」——点了开一局之后到局面出来之间那几十秒。
        判据是宿主见过一次 `load`（见 `src/index.ts` 的 `isPreparing`）：**那段时间原先完全静默**，
        房间页一直写着「还没开局」，看着像卡住（用户 2026-10-06 报的：加载期间最好有个提示）。 */}
    {snapshot.preparing
      ? <p style={{ opacity: 0.7, fontSize: '12px', margin: '0 0 14px', lineHeight: 1.6 }}>
        {t('mid.preparingHint')}
      </p>
      : null}
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
              ? <>
                <button
                  type="button"
                  onClick={() => { fillComposer(openingInstruction(one, assignment)) }}
                  style={{
                    font: 'inherit', fontSize: '12px', padding: '3px 11px', borderRadius: '7px', cursor: 'pointer',
                    border: '1px solid var(--dsw-accent, #4a7fd4)', marginBottom: '6px',
                    background: 'var(--dsw-accent, #4a7fd4)', color: '#fff',
                  }}
                >{t('mid.start')}</button>
                <pre style={{
                  margin: '0', padding: '6px 8px', maxHeight: '150px', overflow: 'auto',
                  background: 'var(--dsw-surface-sunken, rgba(127,127,127,0.10))',
                  borderRadius: '8px', fontSize: '11px', lineHeight: 1.5,
                  // `pre-wrap` 只在空格处断行，而这段里最长的一行是个没有空格的 Windows 路径——
                  // 不 `break-all` 它就横着撑破中栏。`maxWidth` 是跟 `overflow: auto` 一起用的：
                  // 真遇到断不开的东西（比如一个超长英文单词）时给横向滚动，而不是让整页变宽。
                  whiteSpace: 'pre-wrap', wordBreak: 'break-all', maxWidth: '100%',
                  boxSizing: 'border-box',
                }}>{openingInstruction(one, assignment)}</pre>
              </>
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
/**
 * 一个座位的色相——**头像就是这么取的**（`avatarShape`），所以名字、气泡、头像三者同色，
 * 一栏扫下来不用看字就知道哪几句是同一个人说的。
 * @param seat - 座位 id。
 * @returns 色相，0–359。
 */
function hueOf(seat: string): number {
  return avatarShape(seat).hue
}

/**
 * 一个座位的浅色底。
 *
 * **用半透明而不是固定的浅色**：`hsl(H 62% 48% / α)` 让底色自己透出来，于是浅色主题与暗色主题
 * 共用一套值——写死一个 `hsl(H 60% 92%)` 在暗色主题下会亮得刺眼。α 由调用方给：名字那一条要
 * 重一点（它是「谁在说」的锚），整块气泡淡得多（它是背景，不能盖过字）。
 * @param seat - 座位 id。
 * @param alpha - 不透明度，0–1。
 * @returns 一个 CSS 颜色。
 */
function tintOf(seat: string, alpha: number): string {
  return `hsl(${hueOf(seat)} 62% 48% / ${alpha})`
}

/**
 * 从 Team 的成员名（`p1-m3k8f2a`）里找出这个人演的角色叫什么。
 *
 * 成员名的前缀是座位 id（宿主的 `teammateName` 就是 `${seat}-<时间戳><随机>` 拼的），而那是分辨
 * 「这一句是谁说的」唯一的线索——信封里只有这个内部名。查不到就给 `undefined`，由调用方决定
 * 退回什么。
 *
 * @param who - `SaidLine.who`。
 * @param seatNames - 座位 id → 角色名。
 * @returns 角色名；这个座位不在桌上（或者名字不是那个形状）时给 `undefined`。
 */
function seatName(
  who: string,
  seatNames: ReadonlyMap<string, string>,
): string | undefined {
  const seat = who.split('-')[0]
  return seat === undefined ? undefined : seatNames.get(seat)
}

/**
 * 中间那一栏：桌上说了什么。
 *
 * **它在正中**——这一栏才是玩的时候一直盯着的地方，而阶段页与资料站两边（用户 2026-10-06 提的）。
 * @param props - 本地化文案、句子、开局了没有、座位到角色名的对照、以及真人占的座位。
 * @returns 一栏发言。
 */
function SaidColumn({ t, said, started, seatNames, humanSeat }: Locale & {
  said: readonly SaidLine[]
  started: boolean
  seatNames: ReadonlyMap<string, string>
  humanSeat: string
}) {
  const lines = said.filter(isSaid)
  // 真人这一局说过几句——**这一条算不准**，所以只用来决定那句话的轻重，不用来判断「轮到谁」：
  // 开局那条指令（真人在对话里打的那句）也是一条 `user` 消息，而 `said` 里没有「局面是从哪一句
  // 开始的」这个标记。试过用 `mineCount === 0` 当判据，结果是开局之后横幅立刻消失。
  const mineCount = lines.filter(one => one.from === 'user').length
  return <div style={{ padding: '14px 16px', boxSizing: 'border-box' }}>
    <Heading>{t('right.said')}</Heading>
    {/* **常驻**，不按「说过没有」判。判据不可靠时不该假装有判据——这里就是一句「怎么说话」的
        说明，而它的用场是**一直提醒他有个位子**（用户两次反馈「完全没我啥事」，而 DM 那边的
        节奏靠开局指令管、改了两轮都没管住）。 */}
    {started
      ? <div style={{
        marginBottom: '10px', padding: '6px 10px', borderRadius: '8px',
        background: 'hsl(210 62% 48% / 0.10)',
        borderLeft: '3px solid var(--dsw-accent, #4a7fd4)',
        fontSize: '11.5px', lineHeight: 1.6, opacity: mineCount === 0 ? 1 : 0.7,
      }}>{t('right.yourTurn')}</div>
      : null}
    {!started && lines.length > 0
      ? <div style={{ fontSize: '11.5px', opacity: 0.6, marginBottom: '8px', lineHeight: 1.5 }}>
        {t('right.notStarted')}
      </div>
      : null}
    {lines.length === 0
      ? <div style={{ fontSize: '12px', opacity: 0.7, marginBottom: '10px' }}>{t('right.empty')}</div>
      : <div style={{ marginBottom: '10px' }}>
        {lines.map((line, index) => {
          // 这一句是谁说的——决定它的底色。真人那些没有 Team 信封，所以按 `humanSeat` 上色；
          // 认不出来的（注入、背景子代理）不上色，它们本来也不是桌上的发言。
          const seat = seatOf(line, humanSeat)
          const who = line.from === 'user'
            ? t('right.you')
            // 玩家有两条路进来：直接在座说的，与经 Team 的 send_message 发来的。
            //
            // Team 那条的信封里带着发信人，而它的前缀就是座位 id——**那就是这一栏原先缺的东西**：
            // 只按 `kind` 显示，四个座位全糊成一句「玩家」（用户 2026-10-06 报的）。查得到角色名
            // 就用角色名；查不到（那一场的人已经不在座上了）退回座位号，总比「玩家」有用。
            : line.who !== undefined
              ? seatName(line.who, seatNames) ?? line.who.split('-')[0] ?? t('right.player')
              : line.from === 'agent-message' || line.from === 'team-message'
                ? t('right.player')
                : line.from
          return <div key={`${line.seq}-${index}`} style={{
            padding: '5px 9px', marginBottom: '5px', borderRadius: '8px',
            // 整块淡底 + 左边一道实色——那道线是「这一句属于谁」最省字的说法，而它与头像同色。
            background: seat === '' ? 'transparent' : tintOf(seat, 0.055),
            borderLeft: seat === '' ? '2px solid transparent' : `2px solid ${tintOf(seat, 0.5)}`,
          }}>
            <div style={{ fontSize: '11px', marginBottom: '2px' }}>
              <span style={{
                padding: '1px 7px', borderRadius: '5px',
                background: seat === '' ? 'transparent' : tintOf(seat, 0.2),
                opacity: seat === '' ? 0.6 : 1,
              }}>{who}</span>
            </div>
            <div style={{ fontSize: '12.5px', lineHeight: 1.7, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
              {line.text}
            </div>
          </div>
        })}
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
  // 座位 id → 角色名。右栏拿它把 Team 消息里的内部名翻成人名——那一栏原先只有一句「玩家」，
  // 四个座位分不出是谁（用户 2026-10-06 报的）。
  const seatNames = new Map<string, string>(
    (snapshot.cases.find(one => one.id === snapshot.game?.caseId)?.roles ?? [])
      .map(role => [role.id, role.name] as const),
  )
  // 回看：点了已经走过的哪一步，中栏就停在那儿；不点就跟着宿主走。
  const [peek, setPeek] = useState<Phase | null>(null)
  const shown = peek ?? live
  const { ref: rootRef, height } = useRoomHeight()

  return <div data-jubensha-room="" ref={rootRef} style={{
    position: 'relative',
    // **高度是量出来的，不是减出来的。** 为什么不写 `calc(100vh - 246px)`、也不写
    // `height: 100%`，见 `useRoomHeight` 上面那段——一句话：父容器的高度依赖我，我的高度依赖
    // 父容器，纯 CSS 里出不来。量出来的值放在行内，首帧那个常数只是兜底。
    height: height === null ? 'calc(100vh - 246px)' : `${height}px`,
    display: 'flex',
    flexDirection: 'column',
  }}>
    {/* 状态点的呼吸动画。放在这一层是因为它要给左栏用，而左栏总是渲染着——弹窗里那两段
        （淡入、放大）只在弹窗存在时才有用，所以留在那儿。 */}
    <style>{'@keyframes jubensha-breathe { 0%, 100% { opacity: 0.3 } 50% { opacity: 1 } }'}</style>
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
      gridTemplateColumns: 'minmax(150px, 272px) minmax(320px, 1fr) minmax(210px, 392px)',
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
        <SaidColumn
          t={t}
          said={said}
          started={snapshot.game !== null}
          seatNames={seatNames}
          humanSeat={snapshot.game?.humanSeat ?? ''}
        />
      </div>
      <div style={{
        minWidth: 0, minHeight: 0, overflowY: 'auto',
        borderLeft: '1px solid var(--dsw-border-subtle, rgba(127,127,127,0.28))',
      }}>
        {snapshot.game === null
          ? <OpenGame snapshot={snapshot} t={t} />
          : <PhaseColumn snapshot={snapshot} phase={shown} said={said} t={t} />}
      </div>
    </div>

    {notes}
  </div>
}
