/**
 * 桌上的广播：从一条会话事件里挑出「桌上的话」。
 *
 * 这一条守的是设计文档 §3 的第一条判据——**同一句话，每个人收到的是一模一样的**。
 * 而要做到那一点，前提是「谁说的」与「说了什么」在广播之前就分得准：
 * 真人是 `source.kind === 'user'`，AI 玩家经 Team 来的是 `team-message`（信封里带座位号），
 * 其余（注入、别的插件）不是桌上说的话。
 *
 * 为什么值得单测：这四种来源混在同一个 `inserted[]` 里，而混错的表现**不是报错**——
 * 是一条注入被当成某位玩家说的话广播出去（那会让桌上出现一句谁也没说过的话）。
 */
import { describe, expect, it } from 'vitest'
import { tableLinesOf } from '../src/broadcast.ts'

/** 造一条 `agent/inbox/spliced` 事件。 */
function spliced(seq: number, inserted: unknown[]): { type: string, seq: number, data: unknown } {
  return { type: 'agent/inbox/spliced', seq, data: { inserted } }
}

/** 一条消息（`content` 用最常见的富结构）。 */
function message(text: string, kind: string): unknown {
  return { content: [{ type: 'text', text }], source: { kind } }
}

describe('从会话事件里挑出桌上的话', () => {
  it('真人说的认得出来（没有座位号）', () => {
    const lines = tableLinesOf(spliced(7, [message('我 21:45 走的', 'user')]))
    expect(lines).toEqual([{ seq: 7, seat: '', text: '我 21:45 走的' }])
  })

  it('AI 玩家说的带座位号，而信封要剥掉', () => {
    // Team 消息的信封长这样——正文前面那段是信道的记账，不是他说的话。
    const raw = 'Team message m-7 from p2-m3k8f2a: 我八点多来了一趟'
    const lines = tableLinesOf(spliced(9, [message(raw, 'team-message')]))
    expect(lines).toEqual([{ seq: 9, seat: 'p2', text: '我八点多来了一趟' }])
  })

  it('注入不是桌上说的话', () => {
    // 这三种是内核注入的（skill 目录、时间上下文、运行时上下文），它们不开口。
    const lines = tableLinesOf(spliced(11, [
      message('你现在的技能目录……', 'skill-catalog'),
      message('现在是 21:30', 'time-context'),
      message('运行环境……', 'runtime-context'),
      message('别的插件说的话', 'plugin:某个插件'),
    ]))
    expect(lines).toEqual([])
  })

  it('同一批里几种来源混在一起时，只挑该挑的', () => {
    const lines = tableLinesOf(spliced(13, [
      message('注入', 'runtime-context'),
      message('林默说的话', 'user'),
      message('Team message m-9 from p3-m3k8f2a: 武斌说的话', 'team-message'),
    ]))
    expect(lines).toEqual([
      { seq: 13, seat: '', text: '林默说的话' },
      { seq: 13, seat: 'p3', text: '武斌说的话' },
    ])
  })

  it('不是 splice 事件的一律不看', () => {
    expect(tableLinesOf({ type: 'assistant/message', seq: 15, data: {} })).toEqual([])
  })

  it('拍不出文字的消息丢掉——它们不是「谁说了什么」', () => {
    const lines = tableLinesOf(spliced(17, [
      { content: [{ type: 'tool-call', name: 'send_message' }], source: { kind: 'user' } },
      { content: [], source: { kind: 'user' } },
      message('   ', 'user'),
    ]))
    expect(lines).toEqual([])
  })
})
