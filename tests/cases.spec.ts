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

const root = join(fileURLToPath(new URL('..', import.meta.url)), 'cases')

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
