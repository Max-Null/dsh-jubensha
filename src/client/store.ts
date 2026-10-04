/**
 * 房间面板的开合状态。
 *
 * **为什么它得是 store 而不是组件里的 `useState`**：面板有两个入口（输入框旁那个按钮、
 * 以及快捷键），而"开着没有"这件事实必须被它们共享；面板本体挂在 `shell.overlay`、
 * 按钮挂在 `conversation.input.dock`——两个不相干的父槽，组件的局部状态传不过去。
 *
 * 状态只有"开不开"这一件事。房间的内容（局面、座位、演员）**不进 store**：那些是业务数据，
 * 按客户端分层规则该留在数据层，由组件从会话事件里读。
 *
 * @module @max-null/dsh-jubensha/client/store
 */
import { defineStore } from '@deepseek-ai/dsh-client-store'

/** 面板的状态。 */
interface RoomState {
  /** 面板开着没有。 */
  open: boolean
}

/**
 * 声明房间面板的 store。
 *
 * **返回类型交给推断**，不写 `EngineStoreHandle<RoomState, RoomActions>`：那个显式标注要求
 * actions 类型带索引签名，而它本该由 `defineStore` 从字面量推出来。组件侧用
 * `ReturnType<typeof createRoomStore>` 拿到同一个类型，两边不会漂。
 * @returns 一个可传进 `slots.register` 的句柄。
 */
export function createRoomStore() {
  return defineStore({
    init: (): RoomState => ({ open: false }),
    actions: {
      /** 打开面板。 */
      open: (draft: RoomState) => { draft.open = true },
      /** 关上。 */
      close: (draft: RoomState) => { draft.open = false },
      /** 开着就关、关着就开——按钮与快捷键都走它。 */
      toggle: (draft: RoomState) => { draft.open = !draft.open },
    },
  })
}
