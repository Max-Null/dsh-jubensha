/**
 * 头像 —— 按演员 id 生成一个几何图形。
 *
 * **为什么要生成而不是留空**：空着的时候桌上就没有头像，而一个"不填就没有"的东西等于没做。
 * 默认必须是有的。
 *
 * **为什么由 id 决定而不是每局随机**：同一个演员每局都该长同一张脸——那样头像才是这个人在
 * 桌上的记号，而不是装饰。id 是跨局稳定的，所以从它推出来的图形也稳定。
 *
 * **为什么是内联 SVG 不是 emoji**：界面图标一律用内联 SVG 是这个工作区既有的约定；
 * 字符当图标即便不是真 emoji，渲染出来也像 emoji 标记。
 *
 * **为什么单独一个文件、零 dependenc**：这个模块要被**两个半边**共用——宿主侧（演员池的
 * 记录里存什么）与浏览器侧（面板上画什么）。它一旦 import 了 storage 或 zod，客户端半边就
 * 拖进了宿主专属依赖。所以这里只有纯函数。
 *
 * @module @max-null/dsh-jubensha/avatar
 */

/**
 * 把一段文本折成 32 位无符号数（FNV-1a）。
 *
 * 用它而不是 `Math.random`：头像要**稳定**。也不用 `crypto`：这里只需要"散得开"，不需要
 * 密码学性质，而自带实现让这个模块保持零依赖。
 * @param text - 任意文本，这里是演员 id。
 * @returns 32 位无符号整数。
 */
function fold(text: string): number {
  let hash = 0x811c9dc5
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index)
    // 乘 16777619 但不溢出 32 位：拆成移位相加，等价于 `hash * 16777619` 的模 2^32 结果。
    hash = (hash + ((hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24))) >>> 0
  }
  return hash >>> 0
}

/** 从哈希里取第 `index` 段，落到 `[0, modulo)` 里。 */
function slice(seed: number, index: number, modulo: number): number {
  // 每段取 5 个二进制位：循环右移后再掩码，让相邻段不相关（否则取色相与取形状会同步变化）。
  const rotated = ((seed >>> (index * 3)) | (seed << (15 - (index * 3)))) >>> 0
  return rotated % modulo
}

/** 一个头像的构成。它是 `avatarSvg` 的全部输入——把它摊开是为了让测试能直接钉住"同一个 id 得同一个结果"。 */
export interface AvatarShape {
  /** 背景色相，0–359。 */
  readonly hue: number
  /** 中间那个色块的形状。 */
  readonly core: 'circle' | 'square' | 'triangle'
  /** 前景那个小色块的形状。 */
  readonly mark: 'circle' | 'square' | 'triangle'
  /** 背景的明度档，0–2。 */
  readonly tone: 0 | 1 | 2
}

/**
 * 由 id 决定一个头像长什么样。
 *
 * 抽出来是因为**它是判据所在**：换个 id 该换个样子，同一个 id 该永远同一个样子。
 * @param id - 演员 id。
 * @returns 这个 id 对应的形状。
 */
export function avatarShape(id: string): AvatarShape {
  const seed = fold(id)
  const shapes = ['circle', 'square', 'triangle'] as const
  return {
    hue: slice(seed, 0, 360),
    core: shapes[slice(seed, 1, 3)] ?? 'circle',
    mark: shapes[slice(seed, 2, 3)] ?? 'square',
    tone: (slice(seed, 3, 3)) as 0 | 1 | 2,
  }
}

/** 三种明度档的背景与前景（同一个色相下的深浅组合，保证块与底分得开）。 */
const TONES = [
  { back: 'hsl(H, 42%, 32%)', front: 'hsl(H, 58%, 72%)' },
  { back: 'hsl(H, 36%, 48%)', front: 'hsl(H, 62%, 88%)' },
  { back: 'hsl(H, 30%, 22%)', front: 'hsl(H, 54%, 62%)' },
] as const

/** 一个形状在给定尺寸下的 SVG 元素。 */
function shapeMarkup(shape: AvatarShape['core'], size: number, fill: string): string {
  const half = size / 2
  const radius = size * 0.26
  if (shape === 'circle') {
    return `<circle cx="${half}" cy="${half}" r="${radius.toFixed(1)}" fill="${fill}"/>`
  }
  if (shape === 'square') {
    const side = radius * 1.7
    const offset = (half - side / 2).toFixed(1)
    return `<rect x="${offset}" y="${offset}" width="${side.toFixed(1)}" height="${side.toFixed(1)}" rx="${(side * 0.22).toFixed(1)}" fill="${fill}"/>`
  }
  const top = (half - radius * 0.95).toFixed(1)
  const bottom = (half + radius * 0.85).toFixed(1)
  const left = (half - radius * 1.0).toFixed(1)
  const right = (half + radius * 1.0).toFixed(1)
  return `<polygon points="${half},${top} ${right},${bottom} ${left},${bottom}" fill="${fill}"/>`
}

/**
 * 画一个头像。
 *
 * 输出是**内联 SVG 源码**，不是 URL——调用方直接塞进 DOM 或 HTML 里，不需要再转 data URI。
 * `size` 只影响内部的坐标，外层由 CSS 决定实际显示多大（`viewBox` 让它自适应）。
 * @param id - 演员 id；同一个 id 永远同一张脸。
 * @param size - 画布边长（像素）。
 * @returns 一段 `<svg>` 源码。
 */
export function avatarSvg(id: string, size = 64): string {
  const shape = avatarShape(id)
  const tone = TONES[shape.tone] ?? TONES[0]
  const back = tone.back.replace('H', String(shape.hue))
  const front = tone.front.replace('H', String(shape.hue))
  const half = size / 2
  const markRadius = size * 0.17
  const markX = size * 0.74
  const markY = size * 0.26
  const markFill = `hsl(${shape.hue}, 70%, 88%)`
  const mark = shape.mark === 'circle'
    ? `<circle cx="${markX.toFixed(1)}" cy="${markY.toFixed(1)}" r="${markRadius.toFixed(1)}" fill="${markFill}"/>`
    : shape.mark === 'square'
      ? `<rect x="${(markX - markRadius).toFixed(1)}" y="${(markY - markRadius).toFixed(1)}" width="${(markRadius * 2).toFixed(1)}" height="${(markRadius * 2).toFixed(1)}" rx="${(markRadius * 0.3).toFixed(1)}" fill="${markFill}"/>`
      : `<polygon points="${markX.toFixed(1)},${(markY - markRadius).toFixed(1)} ${(markX + markRadius).toFixed(1)},${(markY + markRadius).toFixed(1)} ${(markX - markRadius).toFixed(1)},${(markY + markRadius).toFixed(1)}" fill="${markFill}"/>`
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" role="img" aria-hidden="true">`
    + `<rect width="${size}" height="${size}" fill="${back}"/>`
    + shapeMarkup(shape.core, size, front)
    + mark
    + `<circle cx="${half}" cy="${half}" r="${size * 0.42}" fill="none" stroke="hsl(${shape.hue}, 40%, 18%)" stroke-width="${(size * 0.03).toFixed(1)}" opacity="0.35"/>`
    + '</svg>'
}
