/**
 * 开局指令的写法。
 *
 * 它是一段**给人看、给模型读**的文本，所以判据偏内容而不是结构：路径要在（不然主持人不知道
 * 去哪取本子）、座位要列全（不然会漏人）、演员要指名（不然跨局记忆白做）。
 *
 * 最要紧的一条是**它不越界**：不写开场白、不写节奏、不写「你该先问什么」。面板是附加层，
 * 它只排座——那一局怎么带是主持人的事。
 */
import { describe, expect, it } from 'vitest'
import { openingInstruction } from '../src/instruction.ts'
import type { RoomCase } from '../src/room-types.ts'

/** 一份排好的本子。 */
const ENTRY: RoomCase = {
  id: '01',
  title: '拾光照相馆',
  genre: 'deduction',
  seats: 4,
  humanSeats: 1,
  path: 'H:/cases/01-拾光照相馆/case.yml',
  roles: [
    { id: 'p0', name: '林默', player: 'human', public: '32 岁，周德明的侄子。' },
    { id: 'p1', name: '陈建国', player: 'ai', public: '61 岁，退休邮递员。' },
    { id: 'p2', name: '马丽', player: 'ai', public: '41 岁，做老照片生意。' },
    { id: 'p3', name: '苏小满', player: 'ai', public: '24 岁，老周的学徒。' },
  ],
}

/** 三个 AI 位子上的演员。 */
const CAST = [
  { seat: 'p1', roleName: '陈建国', actorId: 'laozhou', actorName: '老周' },
  { seat: 'p2', roleName: '马丽', actorId: 'amay', actorName: '阿May' },
  { seat: 'p3', roleName: '苏小满', actorId: 'xiaoman', actorName: '小满' },
]

describe('开局指令', () => {
  it('本子的路径要写全——主持人靠它去取本子', () => {
    expect(openingInstruction(ENTRY, CAST)).toContain('H:/cases/01-拾光照相馆/case.yml')
  })

  it('座位与真人位都写出来', () => {
    const text = openingInstruction(ENTRY, CAST)
    expect(text).toContain('["p0","p1","p2","p3"]')
    expect(text).toContain('humanSeat="p0"')
  })

  it('每个 AI 位子都指名到演员——不指名的话跨局记忆白做', () => {
    const text = openingInstruction(ENTRY, CAST)
    for (const one of CAST) {
      expect(text).toContain(one.seat)
      expect(text).toContain(`actor="${one.actorId}"`)
      expect(text).toContain(one.actorName)
    }
  })

  it('真人位子不进上桌名单——那是玩家自己', () => {
    expect(openingInstruction(ENTRY, CAST)).not.toContain('p0 林默 →')
  })

  it('不替主持人决定怎么带——没有开场白、没有节奏指令', () => {
    const text = openingInstruction(ENTRY, CAST)
    expect(text).toContain('剩下的按本子来')
    expect(text).not.toContain('你先说')
    expect(text).not.toContain('开场白：')
    expect(text).not.toContain('第一步：')
  })

  it('一个演员都没排时，上桌那一段整个不出现', () => {
    const text = openingInstruction(ENTRY, [])
    expect(text).not.toContain('让这几位上桌')
    expect(text).toContain('jubensha_state')
  })

  it('本子没有真人位时不留下一个空的 humanSeat', () => {
    const text = openingInstruction({ ...ENTRY, roles: ENTRY.roles.filter(role => role.player === 'ai') }, [])
    expect(text).toContain('humanSeat=""')
  })
})
