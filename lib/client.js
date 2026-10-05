window.__ModuleLoader__.load({
	id: "@max-null/dsh-jubensha",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
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
		//#region src/instruction.ts
		/**
		* 写一段交给主持人的开局指令。
		*
		* 它**不替主持人决定**：角色本怎么取、上桌顺序、开局第一句说什么，都留着。这里给的是
		* 那一局的骨架——本子在哪、谁坐哪、谁演谁——剩下的按本子与人的现场判断来。
		* @param entry - 选中的本子。
		* @param assignment - 排好的座位；只含 AI 位子，真人位子不在这里（它是你自己）。
		* @returns 一段可以直接粘进对话的文本。
		*/
		function openingInstruction(entry, assignment) {
			const seats = entry.roles.map((role) => role.id);
			const human = entry.roles.filter((role) => role.player === "human").map((role) => role.id);
			const lines = [
				`开一局《${entry.title}》（case ${entry.id}）。`,
				"",
				"① 取本子（先 load，它会顺带报出格式问题）：",
				`   jubensha_case —— action="load", dir="${entry.path}"`,
				"",
				"② 开局：",
				`   jubensha_state —— action="start", caseId="${entry.id}", title="${entry.title}", seats=${JSON.stringify(seats)}, humanSeat="${human[0] ?? ""}"`
			];
			if (assignment.length > 0) {
				lines.push("", "③ 让这几位上桌。**一座一份**：用 jubensha_case action=\"book\" 取到的是那个座位的引用，原样填进 roleBook，别转述、别换座位；actor 是他跨局的身份：");
				for (const one of assignment) lines.push(`   ${one.seat} ${one.roleName} → actor="${one.actorId}"（${one.actorName}）`);
			}
			lines.push("", "剩下的按本子来——开局第一句、节奏、什么时候该搜证，你比我清楚。");
			return lines.join("\n");
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
			"view.team": "团队",
			"room.phase": "阶段",
			"room.round": "第几轮",
			"room.seats": "桌上的位子",
			"room.actors": "演员",
			"room.cases": "可选的本子",
			"room.noCases": "没找到本子。本子放在插件的 cases/ 目录下，一个本子一个 case.yml。",
			"room.copy": "复制开局指令",
			"room.copied": "已复制",
			"room.pickActor": "（挑一个演员）",
			"room.human": "你",
			"room.empty": "还没开局。在对话里让主持人开一局，这里就会显示局面。",
			"room.hint": "这里是只读的，会跟着对话走——开一局、推进阶段、发线索都在对话里说。"
		};
		/** English copy. */
		const en = {
			"view.team": "Team",
			"room.phase": "Phase",
			"room.round": "Round",
			"room.seats": "Seats",
			"room.actors": "Cast",
			"room.cases": "Cases",
			"room.noCases": "No cases found. They live under the plugin's cases/ directory, one case.yml each.",
			"room.copy": "Copy the opening instruction",
			"room.copied": "Copied",
			"room.pickActor": "(pick an actor)",
			"room.human": "you",
			"room.empty": "No game yet. Ask the host in the conversation to start one, and the table shows up here.",
			"room.hint": "Read-only, and it follows the conversation — starting a game, advancing phases and dealing clues all happen in the chat."
		};
		//#endregion
		//#region src/client/index.tsx
		/**
		* 房间 —— 剧本杀的那张桌子，装在会话视图的一个标签里，标签叫「团队」。
		*
		* **为什么叫「团队」**：它本来就在讲这件事——桌上坐着谁、谁演谁、这一局到哪一步了。
		* 一个叫「团队」的标签与「对话 / 轨迹 / 上下文」并列，看起来就是 Agent Teams 的名单。
		* 而**这个伪装性是有用的**：对话形态唯一的面板给不了的东西，就是「看起来在干别的」——
		* 那正是这个插件存在的第一个理由（用户原话「极其隐蔽，适合摸鱼」）。所以标签名不是随便起
		* 的，它得经得起旁边的人扫一眼。
		*
		* **只有这一处挂载。** 曾经还有侧栏底部一个入口按钮与一个 `shell.overlay` 浮层，去掉的理由是
		* 它们要一份 store 来共享开合状态、而标签不需要那件事：一个常驻的标签本身就是"一直开着"，
		* 再给同一份内容配一条开合的路，只是让同一块东西有两个入口、两套状态、两处要维护。
		*
		* **它属于某个会话，不是属于这个进程。** `conversation.view` 的 inject 会告诉我们是谁在看我，
		* 而快照按那个 id 取——局面是**每个会话各自一局**（见 `../index.ts` 里 `games` 的注释）。
		*
		* **它是附加层，不是第二条数据通道。** 宿主半边一行都没为它改：内容全部来自那个只读端点
		* `/jubensha/room`（见 `../room.ts`），而「排座」只生成一段文本交给主持人，不自己调工具。
		*
		* @module @max-null/dsh-jubensha/client
		*/
		/** 需要的服务：`locale` 注册文案，`slots` 挂标签。 */
		const inject = ["locale", "slots"];
		/** 一行小标题。 */
		function Heading({ children }) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				style: {
					opacity: .7,
					fontSize: "12px",
					marginBottom: "4px"
				},
				children
			});
		}
		/**
		* 房间的内容本身。
		*
		* **它自己拉数据**，每 4 秒一次（页面藏起来时不拉）。一开始不做轮询，理由是「用户看着它的时候
		* 正是他不太可能在推进阶段的时刻」——那个理由被推翻了：标签是**常驻**的，只在挂载时拉一次等于
		* 之后再不动，看着就像"房间和会话没有联动"。**该问的不是"用户会看多久"，是"这个界面活多久"。**
		* @param props - 本地化文案与这个标签属于哪个会话。
		* @returns 房间的内容。
		*/
		function RoomBody({ t, sessionId }) {
			const [snapshot, setSnapshot] = (0, react.useState)(null);
			const [problem, setProblem] = (0, react.useState)(null);
			const [chosen, setChosen] = (0, react.useState)(null);
			const [cast, setCast] = (0, react.useState)({});
			const [copied, setCopied] = (0, react.useState)(false);
			(0, react.useEffect)(() => {
				let cancelled = false;
				const load = async () => {
					try {
						const response = await fetch(`/jubensha/room?session=${encodeURIComponent(sessionId)}`);
						const body = await response.json();
						if (cancelled) return;
						if (body.ok === true && body.value !== void 0) {
							setSnapshot(body.value);
							setProblem(null);
						} else setProblem(body.error ?? `HTTP ${response.status}`);
					} catch (cause) {
						if (!cancelled) setProblem(cause instanceof Error ? cause.message : String(cause));
					}
				};
				load();
				const timer = window.setInterval(() => {
					if (document.visibilityState === "visible") load();
				}, 4e3);
				return () => {
					cancelled = true;
					window.clearInterval(timer);
				};
			}, [sessionId]);
			const game = snapshot?.game ?? null;
			const actors = snapshot?.actors ?? [];
			const players = snapshot?.players ?? [];
			const cases = snapshot?.cases ?? [];
			const chosenEntry = cases.find((one) => one.id === chosen) ?? null;
			const assignment = chosenEntry === null ? [] : chosenEntry.roles.filter((role) => role.player === "ai").flatMap((role) => {
				const actor = actors.find((one) => one.id === cast[`${chosenEntry.id}:${role.id}`]);
				return actor === void 0 ? [] : [{
					seat: role.id,
					roleName: role.name,
					actorId: actor.id,
					actorName: actor.name
				}];
			});
			const copyInstruction = async () => {
				if (chosenEntry === null) return;
				try {
					await navigator.clipboard.writeText(openingInstruction(chosenEntry, assignment));
					setCopied(true);
					window.setTimeout(() => setCopied(false), 1500);
				} catch (cause) {
					setProblem(cause instanceof Error ? cause.message : String(cause));
				}
			};
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
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
				}) : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					style: { marginBottom: "10px" },
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Heading, { children: `${t("room.phase")} · ${t("room.round")}` }),
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
				}),
				/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					style: { marginBottom: "10px" },
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Heading, { children: t("room.seats") }), game === null ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						style: { opacity: .6 },
						children: "—"
					}) : game.seats.map((seat) => {
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
				}),
				/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					style: { marginBottom: "10px" },
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Heading, { children: t("room.cases") }), cases.length === 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						style: {
							margin: "2px 0 0",
							opacity: .8
						},
						children: t("room.noCases")
					}) : cases.map((entry) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						style: { marginBottom: "6px" },
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
								style: {
									display: "flex",
									gap: "6px",
									alignItems: "baseline",
									cursor: "pointer"
								},
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
									type: "radio",
									name: "jubensha-case",
									checked: chosen === entry.id,
									onChange: () => {
										setChosen(entry.id);
										setCopied(false);
									}
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", { children: [
									entry.title,
									"（case ",
									entry.id,
									"｜",
									entry.genre,
									"）"
								] })]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								style: {
									opacity: .65,
									fontSize: "12px",
									marginLeft: "20px"
								},
								children: entry.roles.map((role) => `${role.id} ${role.name}`).join(" · ")
							}),
							chosen === entry.id ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								style: {
									marginLeft: "20px",
									marginTop: "5px"
								},
								children: [
									entry.roles.filter((role) => role.player === "ai").map((role) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
										style: {
											display: "flex",
											gap: "6px",
											alignItems: "center",
											marginBottom: "3px"
										},
										children: [
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
												style: {
													opacity: .6,
													width: "24px"
												},
												children: role.id
											}),
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
												style: { flex: 1 },
												children: role.name
											}),
											/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("select", {
												"aria-label": `${role.id} ${role.name}`,
												value: cast[`${entry.id}:${role.id}`] ?? "",
												onChange: (event) => {
													setCast({
														...cast,
														[`${entry.id}:${role.id}`]: event.target.value
													});
													setCopied(false);
												},
												children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
													value: "",
													children: t("room.pickActor")
												}), actors.map((actor) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
													value: actor.id,
													disabled: Object.entries(cast).some(([key, value]) => value === actor.id && key !== `${entry.id}:${role.id}`),
													children: actor.name
												}, actor.id))]
											})
										]
									}, role.id)),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
										type: "button",
										onClick: () => void copyInstruction(),
										style: {
											marginTop: "4px",
											padding: "3px 10px",
											borderRadius: "8px",
											border: "1px solid var(--dsw-border-subtle, rgba(127,127,127,0.28))",
											background: "transparent",
											color: "inherit",
											font: "inherit",
											fontSize: "12px",
											cursor: "pointer"
										},
										children: copied ? t("room.copied") : t("room.copy")
									}),
									assignment.length > 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("pre", {
										style: {
											margin: "6px 0 0",
											padding: "6px 8px",
											maxHeight: "150px",
											overflow: "auto",
											background: "var(--dsw-surface-sunken, rgba(127,127,127,0.10))",
											borderRadius: "8px",
											fontSize: "11px",
											lineHeight: 1.5,
											whiteSpace: "pre-wrap"
										},
										children: openingInstruction(entry, assignment)
									}) : null
								]
							}) : null
						]
					}, entry.id))]
				}),
				actors.length > 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Heading, { children: t("room.actors") }), actors.map((actor) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
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
			] });
		}
		/**
		* 会话视图的那个标签。
		*
		* 标签文字由 `apply` 里的 `label` 给（「团队」），组件本身只要渲染内容——它没有框、没有关闭
		* 按钮，因为它跟「对话 / 轨迹 / 上下文」一样是常驻的一栏。
		* @param props - 本地化文案与注入面（谁在看我）。
		* @returns 房间的内容。
		*/
		function TeamView({ t, sessionId }) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				style: {
					padding: "12px 16px",
					fontSize: "13px",
					lineHeight: 1.6
				},
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(RoomBody, {
					t,
					sessionId
				})
			});
		}
		/**
		* 挂上那个标签。
		* @param ctx - 客户端的插件上下文。
		*/
		function apply(ctx) {
			ctx.effect(() => ctx.locale.register("jubensha", {
				zh,
				en
			}), "jubensha: dictionaries");
			ctx.slots.inject("conversation.view", () => ctx.slots.register({
				name: "conversation.view",
				id: "jubensha.team",
				order: 20,
				locale: "jubensha",
				label: () => ctx.locale.bind("jubensha")("view.team"),
				inject: (sessionId) => ({ sessionId })
			}, TeamView));
		}
		//#endregion
		exports.RoomBody = RoomBody;
		exports.TeamView = TeamView;
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});

//# sourceMappingURL=client.js.map