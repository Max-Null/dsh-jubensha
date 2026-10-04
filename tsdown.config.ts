/**
 * tsdown build：一个包两个半边。
 *
 * - **宿主半边** `lib/index.js`（ESM / node）：工具注册、演员池、局面状态机。
 * - **浏览器半边** `lib/client.js`（CJS / browser）：房间面板。
 *
 * 浏览器半边为什么是 CJS 加一层壳：DSH 的 web 壳用一个冻结的模块表加载客户端插件，
 * 每个插件的产物要自报 id 并交出工厂函数（`window.__ModuleLoader__.load({ id, factory })`）。
 * 这不是自由选择——壳按这个协议取产物。写法照 `dsh-chat-rail/tsdown.config.ts`。
 *
 * `CLIENT_EXTERNALS` 只有基线模块：React 与 cordis 由壳共享进来（平台模块表的词），
 * 其余一切都要打进产物里。跨插件的**值**导入在这里是被禁止的——要协作就走 cordis 服务，
 * 要共用界面就走 slot。
 *
 * `src/avatar.ts` 两边都 import：它是零依赖纯函数，所以两边都用得起；它一旦 import 了
 * storage 或 zod，浏览器半边就会把宿主专属依赖一起打进去。
 */
import type { UserConfig } from 'tsdown'

/** 壳共享进冻结模块表的那些词。 */
const CLIENT_EXTERNALS = [
  'react',
  'react/jsx-runtime',
  'react-dom',
  'react-dom/client',
  'cordis',
  // 平台基线里还有 ui-slots / ui-renderer / ui-primitives / ui-dockkit——那四个这里只
  // **类型导入**（会被擦除），所以不必列进来。而 `client-store` 是**值导入**（`defineStore`），
  // 不列的话纯度门会把这条完全合法的基线导入一起拒掉。
  '@deepseek-ai/dsh-client-store',
]

/** 浏览器半边不许带进来的东西：任何跨插件的值导入。类型导入会被擦除，不受影响。 */
const purityGate = () => ({
  name: 'dsh-jubensha-client-purity',
  resolveId(source: string): null {
    if (source.startsWith('@deepseek-ai/') && !CLIENT_EXTERNALS.includes(source)) {
      throw new Error(
        `client bundle purity: "${source}" 不是平台模块——跨插件值导入是禁止的；`
        + '要协作就走 cordis 服务，要共用界面就走 slot。',
      )
    }
    return null
  },
})

export default [
  {
    entry: { index: 'src/index.ts' },
    outDir: 'lib',
    format: ['esm'],
    platform: 'node',
    target: 'es2024',
    dts: false,
    clean: true,
  },
  {
    entry: { client: 'src/client/index.tsx' },
    outDir: 'lib',
    format: 'cjs',
    platform: 'browser',
    dts: false,
    sourcemap: true,
    clean: false,
    external: [...CLIENT_EXTERNALS],
    noExternal: (id: string) => (CLIENT_EXTERNALS.includes(id) ? undefined : true),
    plugins: [purityGate()],
    outputOptions: {
      entryFileNames: 'client.js',
      banner: `window.__ModuleLoader__.load({ id: ${JSON.stringify('@max-null/dsh-jubensha')}, factory: (require) => {`,
      footer: 'return module.exports; } });',
      intro: 'var module = { exports: {} }; var exports = module.exports;',
      codeSplitting: false,
    },
  },
] satisfies UserConfig[]
