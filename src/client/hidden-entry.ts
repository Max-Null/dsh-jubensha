/**
 * 隐蔽入口：在新会话那一页的标题上连点三下。
 *
 * **为什么要有它。** 这个插件的用法本来就是「摸鱼」——它伪装成「团队」标签，而开局的路是
 * 「在对话里说一句话」。可新会话那张空白页上，用户不知道该说什么：他手里没有一个能点的东西。
 * 而那一页也没有位置给一个按钮——`ui-conversation` 只留了 `hero.workspace` / `hero.brand.mark` /
 * `hero.agentPreset` 三个槽，三个都是 `single`，抢哪个都是替换掉官方的东西（标题前那个方块就是
 * `brand.mark`）。所以入口做成手势：**连点三下标题**，输入框里就会出现那句话。
 *
 * **为什么按 class 后缀认标题。** 那是 CSS Modules 的类名，前缀（`vdz1Dq_`）在构建时会变，
 * 而 `_headline` 这一段来自源码，是稳的。按文本认不行——「探索未至之境」是 locale 字符串，
 * 换个语言就找不着了。
 *
 * **为什么是「填进输入框」而不是「直接发出去」。** 桌上那张牌是用户在打：他该看见自己在说什么，
 * 也该有机会改一个字或者干脆删掉。三下点击是个很容易误触的手势，直接发就走得太远了。
 *
 * @module @max-null/dsh-jubensha/client/hidden-entry
 * @param onTrigger - 触发时做什么（把一句话填进输入框，或者别的）。
 * @returns 卸下监听的函数。
 */
export function installHiddenEntry(onTrigger: () => void): () => void {
  /** 三下之间的间隔上限。超过就当是新的一轮，免得白天随手点的三下攒到晚上一起算。 */
  const WINDOW_MS = 900
  let hits = 0
  let last = 0

  const onClick = (event: MouseEvent): void => {
    const target = event.target
    if (!(target instanceof Element)) return
    // `closest` 而不是 `===`：点中的往往是标题里的一层 span（图标 / 文字）。
    if (target.closest('[class*="_headline"]') === null) {
      hits = 0
      return
    }
    const now = Date.now()
    hits = now - last <= WINDOW_MS ? hits + 1 : 1
    last = now
    if (hits < 3) return
    hits = 0
    onTrigger()
  }

  // 捕获阶段：标题区里可能有别的监听者把事件吃掉（比如它自己要处理点击），而这里只想数数。
  document.addEventListener('click', onClick, true)
  return () => document.removeEventListener('click', onClick, true)
}

/**
 * 把一句话填进输入框，并把光标放过去。
 *
 * 直接改 `value` 不行：那个输入框受 React 管，改完它下一次渲染会把这句抹掉。所以走
 * `insertText`——那是「用户打字」那条路，React 收得到。
 *
 * @param text - 要填进去的话。
 * @returns 填成功了没有；没找到输入框（比如还在新会话那一页）就返回 false。
 */
export function fillComposer(text: string): boolean {
  const composer = document.querySelector('textarea, [contenteditable="true"]')
  if (composer === null) return false
  if (composer instanceof HTMLTextAreaElement) {
    composer.focus()
    // 先清空：连点两轮不该叠成两句话。
    composer.setSelectionRange(0, composer.value.length)
  } else {
    // contenteditable：先选中全部，再插入——同样是为了不叠加。
    const range = document.createRange()
    range.selectNodeContents(composer)
    const selection = window.getSelection()
    selection?.removeAllRanges()
    selection?.addRange(range)
    if (composer instanceof HTMLElement) composer.focus()
  }
  document.execCommand('insertText', false, text)
  return true
}
