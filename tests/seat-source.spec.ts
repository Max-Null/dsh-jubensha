/**
 * 「这一句是谁说的」只许有一个推导处。
 *
 * 这一条是被一次真事故逼出来的：原先三处各写了一遍，其中两遍是
 *
 * ```ts
 * const seat = line.who === undefined ? null : line.who.split('-')[0] ?? null
 * if (seat === null) continue
 * ```
 *
 * **它把真人整个跳过了**——真人的发言没有 Team 信封，所以 `who` 是 `undefined`。症状：问话页
 * 显示「林默 还没出过声」，而他明明说了两段（用户 2026-10-06 报的）。
 *
 * 而这是同一个 gap 的第四次浮现（`players` 里从来没有真人）；前三次分别是 DM 自己把局跑完、
 * 真人头像成灰块、自述页写「还没上桌」。**每一次都是在某个读者那里补一句**——所以这一次守的是
 * 形状：**那个模式不许再出现**，推导走 `seatOf()`。
 *
 * 这条测试读源码而不是跑函数，因为 `room.tsx` 是浏览器半边（它 import react，node 里跑不起来）。
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const SOURCE = 'src/client/room.tsx'

describe('座位号的推导', () => {
  const text = readFileSync(SOURCE, 'utf8')

  it('只有 seatOf() 一处把 who 变成座位号', () => {
    // 那个旧形状：先判 undefined，再用 split 取前缀。
    //
    // **只在代码行里找**：`seatOf` 的 jsdoc 里引用了那段旧代码当反面例子，而第一版没排除注释，
    // 于是它把自己的说明抓了出来。
    const code = text.split('\n').filter(line => {
      const trimmed = line.trim()
      return !trimmed.startsWith('*') && !trimmed.startsWith('//') && !trimmed.startsWith('/*')
    }).join('\n')
    const bad = code.match(/line\.who === undefined \?[^\n]*split\('- '\)/gu) ?? []
    expect(bad, '要么写成 seatOf(line, …)，要么把真人那一条判据一起带上').toEqual([])
  })

  it('seatOf 自己把真人那条路留着', () => {
    // 它必须同时认识两种来源：玩家（who 带座位前缀）与真人（from === 'user' + humanSeat）。
    expect(text).toContain('function seatOf(')
    expect(text).toContain("line.from === 'user'")
  })

  it('三处用它，都不再自己推导', () => {
    const uses = (text.match(/seatOf\(line,/gu) ?? []).length
    expect(uses, '气泡底色、问话页分组、投票页统计——三处都该用它').toBe(3)
  })
})
