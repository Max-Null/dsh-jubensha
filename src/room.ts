/**
 * 房间端点 —— 面板读的那一份快照。
 *
 * **为什么要有它**：插件的两半是两个进程里的两个 cordis 上下文（宿主在 node，面板在浏览器），
 * 它们不共享服务。所以「面板显示局面」这件事需要一条跨半边的通道，而官方给的就是插件自己的
 * HTTP 端点：宿主注册、面板同源 fetch。会话事件那条路也能走通，但那要注册 conversation node
 * 去把事件折成节点，对"读一份当前状态"这个用途重得多。
 *
 * **只读。** 面板不发号施令——开一局、推进阶段、发线索都在对话里说。这既是设计方案的
 * 「界面是附加层」那条约束，也让这个端点不必考虑写冲突。
 *
 * **围栏照抄自 `dsh-memory/src/routes.ts`**：loopback 或 trustedHosts、拒绝 cross-site、
 * Origin 必须与 Host 同源。那段逻辑没有公共库可引（跨插件不许运行时互相 import），
 * 所以复制——但要连同它防的东西一起复制，别只抄个形状。
 *
 * @module @max-null/dsh-jubensha/room
 */
import type { Context } from '@deepseek-ai/cordis'
// re-export 不会把名字带进本文件的局部作用域，所以下面那个签名还要自己 import 一次。
import type { RoomSnapshot } from './room-types.ts'

/** 一个请求的头。 */
type RequestHeaders = Record<string, string | string[] | undefined>

/**
 * 取一个头；同名多个值时取第一个。
 *
 * **逐个小写比对，不是查一次表**：Node 交给处理器的头名确实总是小写，但这个函数的参数类型
 * 不保证那件事，而它守的是安全判据——一个大小写不敏感的头名比对错了，代价是放行一个本该
 * 拒绝的请求（拿 `Host` vs `host` 绕过信任检查）。
 * @param headers - 请求头。
 * @param name - 头名，大小写不敏感。
 * @returns 头的值；没有时 `undefined`。
 */
function header(headers: RequestHeaders, name: string): string | undefined {
  const wanted = name.toLowerCase()
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() !== wanted) continue
    return Array.isArray(value) ? value[0] : value
  }
  return undefined
}

/** 把 `host:port` 解析成 URL；不合法时给 `undefined`。 */
function parseAuthority(authority: string): URL | undefined {
  try {
    return new URL(`http://${authority}`)
  } catch {
    return undefined
  }
}

/** 这个主机名是不是本机。 */
function isLoopbackHostname(hostname: string): boolean {
  if (hostname === 'localhost' || hostname === '[::1]') return true
  const parts = hostname.split('.')
  return parts.length === 4
    && parts[0] === '127'
    && parts.every(part => /^\d{1,3}$/.test(part) && Number(part) <= 255)
}

/**
 * 这个请求能不能进插件路由。
 *
 * 导出是为了让测试直接钉住它——这是安全判据，而它**只有一处的调用者**（下面那个 handler），
 * 靠端到端去覆盖等于把它交给运气：真正的拒绝路径要在浏览器里伪造 Host 与 Origin 才碰得到。
 * @param headers - 请求头。
 * @param trustedHosts - 运行时信任的主机列表。
 * @returns 可以进为 `true`。
 */
export function isTrusted(headers: RequestHeaders, trustedHosts: readonly string[]): boolean {
  const host = header(headers, 'host')
  if (host === undefined) return false
  const hostUrl = parseAuthority(host)
  if (hostUrl === undefined) return false
  const trusted = isLoopbackHostname(hostUrl.hostname)
    || trustedHosts.some((entry) => {
      const entryUrl = parseAuthority(entry)
      return entryUrl !== undefined && entryUrl.host === hostUrl.host
    })
  if (!trusted) return false
  if (header(headers, 'sec-fetch-site') === 'cross-site') return false
  const origin = header(headers, 'origin')
  if (origin === undefined) return true
  try {
    return new URL(origin).host === hostUrl.host
  } catch {
    return false
  }
}

/** 写一个 JSON 响应。 */
function writeJson(res: unknown, status: number, body: unknown): void {
  const response = res as {
    statusCode: number
    setHeader(name: string, value: string): void
    end(chunk?: string): void
  }
  response.statusCode = status
  response.setHeader('content-type', 'application/json; charset=utf-8')
  response.setHeader('cache-control', 'no-store')
  response.end(JSON.stringify(body))
}

/**
 * 快照的形状住在 `room-types.ts`。
 *
 * 那个文件零依赖，所以浏览器半边引得起；本文件 import 了 cordis，而浏览器半边的打包有一道
 * 纯度门会拒掉 `@deepseek-ai/*` 的任何导入（类型导入也不例外——那道门看模块解析，不看擦除
 * 之后的结果）。这里再导出一次是为了让"房间这件事的宿主侧"仍是一个入口。
 */
export type { RoomActor, RoomGame, RoomPlayer, RoomSnapshot } from './room-types.ts'

/**
 * 挂 `/jubensha/room`。
 *
 * 只认 GET：面板只读，写操作全在对话里。**必须带 `?session=<id>`**——局面是按会话存的，
 * 没有「全局局面」这回事了（见 `index.ts` 里 `games` 的注释）。
 * @param ctx - 插件上下文（要已声明 `webServer` / `webRuntime` 注入）。
 * @param snapshot - 按会话取快照；由调用方决定数据从哪来。
 */
export function mountRoomApi(ctx: Context, snapshot: (sessionId: string) => Promise<RoomSnapshot>): void {
  // 这两个服务由 index.ts 的 inject 声明；Context 的类型面没有它们（不是宿主内核包），
  // 所以在这里断言取用——与 dsh-memory 同一手法。
  const services = ctx as unknown as {
    webServer: {
      register(descriptor: {
        kind: string
        path: string
        handler: (req: unknown, res: unknown) => Promise<void> | void
      }): () => void
    }
    webRuntime: { trustedHosts: readonly string[] }
  }

  ctx.effect(() => services.webServer.register({
    kind: 'prefix',
    path: '/jubensha/room',
    handler: async (req: unknown, res: unknown) => {
      const request = req as { headers: RequestHeaders, method?: string, url?: string }
      if (!isTrusted(request.headers, services.webRuntime.trustedHosts)) {
        writeJson(res, 403, { ok: false, error: 'forbidden' })
        return
      }
      // prefix 路由会把子路径也送到这里，而这份快照没有子资源——多出来的路径按 404 处理，
      // 免得 /jubensha/room/anything 也回一份正常快照。
      const url = new URL(request.url ?? '/', 'http://dsh.internal')
      if (url.pathname !== '/jubensha/room' && url.pathname !== '/jubensha/room/') {
        writeJson(res, 404, { ok: false, error: 'not-found' })
        return
      }
      if ((request.method ?? 'GET') !== 'GET') {
        writeJson(res, 405, { ok: false, error: 'method-error' })
        return
      }
      const sessionId = url.searchParams.get('session')
      if (sessionId === null || sessionId === '') {
        writeJson(res, 400, { ok: false, error: 'missing-session' })
        return
      }
      try {
        writeJson(res, 200, { ok: true, value: await snapshot(sessionId) })
      } catch (error: unknown) {
        // 只回一句人话，不回栈：这是个浏览器能打到的地方。
        writeJson(res, 500, { ok: false, error: error instanceof Error ? error.message : String(error) })
      }
    },
  }), '@max-null/dsh-jubensha: /jubensha/room')
}

/** 演员池要能干的事——只取设置页用得上的那几件，不把整个池子交出去。 */
export interface ActorWriter {
  /** 招一个进来。 */
  add(input: { id: string; name: string; style: string }): Promise<unknown>
  /** 改名字。 */
  setName(id: string, name: string): Promise<unknown>
  /** 改性格。 */
  setStyle(id: string, style: string): Promise<unknown>
  /** 换头像；空串表示换回按 id 生成的那个。 */
  setAvatar(id: string, image: string): Promise<unknown>
  /** 请走。不可逆——跨局印象跟着 id 一起没。 */
  remove(id: string): Promise<string>
}

/**
 * 从路径里取出动作名。
 *
 * 抽出来是因为它是这一层唯一**能单测**的部分：整套写端点只有在浏览器里够得着，而"哪个路径
 * 算哪个动作、哪些路径该 404"不该靠端到端去覆盖——那种覆盖要么写不出来，要么写成
 * "我把请求伪造了一遍"。
 * @param pathname - 请求路径。
 * @returns 动作名；不属于这个端点时给 `undefined`。
 */
export function actorAction(pathname: string): string | undefined {
  const prefix = '/jubensha/actor/'
  if (!pathname.startsWith(prefix)) return undefined
  const rest = pathname.slice(prefix.length)
  // 空的一段、或者再往下还有层级，都不认——这个端点没有子资源。
  if (rest === '' || rest.includes('/')) return undefined
  return rest
}

/**
 * 读一个小 JSON 请求体。
 *
 * 设了 64 KB 的上限：设置页发的都是几十字节，而"读一个不设上限的请求体"是白送的一个洞。
 * @param req - 请求。
 * @returns 解析出来的对象；空体给 `{}`。
 */
async function readJsonBody(req: unknown): Promise<Record<string, unknown>> {
  const chunks: string[] = []
  let size = 0
  for await (const chunk of req as AsyncIterable<string | Uint8Array>) {
    const text = typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8')
    size += text.length
    if (size > 64 * 1024) throw new Error('请求体太大了。')
    chunks.push(text)
  }
  const raw = chunks.join('')
  if (raw === '') return {}
  const parsed: unknown = JSON.parse(raw)
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('请求体要是一个 JSON 对象。')
  }
  return parsed as Record<string, unknown>
}

/** 从请求体里取一个必填的字符串字段。 */
function need(body: Record<string, unknown>, field: string): string {
  const value = body[field]
  if (typeof value !== 'string' || value === '') throw new Error(`缺少 "${field}"，或者它不是字符串。`)
  return value
}

/**
 * 挂 `/jubensha/actor/<动作>`（POST）。
 *
 * **写端点只认自己那几个动作**，一个不多：设置页要的是"改这批字段"，而不是"随便调用池子"。
 * 围栏与只读端点同一套（loopback 或 trustedHosts、拒 cross-site、Origin 同源）。
 * @param ctx - 插件上下文（要已声明 `webServer` / `webRuntime` 注入）。
 * @param pool - 取演员池；由调用方决定什么时候开它。
 */
export function mountActorApi(ctx: Context, pool: () => Promise<ActorWriter>): void {
  const services = ctx as unknown as {
    webServer: {
      register(descriptor: {
        kind: string
        path: string
        handler: (req: unknown, res: unknown) => Promise<void> | void
      }): () => void
    }
    webRuntime: { trustedHosts: readonly string[] }
  }

  ctx.effect(() => services.webServer.register({
    kind: 'prefix',
    path: '/jubensha/actor',
    handler: async (req: unknown, res: unknown) => {
      const request = req as { headers: RequestHeaders, method?: string, url?: string }
      if (!isTrusted(request.headers, services.webRuntime.trustedHosts)) {
        writeJson(res, 403, { ok: false, error: 'forbidden' })
        return
      }
      if ((request.method ?? 'GET') !== 'POST') {
        writeJson(res, 405, { ok: false, error: 'method-error' })
        return
      }
      const action = actorAction(new URL(request.url ?? '/', 'http://dsh.internal').pathname)
      if (action === undefined) {
        writeJson(res, 404, { ok: false, error: 'not-found' })
        return
      }
      try {
        const body = await readJsonBody(req)
        const actors = await pool()
        let value: unknown
        switch (action) {
          case 'add': {
            value = await actors.add({
              id: need(body, 'id'),
              name: need(body, 'name'),
              style: typeof body['style'] === 'string' ? body['style'] : '',
            })
            break
          }
          case 'rename': value = await actors.setName(need(body, 'id'), need(body, 'name')); break
          case 'style': value = await actors.setStyle(need(body, 'id'), need(body, 'style')); break
          case 'avatar': value = await actors.setAvatar(need(body, 'id'), need(body, 'image')); break
          case 'remove': value = await actors.remove(need(body, 'id')); break
          default: {
            writeJson(res, 404, { ok: false, error: 'not-found' })
            return
          }
        }
        writeJson(res, 200, { ok: true, value })
      } catch (error: unknown) {
        // 演员池抛的是人话（「演员池里没有 "x"。先 action="list" 看看都有谁。」），
        // 那条话正是设置页该显示的东西——所以原样带出去，但不带栈。
        writeJson(res, 400, { ok: false, error: error instanceof Error ? error.message : String(error) })
      }
    },
  }), '@max-null/dsh-jubensha: /jubensha/actor')
}
