/**
 * 头像生成的行为约定。
 *
 * 最有分量的那条是**稳定**：同一个演员每一局都该长同一张脸，否则头像就不是这个人在桌上的
 * 记号，只是装饰。所以用例写成"同一个 id 调两次得同一结果"，而不是"看起来像张图"。
 */
import { describe, expect, it } from 'vitest'
import { avatarShape, avatarSvg } from '../src/avatar.ts'

describe('头像', () => {
  it('同一个 id 永远同一个结果——它得是这个人的记号', () => {
    expect(avatarSvg('laozhou')).toBe(avatarSvg('laozhou'))
    expect(avatarShape('amay')).toEqual(avatarShape('amay'))
  })

  it('换个 id 就换个样子', () => {
    const ids = ['laozhou', 'amay', 'xiaoman', 'p1', 'p2', 'p3', 'zhouye', 'linlei']
    const shapes = ids.map(id => JSON.stringify(avatarShape(id)))
    expect(new Set(shapes).size).toBeGreaterThan(ids.length / 2)
  })

  it('画出来的是一个能直接塞进 DOM 的 svg', () => {
    const svg = avatarSvg('laozhou', 48)
    expect(svg.startsWith('<svg')).toBe(true)
    expect(svg.endsWith('</svg>')).toBe(true)
    expect(svg).toContain('viewBox="0 0 48 48"')
    expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"')
  })

  it('色相落在合法区间', () => {
    for (const id of ['a', 'b', 'c', 'laozhou', 'amay', '', '一个中文名字']) {
      const { hue } = avatarShape(id)
      expect(hue).toBeGreaterThanOrEqual(0)
      expect(hue).toBeLessThan(360)
    }
  })

  it('三种形状都会出现——散不开的话所有人长得一模一样', () => {
    const ids = Array.from({ length: 60 }, (_, index) => `actor-${index}`)
    const cores = new Set(ids.map(id => avatarShape(id).core))
    const marks = new Set(ids.map(id => avatarShape(id).mark))
    expect(cores.size).toBe(3)
    expect(marks.size).toBe(3)
  })

  it('不用 emoji，也不引外部资源', () => {
    const svg = avatarSvg('laozhou')
    expect(svg).not.toContain('<image')
    expect(svg).not.toContain('href')
    expect(svg).not.toContain('url(')
    // 唯一的 http 是 xmlns 的命名空间声明——它不是一次网络请求。
    expect(svg.match(/http/g) ?? []).toHaveLength(1)
  })
})
