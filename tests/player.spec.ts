/**
 * 玩家的上台说明与登记表的行为约定。
 *
 * 判据来源：`docs/设计/2026-10-04-单机剧本杀-设计方案.md` §3.4 第 2 条
 * （AI 玩家只拿到自己的角色本、只能说话），以及 `schema/case.schema.yml` 判据 4 的
 * 延长线——玩家拿到的是**原始角色本**，不是 DM 替它摘要过的东西。
 */
import { describe, expect, it } from 'vitest'
import { createRegistry, playerBrief, PLAYER_TOOLS } from '../src/player.ts'
import type { PlayerChildId, PlayerHandle } from '../src/player.ts'

/** 一个子会话 id。取值本身不重要——登记表不解释它，只是把它保管到发消息的那一刻。 */
const CHILD = 'child-1' as PlayerChildId

/** 一台上桌的玩家。 */
function sitting(seat: string, name: string): PlayerHandle {
  return { seat, name, childId: CHILD, dmId: 'dm-session-9' }
}

describe('上台说明', () => {
  it('话怎么传到桌上：只给 lead 这个成员名', () => {
    const brief = playerBrief({ seat: 'p1', name: '林晚', roleBook: '你那天没去过照相馆。' })
    expect(brief).toContain('林晚')
    expect(brief).toContain('p1')
    expect(brief).toContain('lead')
  })

  it('不把主持人的 session id 交给玩家——那不是成员名，给了它只会白试十次', () => {
    // 2026-10-05 实测：brief 里写 session id 的那一局，那位玩家一个字都没说出口
    // （Team 按成员名解析，见 agent-team/src/mailbox.ts:120），而外面看只是"她很安静"。
    const brief = playerBrief({ seat: 'p1', name: '林晚', roleBook: '无' })
    expect(brief).not.toMatch(/session/)
    expect(brief).not.toContain('agent_id')
  })

  it('整份角色本原样交出去：摘要一句就少一句可守的秘密', () => {
    const roleBook = '你当晚 22:40 到过门口。\n那把钥匙是你配的。'
    const brief = playerBrief({ seat: 'p2', name: '周野', roleBook })
    expect(brief).toContain(roleBook)
  })

  it('指定 send_message 为唯一的发言通道——不说就等于没说过话', () => {
    const brief = playerBrief({ seat: 'p1', name: '林晚', roleBook: '无' })
    expect(brief).toContain('send_message')
  })
})

describe('玩家白名单', () => {
  it('只放行说话这一项：这份名单就是「玩家只能说话」的实现', () => {
    expect(PLAYER_TOOLS).toEqual(['send_message'])
  })
})

describe('记下他说过的话', () => {
  it('记下之后取得回来——relay 靠它拿原件，不靠主持人复述', () => {
    const players = createRegistry()
    players.seat(sitting('p1', '林晚'))
    players.recordSaid('p1', '我八点前来过，坐了会儿就走了。')
    expect(players.lastSaid('p1')).toBe('我八点前来过，坐了会儿就走了。')
  })

  it('还没开过口时取回 undefined，而不是空串——空串会被当成"他说了句空话"', () => {
    const players = createRegistry()
    players.seat(sitting('p1', '林晚'))
    expect(players.lastSaid('p1')).toBeUndefined()
  })

  it('后说的盖掉先说的', () => {
    const players = createRegistry()
    players.seat(sitting('p1', '林晚'))
    players.recordSaid('p1', '第一句')
    players.recordSaid('p1', '第二句')
    expect(players.lastSaid('p1')).toBe('第二句')
  })

  it('下桌之后那句话也忘掉——否则它能被转达给一桌新人', () => {
    const players = createRegistry()
    players.seat(sitting('p1', '林晚'))
    players.recordSaid('p1', '我有事瞒着你们。')
    players.unseat('p1')
    expect(players.lastSaid('p1')).toBeUndefined()
  })

  it('两个人各记各的，不串', () => {
    const players = createRegistry()
    players.seat(sitting('p1', '林晚'))
    players.seat(sitting('p2', '周野'))
    players.recordSaid('p1', '甲说的')
    players.recordSaid('p2', '乙说的')
    expect(players.lastSaid('p1')).toBe('甲说的')
    expect(players.lastSaid('p2')).toBe('乙说的')
  })
})

describe('玩家登记', () => {
  it('上桌后能按座位取回', () => {
    const players = createRegistry()
    players.seat(sitting('p1', '林晚'))
    expect(players.get('p1')?.name).toBe('林晚')
  })

  it('空座位取回 undefined，而不是一个假玩家', () => {
    expect(createRegistry().get('p3')).toBeUndefined()
  })

  it('按子会话 id 也找得回玩家——续命子会话每次 activation 都要靠它重新认人', () => {
    const players = createRegistry()
    players.seat(sitting('p1', '林晚'))
    expect(players.find(CHILD)?.seat).toBe('p1')
  })

  it('不在座上的子会话 id 找不回人', () => {
    expect(createRegistry().find('nobody')).toBeUndefined()
  })

  it('同一个座位不能坐两个人——静默替换会把先上桌的变成没人收的孤儿', () => {
    const players = createRegistry()
    players.seat(sitting('p1', '林晚'))
    expect(() => players.seat(sitting('p1', '周野'))).toThrow(/p1/)
    expect(players.get('p1')?.name).toBe('林晚')
  })

  it('下桌之后座位空出来', () => {
    const players = createRegistry()
    players.seat(sitting('p1', '林晚'))
    expect(players.unseat('p1')).toBe(true)
    expect(players.get('p1')).toBeUndefined()
  })

  it('下一位本来就不在的人，如实说没这个人', () => {
    expect(createRegistry().unseat('p9')).toBe(false)
  })

  it('列出的顺序就是上桌顺序——开局报座位时按它念', () => {
    const players = createRegistry()
    players.seat(sitting('p1', '林晚'))
    players.seat(sitting('p2', '周野'))
    expect(players.list().map(player => player.seat)).toEqual(['p1', 'p2'])
  })

  it('列出来的是副本：调用方改它不影响登记表', () => {
    const players = createRegistry()
    players.seat(sitting('p1', '林晚'))
    // 故意绕开 readonly：运行时是不是副本，类型系统答不了，只能这么问。
    const shown = players.list() as PlayerHandle[]
    shown.pop()
    expect(players.list()).toHaveLength(1)
  })
})
