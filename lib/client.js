window.__ModuleLoader__.load({
	id: "@max-null/dsh-jubensha",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		let _deepseek_ai_dsh_client_store = require("@deepseek-ai/dsh-client-store");
		let react_jsx_runtime = require("react/jsx-runtime");
		//#region src/avatar.ts
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
		function fold(text) {
			let hash = 2166136261;
			for (let index = 0; index < text.length; index += 1) {
				hash ^= text.charCodeAt(index);
				hash = hash + ((hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24)) >>> 0;
			}
			return hash >>> 0;
		}
		/** 从哈希里取第 `index` 段，落到 `[0, modulo)` 里。 */
		function slice(seed, index, modulo) {
			return ((seed >>> index * 3 | seed << 15 - index * 3) >>> 0) % modulo;
		}
		/**
		* 由 id 决定一个头像长什么样。
		*
		* 抽出来是因为**它是判据所在**：换个 id 该换个样子，同一个 id 该永远同一个样子。
		* @param id - 演员 id。
		* @returns 这个 id 对应的形状。
		*/
		function avatarShape(id) {
			const seed = fold(id);
			const shapes = [
				"circle",
				"square",
				"triangle"
			];
			return {
				hue: slice(seed, 0, 360),
				core: shapes[slice(seed, 1, 3)] ?? "circle",
				mark: shapes[slice(seed, 2, 3)] ?? "square",
				tone: slice(seed, 3, 3)
			};
		}
		/** 三种明度档的背景与前景（同一个色相下的深浅组合，保证块与底分得开）。 */
		const TONES = [
			{
				back: "hsl(H, 42%, 32%)",
				front: "hsl(H, 58%, 72%)"
			},
			{
				back: "hsl(H, 36%, 48%)",
				front: "hsl(H, 62%, 88%)"
			},
			{
				back: "hsl(H, 30%, 22%)",
				front: "hsl(H, 54%, 62%)"
			}
		];
		/** 一个形状在给定尺寸下的 SVG 元素。 */
		function shapeMarkup(shape, size, fill) {
			const half = size / 2;
			const radius = size * .26;
			if (shape === "circle") return `<circle cx="${half}" cy="${half}" r="${radius.toFixed(1)}" fill="${fill}"/>`;
			if (shape === "square") {
				const side = radius * 1.7;
				const offset = (half - side / 2).toFixed(1);
				return `<rect x="${offset}" y="${offset}" width="${side.toFixed(1)}" height="${side.toFixed(1)}" rx="${(side * .22).toFixed(1)}" fill="${fill}"/>`;
			}
			const top = (half - radius * .95).toFixed(1);
			const bottom = (half + radius * .85).toFixed(1);
			const left = (half - radius * 1).toFixed(1);
			return `<polygon points="${half},${top} ${(half + radius * 1).toFixed(1)},${bottom} ${left},${bottom}" fill="${fill}"/>`;
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
		function avatarSvg(id, size = 64) {
			const shape = avatarShape(id);
			const tone = TONES[shape.tone] ?? TONES[0];
			const back = tone.back.replace("H", String(shape.hue));
			const front = tone.front.replace("H", String(shape.hue));
			const half = size / 2;
			const markRadius = size * .17;
			const markX = size * .74;
			const markY = size * .26;
			const markFill = `hsl(${shape.hue}, 70%, 88%)`;
			const mark = shape.mark === "circle" ? `<circle cx="${markX.toFixed(1)}" cy="${markY.toFixed(1)}" r="${markRadius.toFixed(1)}" fill="${markFill}"/>` : shape.mark === "square" ? `<rect x="${(markX - markRadius).toFixed(1)}" y="${(markY - markRadius).toFixed(1)}" width="${(markRadius * 2).toFixed(1)}" height="${(markRadius * 2).toFixed(1)}" rx="${(markRadius * .3).toFixed(1)}" fill="${markFill}"/>` : `<polygon points="${markX.toFixed(1)},${(markY - markRadius).toFixed(1)} ${(markX + markRadius).toFixed(1)},${(markY + markRadius).toFixed(1)} ${(markX - markRadius).toFixed(1)},${(markY + markRadius).toFixed(1)}" fill="${markFill}"/>`;
			return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" role="img" aria-hidden="true"><rect width="${size}" height="${size}" fill="${back}"/>` + shapeMarkup(shape.core, size, front) + mark + `<circle cx="${half}" cy="${half}" r="${size * .42}" fill="none" stroke="hsl(${shape.hue}, 40%, 18%)" stroke-width="${(size * .03).toFixed(1)}" opacity="0.35"/></svg>`;
		}
		//#endregion
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
			"room.actors": "演员",
			"room.cases": "可选的本子",
			"room.noCases": "没找到本子。本子放在插件的 cases/ 目录下，一个本子一个 case.yml。",
			"room.copy": "复制开局指令",
			"room.copied": "已复制",
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
			"room.actors": "Cast",
			"room.cases": "Cases",
			"room.noCases": "No cases found. They live under the plugin's cases/ directory, one case.yml each.",
			"room.copy": "Copy the opening instruction",
			"room.copied": "Copied",
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
		* 开着的时候去拉一次宿主侧的快照（`/jubensha/room`，见 `../room.ts`）。**只在打开时拉，
		* 不做轮询**：局面变化都是对话驱动的，而用户看着面板的时候正是他不太可能在推进阶段的时刻；
		* 想看最新的，关掉再开一次就够。轮询要处理"拉到一半局面变了"这类问题，收益不抵。
		* @param props - store 的读取座位、动作与本地化文案。
		* @returns 面板，或者什么都不渲染。
		*/
		function RoomPanel({ useStore, actions, t }) {
			const open = useStore((state) => state.open);
			const [snapshot, setSnapshot] = (0, react.useState)(null);
			const [problem, setProblem] = (0, react.useState)(null);
			(0, react.useEffect)(() => {
				if (!open) return void 0;
				let cancelled = false;
				(async () => {
					try {
						const response = await fetch("/jubensha/room");
						const body = await response.json();
						if (cancelled) return;
						if (body.ok === true && body.value !== void 0) {
							setSnapshot(body.value);
							setProblem(null);
						} else setProblem(body.error ?? `HTTP ${response.status}`);
					} catch (cause) {
						if (!cancelled) setProblem(cause instanceof Error ? cause.message : String(cause));
					}
				})();
				return () => {
					cancelled = true;
				};
			}, [open]);
			if (!open) return null;
			const game = snapshot?.game ?? null;
			const actors = snapshot?.actors ?? [];
			const players = snapshot?.players ?? [];
			const cases = snapshot?.cases ?? [];
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
							marginBottom: "10px"
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
					problem !== null ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						style: {
							margin: "0 0 8px",
							color: "var(--dsw-danger, #e06c75)"
						},
						children: problem
					}) : null,
					game === null ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						style: {
							margin: "0 0 10px",
							opacity: .85
						},
						children: t("room.empty")
					}) : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						style: { marginBottom: "10px" },
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								style: {
									opacity: .7,
									fontSize: "12px"
								},
								children: [
									t("room.phase"),
									" · ",
									t("room.round")
								]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("b", { children: game.title }),
								"（case ",
								game.caseId,
								"）"
							] }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								style: { opacity: .85 },
								children: [
									game.phase,
									" · 第 ",
									game.round,
									" 轮 · 线索 ",
									game.revealedClues.length,
									" 条"
								]
							})
						]
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						style: { marginBottom: "10px" },
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							style: {
								opacity: .7,
								fontSize: "12px"
							},
							children: t("room.seats")
						}), game.seats.map((seat) => {
							const sitting = players.find((player) => player.seat === seat);
							const mine = seat === game.humanSeat;
							return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								style: {
									display: "flex",
									gap: "6px",
									alignItems: "center"
								},
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									style: {
										opacity: .6,
										width: "28px"
									},
									children: seat
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: sitting?.name ?? (mine ? `（${t("room.human")}）` : "—") })]
							}, seat);
						})]
					})] }),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						style: { marginBottom: "10px" },
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							style: {
								opacity: .7,
								fontSize: "12px",
								marginBottom: "4px"
							},
							children: t("room.cases")
						}), cases.length === 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
							style: {
								margin: "2px 0 0",
								opacity: .8
							},
							children: t("room.noCases")
						}) : cases.map((entry) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							style: { marginBottom: "6px" },
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [
								entry.title,
								"（case ",
								entry.id,
								"｜",
								entry.genre,
								"）"
							] }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								style: {
									opacity: .65,
									fontSize: "12px"
								},
								children: entry.roles.map((role) => `${role.id} ${role.name}`).join(" · ")
							})]
						}, entry.id))]
					}),
					actors.length > 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						style: {
							opacity: .7,
							fontSize: "12px",
							marginBottom: "4px"
						},
						children: t("room.actors")
					}), actors.map((actor) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						style: {
							display: "flex",
							gap: "8px",
							alignItems: "center",
							marginBottom: "6px"
						},
						children: [actor.avatar === void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							style: {
								display: "inline-flex",
								width: "28px",
								height: "28px",
								borderRadius: "6px",
								overflow: "hidden"
							},
							dangerouslySetInnerHTML: { __html: avatarSvg(actor.id, 28) }
						}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("img", {
							src: actor.avatar,
							alt: "",
							width: 28,
							height: 28,
							style: {
								borderRadius: "6px",
								objectFit: "cover"
							}
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							style: { minWidth: 0 },
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", { children: actor.name }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								style: {
									opacity: .6,
									fontSize: "12px",
									overflow: "hidden",
									textOverflow: "ellipsis",
									whiteSpace: "nowrap"
								},
								children: actor.style
							})]
						})]
					}, actor.id))] }) : null,
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						style: {
							margin: "10px 0 0",
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