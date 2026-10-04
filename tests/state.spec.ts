/**
 * 局面状态机的行为约定。
 *
 * 这些用例**先于实现**写下来：它们描述的是「跑过三局之后，一个局面必须记住什么」，
 * 而不是「现在的代码做了什么」。
 *
 * 判据来源：`docs/设计/2026-10-04-单机剧本杀-设计方案.md` §3.4 第 5 条
 * （状态靠我脑子记 → 状态机 + 事件日志，复盘 = 读日志），
 * 以及 `schema/case.schema.yml` 里由实测逼出来的第 4 条判据
 * （给玩家的永远是**原始资料**，不是带解读的资料）。
 */
import { describe, expect, it } from 'vitest'
import { advance, createGame, isFinished, isSealed, revealClues } from '../src/state.ts'
import type { GameState } from '../src/state.ts'

/** 一局 01 拾光照相馆的开局输入——位子取自该本真实的四个角色。 */
function opening(): GameState {
  return createGame({
    caseId: '01',
    title: '拾光照相馆',
    seats: ['p0', 'p1', 'p2', 'p3'],
    humanSeat: 'p0',
  })
}

describe('开局', () => {
  it('落在自述阶段、第 1 轮，桌上一张线索都没有', () => {
    const state = opening()
    expect(state.phase).toBe('self-intro')
    expect(state.round).toBe(1)
    expect(state.revealedClues).toEqual([])
  })

  it('留下一条进入记录——复盘时要能看出这一局从哪开始', () => {
    const state = opening()
    expect(state.log).toHaveLength(1)
    expect(state.log[0]?.kind).toBe('phase-enter')
    expect(state.log[0]?.phase).toBe('self-intro')
  })

  it('真人位与桌上位子都记下来：信息路由要靠它分辨谁该收到什么', () => {
    const state = opening()
    expect(state.seats).toEqual(['p0', 'p1', 'p2', 'p3'])
    expect(state.humanSeat).toBe('p0')
  })
})

describe('阶段推进', () => {
  it('按 self-intro → inquiry → search → final → reveal 依次走', () => {
    let state = opening()
    const seen = [state.phase]
    for (let i = 0; i < 4; i += 1) {
      state = advance(state)
      seen.push(state.phase)
    }
    expect(seen).toEqual(['self-intro', 'inquiry', 'search', 'final', 'reveal'])
  })

  it('复盘是终点：再推进不越界，也不再多写日志', () => {
    let state = opening()
    for (let i = 0; i < 4; i += 1) state = advance(state)
    const ended = advance(state)
    expect(ended.phase).toBe('reveal')
    expect(ended.log).toHaveLength(state.log.length)
  })

  it('每次推进都留记录，复盘读日志就能还原流程', () => {
    const state = advance(advance(opening()))
    expect(state.phase).toBe('search')
    expect(state.log.map(entry => entry.phase)).toEqual(['self-intro', 'inquiry', 'search'])
  })

  it('isFinished 只在复盘阶段为真', () => {
    let state = opening()
    expect(isFinished(state)).toBe(false)
    for (let i = 0; i < 4; i += 1) {
      state = advance(state)
      expect(isFinished(state)).toBe(i === 3)
    }
  })

  it('推进产生新对象，不改动传入的那一份', () => {
    const before = opening()
    const after = advance(before)
    expect(before.phase).toBe('self-intro')
    expect(after).not.toBe(before)
  })
})

describe('线索', () => {
  it('只记 id，不记文本——桌上看的是本子里的原文，解读不进牌桌', () => {
    const state = revealClues(advance(advance(opening())), ['c1', 'c3'])
    expect(state.revealedClues).toEqual(['c1', 'c3'])
  })

  it('搜证之前不给线索：那会让问话阶段失去意义', () => {
    const early = revealClues(opening(), ['c1'])
    expect(early.revealedClues).toEqual([])
  })

  it('重复给同一条不产生第二份', () => {
    const searching = advance(advance(opening()))
    const once = revealClues(searching, ['c1'])
    const twice = revealClues(once, ['c1'])
    expect(twice.revealedClues).toEqual(['c1'])
  })

  it('公布线索留记录，来源要能追溯到阶段', () => {
    const state = revealClues(advance(advance(opening())), ['c1'])
    const entry = state.log.at(-1)
    expect(entry?.kind).toBe('clue-revealed')
    expect(entry?.detail).toBe('c1')
    expect(entry?.phase).toBe('search')
  })
})

describe('封存期', () => {
  it('一路封到复盘为止，最后一步才开', () => {
    let state = opening()
    expect(isSealed(state)).toBe(true)
    for (let i = 0; i < 3; i += 1) {
      state = advance(state)
      expect(isSealed(state)).toBe(true)
    }
    expect(isSealed(advance(state))).toBe(false)
  })

  it('与 isFinished 恰好互为反面——复盘就是解封', () => {
    let state = opening()
    for (let i = 0; i < 5; i += 1) {
      expect(isSealed(state)).toBe(!isFinished(state))
      state = advance(state)
    }
  })

  it('没开局也算封着——取错了本子时，失败比通过有用', () => {
    expect(isSealed(undefined)).toBe(true)
  })
})
