window.__ModuleLoader__.load({
	id: "@max-null/dsh-jubensha",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let _deepseek_ai_dsh_client_store = require("@deepseek-ai/dsh-client-store");
		let react_jsx_runtime = require("react/jsx-runtime");
		//#region src/client/store.ts
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
		/**
		* 声明房间面板的 store。
		*
		* **返回类型交给推断**，不写 `EngineStoreHandle<RoomState, RoomActions>`：那个显式标注要求
		* actions 类型带索引签名，而它本该由 `defineStore` 从字面量推出来。组件侧用
		* `ReturnType<typeof createRoomStore>` 拿到同一个类型，两边不会漂。
		* @returns 一个可传进 `slots.register` 的句柄。
		*/
		function createRoomStore() {
			return (0, _deepseek_ai_dsh_client_store.defineStore)({
				init: () => ({ open: false }),
				actions: {
					/** 打开面板。 */
					open: (draft) => {
						draft.open = true;
					},
					/** 关上。 */
					close: (draft) => {
						draft.open = false;
					},
					/** 开着就关、关着就开——按钮与快捷键都走它。 */
					toggle: (draft) => {
						draft.open = !draft.open;
					}
				}
			});
		}
		//#endregion
		//#region src/client/locales.ts
		/**
		* 房间面板的文案。
		*
		* **为什么文案不写在组件里**：DSH 客户端有一条硬约定——每一个产品可见的字符串都必须来自
		* typed 字典，经 `t` 座位到达组件。这条不是形式主义：文案集中在一处才可能被翻译、被统一，
		* 散在 JSX 里的字符串则两样都做不到。命名空间键在 `index.tsx` 里用声明合并登记。
		*
		* @module @max-null/dsh-jubensha/client/locales
		*/
		/** 中文文案。 */
		const zh = {
			"room.open": "房间",
			"room.openTitle": "打开剧本杀房间",
			"room.title": "剧本杀房间",
			"room.close": "关上",
			"room.phase": "阶段",
			"room.round": "第几轮",
			"room.seats": "桌上的位子",
			"room.human": "你",
			"room.empty": "还没开局。在对话里让主持人开一局，这里就会显示局面。",
			"room.hint": "面板是只读的——开一局、推进阶段、发线索都在对话里说。"
		};
		/** English copy. */
		const en = {
			"room.open": "Room",
			"room.openTitle": "Open the jubensha room",
			"room.title": "Jubensha room",
			"room.close": "Close",
			"room.phase": "Phase",
			"room.round": "Round",
			"room.seats": "Seats",
			"room.human": "you",
			"room.empty": "No game yet. Ask the host in the conversation to start one, and the table shows up here.",
			"room.hint": "This panel is read-only — starting a game, advancing phases and dealing clues all happen in the conversation."
		};
		//#endregion
		//#region src/client/index.tsx
		/** 需要的服务。`locale` 注册文案，`slots` 挂两块东西。 */
		const inject = ["locale", "slots"];
		/** 面板的样式。先写成一份常量：换成 CSS Module 要动构建配置，而那属于面板成型之后的事。 */
		const panelStyle = {
			position: "fixed",
			top: "72px",
			right: "24px",
			width: "300px",
			maxHeight: "70vh",
			overflowY: "auto",
			padding: "14px 16px",
			borderRadius: "12px",
			border: "1px solid var(--dsw-border-subtle, rgba(127,127,127,0.28))",
			background: "var(--dsw-surface-raised, rgba(28,30,36,0.96))",
			color: "var(--dsw-text-primary, inherit)",
			boxShadow: "0 12px 32px rgba(0,0,0,0.28)",
			fontSize: "13px",
			lineHeight: 1.6,
			zIndex: 30
		};
		/**
		* 侧栏底部那个入口按钮。
		* @param props - store 的动作与本地化文案。
		* @returns 一个按钮。
		*/
		function RoomButton({ actions, t }) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
				type: "button",
				title: t("room.openTitle"),
				"aria-label": t("room.openTitle"),
				onClick: () => actions.toggle(),
				style: {
					display: "inline-flex",
					alignItems: "center",
					height: "28px",
					padding: "0 10px",
					borderRadius: "8px",
					border: "1px solid var(--dsw-border-subtle, rgba(127,127,127,0.28))",
					background: "transparent",
					color: "inherit",
					font: "inherit",
					fontSize: "12px",
					cursor: "pointer"
				},
				children: t("room.open")
			});
		}
		/**
		* 面板本体。
		*
		* 关着的时候返回 `null`——挂上就不渲染，这是浮层槽的常规做法。
		* @param props - store 的读取座位、动作与本地化文案。
		* @returns 面板，或者什么都不渲染。
		*/
		function RoomPanel({ useStore, actions, t }) {
			if (!useStore((state) => state.open)) return null;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				style: panelStyle,
				role: "dialog",
				"aria-label": t("room.title"),
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						style: {
							display: "flex",
							alignItems: "center",
							justifyContent: "space-between",
							marginBottom: "8px"
						},
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: t("room.title") }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							"aria-label": t("room.close"),
							onClick: () => actions.close(),
							style: {
								background: "transparent",
								border: "none",
								color: "inherit",
								cursor: "pointer",
								font: "inherit"
							},
							children: "✕"
						})]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						style: {
							margin: "0 0 6px",
							opacity: .85
						},
						children: t("room.empty")
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						style: {
							margin: 0,
							opacity: .6,
							fontSize: "12px"
						},
						children: t("room.hint")
					})
				]
			});
		}
		/**
		* 挂上入口按钮与面板。
		* @param ctx - 客户端的插件上下文。
		*/
		function apply(ctx) {
			ctx.effect(() => ctx.locale.register("jubensha", {
				zh,
				en
			}), "jubensha: dictionaries");
			const handle = createRoomStore();
			const store = {
				...handle,
				create: () => handle.create()
			};
			ctx.slots.inject("sidebar.footer.action", () => ctx.slots.register({
				name: "sidebar.footer.action",
				id: "jubensha.room.open",
				locale: "jubensha",
				store
			}, RoomButton));
			ctx.slots.inject("shell.overlay", () => ctx.slots.register({
				name: "shell.overlay",
				id: "jubensha.room",
				locale: "jubensha",
				store
			}, RoomPanel));
		}
		//#endregion
		exports.RoomButton = RoomButton;
		exports.RoomPanel = RoomPanel;
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});

//# sourceMappingURL=client.js.map