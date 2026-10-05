/**
 * 房间端点的信任围栏。
 *
 * 这些用例钉的是**拒绝**那一侧：面板要读它的前提是浏览器同源打过来，而一个能被网页
 * 随便读的端点会把整局局面（包括演员池里那些跨局印象）摊给任何页面。放行那一侧同样要有
 * 用例——只测拒绝的话，"永远拒绝"也能全绿。
 *
 * 判据来源：`dsh-memory/src/routes.ts` 的同一套围栏（它注释说「mirror of the /api gateway
 * fence」），本插件按跨插件不许运行时互相 import 的规矩复制了那份逻辑。
 */
import { describe, expect, it } from 'vitest'
import { actorAction, isTrusted } from '../src/room.ts'

/** 一次正常的面板请求：浏览器同源、Host 是本机。 */
function local(extra: Record<string, string> = {}): Record<string, string> {
  return { host: '127.0.0.1:19488', 'sec-fetch-site': 'same-origin', origin: 'http://127.0.0.1:19488', ...extra }
}

describe('房间端点的围栏', () => {
  it('本机同源放行', () => {
    expect(isTrusted(local(), [])).toBe(true)
  })

  it('localhost 与 [::1] 也算本机', () => {
    expect(isTrusted({ host: 'localhost:3080' }, [])).toBe(true)
    expect(isTrusted({ host: '[::1]:3080' }, [])).toBe(true)
  })

  it('没有 Host 头一律拒——那是 HTTP/1.0 或者有人手工拼的请求', () => {
    expect(isTrusted({ origin: 'http://127.0.0.1:19488' }, [])).toBe(false)
  })

  it('外来的 Host 拒', () => {
    expect(isTrusted({ host: 'evil.example.com' }, [])).toBe(false)
    expect(isTrusted({ host: '192.168.1.5:3080' }, [])).toBe(false)
  })

  it('trustedHosts 里列出的主机放行', () => {
    expect(isTrusted({ host: 'dsh.internal:3080' }, ['dsh.internal:3080'])).toBe(true)
    // 端口不同就不是同一个 authority——比对的是 host 而不是主机名。
    expect(isTrusted({ host: 'dsh.internal:9999' }, ['dsh.internal:3080'])).toBe(false)
  })

  it('跨站请求拒——那是 CSRF 的形状', () => {
    expect(isTrusted(local({ 'sec-fetch-site': 'cross-site' }), [])).toBe(false)
  })

  it('Origin 与 Host 不同源就拒，哪怕 Host 是本机', () => {
    expect(isTrusted(local({ origin: 'http://evil.example.com' }), [])).toBe(false)
    // 端口不同也算不同源。
    expect(isTrusted(local({ origin: 'http://127.0.0.1:9999' }), [])).toBe(false)
  })

  it('没有 Origin 时放行——同源的简单导航不带它', () => {
    const headers = local()
    delete headers['origin']
    expect(isTrusted(headers, [])).toBe(true)
  })

  it('Origin 是个不合法的 URL 时拒，不抛', () => {
    expect(isTrusted(local({ origin: '不是URL' }), [])).toBe(false)
  })

  it('头名大小写不敏感', () => {
    expect(isTrusted({ Host: '127.0.0.1:19488' }, [])).toBe(true)
    expect(isTrusted({ host: '127.0.0.1:19488', Origin: 'http://evil.example.com' }, [])).toBe(false)
  })

  it('同名头有多个值时取第一个', () => {
    expect(isTrusted({ host: ['127.0.0.1:19488', 'evil.example.com'] }, [])).toBe(true)
  })
})

describe('写端点的路径解析', () => {
  it('五个动作都认得出', () => {
    for (const action of ['add', 'rename', 'style', 'avatar', 'remove']) {
      expect(actorAction(`/jubensha/actor/${action}`)).toBe(action)
    }
  })

  it('别的路径都不认——这个端点没有子资源，也不是别的东西的别名', () => {
    expect(actorAction('/jubensha/actor')).toBeUndefined()
    expect(actorAction('/jubensha/actor/')).toBeUndefined()
    expect(actorAction('/jubensha/actor/add/extra')).toBeUndefined()
    expect(actorAction('/jubensha/room')).toBeUndefined()
    expect(actorAction('/jubensha/actorx/add')).toBeUndefined()
    expect(actorAction('/memory/api/list')).toBeUndefined()
  })

  it('不在动作集合里的名字也切得出来——判据不在这层', () => {
    // 这一层只管「从路径里切出那一段」，那一段是不是真动作由 handler 的 switch 定。
    // 分开的好处：路径形状能单测，而动作集合变了下这个测试不用动。
    expect(actorAction('/jubensha/actor/nonsense')).toBe('nonsense')
  })
})
