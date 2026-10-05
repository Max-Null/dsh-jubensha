/**
 * 自带的本子都要能加载。
 *
 * **为什么它值得一个测试**：本子是数据，数据坏了不会让 typecheck 红。而 `listCases()` 对坏本子
 * 是**静默跳过**的——那是运行时唯一合适的处置（面板上少一行，好过整个列表失败），可代价是一个
 * 写错字段的新本子只会表现为「它不在列表里」，而没人会想到是格式问题。
 *
 * 这里不检查内容好不好（那是人读的活），只检查它**读得进来**，以及有没有 error 级的 issue。
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { loadCase } from '../src/case.ts'
import type { LoadedCase } from '../src/case.ts'

const root = join(fileURLToPath(new URL('..', import.meta.url)), 'cases')

/** 从 `sections` 里取一个段。`sections` 是原始字典，所以这里要自己窄化。 */
function section(loaded: LoadedCase, name: string): Record<string, unknown> {
  const raw = loaded.sections[name]
  return typeof raw === 'object' && raw !== null && !Array.isArray(raw)
    ? raw as Record<string, unknown>
    : {}
}

/** 从一段里取数组（不是数组就给空）。 */
function arrayOf(source: Readonly<Record<string, unknown>>, name: string): readonly unknown[] {
  const raw = source[name]
  return Array.isArray(raw) ? raw : []
}

/** 从一条记录里按名字取字段。 */
function field(one: unknown, name: string): unknown {
  return typeof one === 'object' && one !== null ? (one as Record<string, unknown>)[name] : undefined
}

/** 每个自带本子的 `case.yml`。 */
function bundled(): readonly string[] {
  return readdirSync(root)
    .map(entry => join(root, entry, 'case.yml'))
    .filter(file => {
      try { return statSync(file).isFile() } catch { return false }
    })
}

describe('自带的本子', () => {
  it('至少有四本（面板上的可选项不该只有一两本）', () => {
    expect(bundled().length).toBeGreaterThanOrEqual(4)
  })

  it('每一本都读得进来，而且没有 error 级的 issue', () => {
    const files = bundled()
    expect(files.length).toBeGreaterThan(0)
    for (const file of files) {
      const loaded = loadCase(readFileSync(file, 'utf8'))
      const errors = loaded.issues.filter(one => one.level === 'error')
      // 把 issue 原文带进断言里——不然红了只知道"某本有问题"，还得再跑一次找是哪条。
      expect(errors.map(one => `${file}: ${one.message}`)).toEqual([])
      expect(loaded.id).not.toBe('')
      expect(loaded.title).not.toBe('')
      expect(loaded.roles.length).toBeGreaterThanOrEqual(4)
    }
  })

  it('编号不重复——两本同号会让 listCases 按 id 去重时吃掉一本', () => {
    const ids = bundled().map(file => loadCase(readFileSync(file, 'utf8')).id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('真人位恰好一个，而且是 p0', () => {
    for (const file of bundled()) {
      const loaded = loadCase(readFileSync(file, 'utf8'))
      const humans = loaded.roles.filter(role => role.player === 'human')
      expect(humans.map(one => one.id)).toEqual(['p0'])
    }
  })

  it('推理本要有死者与线索；情感本可以没有死者，但要有情感段', () => {
    for (const file of bundled()) {
      const loaded = loadCase(readFileSync(file, 'utf8'))
      if (loaded.genre === 'deduction') {
        expect(loaded.sections['clues'], `${file} 是推理本，该有线索`).toBeDefined()
        const victim = loaded.sections['scene']
        expect(JSON.stringify(victim ?? {}), `${file} 是推理本，该有死者`).toContain('victim')
      } else {
        // 情感本不要求有案件，但那一局的支点必须在情感段里写着。
        expect(loaded.sections['emotional'], `${file} 不是推理本，该有情感段`).toBeDefined()
      }
    }
  })
})

describe('自带的本子的结构', () => {
  it('每个角色的六段人设都不空', () => {
    for (const file of bundled()) {
      const loaded = loadCase(readFileSync(file, 'utf8'))
      for (const role of loaded.roles) {
        const where = `${loaded.id}/${role.id}`
        expect(role.name, `${where} 没有名字`).not.toBe('')
        expect(role.publicIdentity, `${where} 没有 public`).not.toBe('')
        // `now` 与 `play` 这两段是两局实测逼出来的，缺了它们的问题在 schema 里写着。
        expect(role.now, `${where} 没有 now —— 第三局的玩家就是被这个当场问住的`).not.toBe('')
        expect(role.privateHistory, `${where} 没有 private`).not.toBe('')
        expect(role.secret, `${where} 没有 secret`).not.toBe('')
        expect(role.play, `${where} 没有 play —— 没有它 AI 会照着剧情念稿，而不是照着一个有难处的人说话`).not.toBe('')
        expect(role.knows.length, `${where} 的 knows 是空的`).toBeGreaterThan(0)
        expect(role.goals.length, `${where} 的 goals 是空的`).toBeGreaterThan(0)
      }
    }
  })

  it('推理本恰好一个凶手，而且 truth.culprit 指向同一个人', () => {
    for (const file of bundled()) {
      const loaded = loadCase(readFileSync(file, 'utf8'))
      const flagged = loaded.roles.filter(one => one.culprit)
      const culprit = field(section(loaded, 'truth'), 'culprit')
      if (loaded.genre === 'deduction') {
        expect(flagged.map(one => one.id), `${loaded.id}：推理本该恰好标一个凶手`).toHaveLength(1)
        expect(culprit, `${loaded.id}：truth.culprit 该与那条标记一致`).toBe(flagged[0]!.id)
      } else {
        expect(flagged.map(one => one.id), `${loaded.id}：情感本不该标凶手`).toHaveLength(0)
      }
    }
  })

  it('phases 用的就是客户端认得的那五个 id', () => {
    // 客户端（room.tsx 的 PHASES）只认这五个；写错一个，那一页就点不出来。
    const known = ['self-intro', 'inquiry', 'search', 'final', 'reveal']
    for (const file of bundled()) {
      const loaded = loadCase(readFileSync(file, 'utf8'))
      const ids = arrayOf(loaded.sections, 'phases').map(one => field(one, 'id'))
      expect(ids, `${loaded.id} 的 phases`).toEqual(known)
    }
  })

  it('timeline 里的 who 都是这本子里真实存在的角色', () => {
    for (const file of bundled()) {
      const loaded = loadCase(readFileSync(file, 'utf8'))
      const seats = new Set(loaded.roles.map(one => one.id))
      for (const entry of arrayOf(section(loaded, 'truth'), 'timeline')) {
        const who = field(entry, 'who')
        expect(seats.has(String(who)), `${loaded.id}：timeline 里的 who="${String(who)}" 不是这本子的角色`).toBe(true)
      }
    }
  })

  it('每个 AI 玩家都在 liberty_to_slip 里有一条——那是它的破绽说明书', () => {
    for (const file of bundled()) {
      const loaded = loadCase(readFileSync(file, 'utf8'))
      const slips = arrayOf(loaded.sections, 'liberty_to_slip').map(one => String(one)).join('\n')
      for (const role of loaded.roles.filter(one => one.player === 'ai')) {
        expect(slips.includes(role.id), `${loaded.id}：${role.id} 在 liberty_to_slip 里没有条目`).toBe(true)
      }
    }
  })

  it('情感本要有 emotional；所有本子都要有 world_facts 与 briefing', () => {
    for (const file of bundled()) {
      const loaded = loadCase(readFileSync(file, 'utf8'))
      expect(loaded.sections['world_facts'], `${loaded.id} 缺 world_facts —— 玩家靠它自主判断`).toBeDefined()
      expect(loaded.sections['briefing'], `${loaded.id} 缺 briefing —— DM 靠它带流程`).toBeDefined()
      expect(loaded.sections['reveal'], `${loaded.id} 缺 reveal —— 复盘靠它`).toBeDefined()
    }
  })
})
