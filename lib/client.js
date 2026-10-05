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
		//#region src/client/room.tsx
		/**
		* 房间页的三个栏。
		*
		* **它是附加层**：这里的每一块都从 `/jubensha/room` 那份只读快照来（见 `../room.ts`），
		* 宿主侧的工具与状态机不为它改结构。所以下面每个区块都要能回答「数据从哪儿来」——
		* 答不上来的地方就先**明说它缺**，而不是画一个空壳。
		*
		* 三栏的分工来自界面设计（`docs/设计/2026-10-05-房间与设置-界面设计.md` §2）：
		*
		* | 栏 | 管什么 |
		* |---|---|
		* | 左 | 这一局的人：座位、关系、时间线 |
		* | 中 | 主区：剧本正文（常驻回看）+ 当前阶段那一页 |
		* | 右 | 桌上说了什么 |
		*
		* **没有开局的位子**：中栏换成「开一局」——选本子、排座、生成指令。这是刻意的：那一区只在
		* 没有局面时出现，而有局面时中栏该是这一局本身。
		*
		* @module @max-null/dsh-jubensha/client/room
		*/
		/** 五个阶段，按顺序。 */
		const PHASES = [
			"self-intro",
			"inquiry",
			"search",
			"final",
			"reveal"
		];
		/** 一行小标题。 */
		function Heading({ children }) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				style: {
					opacity: .7,
					fontSize: "12px",
					marginBottom: "5px"
				},
				children
			});
		}
		/** 一个方块。 */
		function Card({ children }) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				style: {
					border: "1px solid var(--dsw-border-subtle, rgba(127,127,127,0.28))",
					borderRadius: "10px",
					background: "var(--dsw-surface-sunken, rgba(127,127,127,0.06))",
					padding: "9px 12px",
					marginBottom: "8px"
				},
				children
			});
		}
		/** 头像：配了图就用图，没配就按演员 id 画一个。 */
		function Face({ id, avatar, size = 30 }) {
			const style = {
				width: `${size}px`,
				height: `${size}px`,
				borderRadius: "8px",
				flex: "none",
				overflow: "hidden"
			};
			if (avatar !== void 0) return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("img", {
				src: avatar,
				alt: "",
				style: {
					...style,
					objectFit: "cover"
				}
			});
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
				style,
				dangerouslySetInnerHTML: { __html: avatarSvg(id, size) }
			});
		}
		/**
		* 左栏：这一局的人。
		* @param props - 快照与本地化文案。
		* @returns 三个区块。
		*/
		function LeftColumn({ snapshot, t }) {
			const game = snapshot.game;
			const seats = game?.seats ?? [];
			const caseEntry = snapshot.cases.find((one) => one.id === game?.caseId);
			const roleOf = (seat) => caseEntry?.roles.find((role) => role.id === seat);
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				style: { padding: "14px 16px" },
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
						style: { marginBottom: "18px" },
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Heading, { children: t("left.table") }), seats.length === 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							style: { opacity: .6 },
							children: "—"
						}) : seats.map((seat) => {
							const sitting = snapshot.players.find((player) => player.seat === seat);
							const mine = seat === game?.humanSeat;
							const role = roleOf(seat);
							return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								style: {
									display: "flex",
									alignItems: "center",
									gap: "9px",
									padding: "5px 0"
								},
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										style: {
											opacity: .6,
											width: "20px",
											fontSize: "11px"
										},
										children: seat
									}),
									sitting === void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { style: {
										width: "30px",
										height: "30px",
										borderRadius: "8px",
										flex: "none",
										background: "var(--dsw-surface-sunken, rgba(127,127,127,0.12))"
									} }) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Face, { id: seat }),
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
										style: {
											flex: 1,
											minWidth: 0
										},
										children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("b", { children: sitting?.name ?? role?.name ?? seat }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											style: {
												display: "block",
												opacity: .65,
												fontSize: "11.5px"
											},
											children: role?.public ?? ""
										})]
									}),
									mine ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										style: {
											fontSize: "11px",
											color: "var(--dsw-accent, #4a7fd4)"
										},
										children: t("left.you")
									}) : null
								]
							}, seat);
						})]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
						style: { marginBottom: "18px" },
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Heading, { children: t("left.relations") }), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							style: { fontSize: "12px" },
							children: [(caseEntry?.roles ?? []).map((role) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								style: { padding: "2px 0" },
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("b", { children: role.name }), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
									style: {
										color: "inherit",
										opacity: .65
									},
									children: ["　", role.public]
								})]
							}, role.id)), caseEntry === void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								style: { opacity: .6 },
								children: "—"
							}) : null]
						})]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Heading, { children: t("left.timeline") }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						style: {
							fontSize: "12px",
							opacity: .6
						},
						children: t("left.nothingSaid")
					})] })
				]
			});
		}
		/**
		* 中栏：剧本正文 + 当前阶段那一页。
		* @param props - 快照、当前看哪一页、以及切换用的回调。
		* @returns 主区。
		*/
		function MidColumn({ snapshot, phase, t }) {
			const game = snapshot.game;
			const caseEntry = snapshot.cases.find((one) => one.id === game?.caseId);
			const human = caseEntry?.roles.find((role) => role.player === "human");
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				style: {
					maxWidth: "640px",
					width: "100%",
					margin: "0 auto",
					padding: "14px 20px 40px"
				},
				children: [
					game?.script !== void 0 && game.script !== "" ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("details", {
						open: true,
						style: {
							border: "1px solid var(--dsw-border-subtle, rgba(127,127,127,0.28))",
							borderRadius: "10px",
							background: "var(--dsw-surface-sunken, rgba(127,127,127,0.06))",
							marginBottom: "14px"
						},
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("summary", {
							style: {
								cursor: "pointer",
								padding: "8px 12px",
								fontSize: "12px",
								opacity: .75,
								fontWeight: 600
							},
							children: [
								t("mid.script"),
								" · ",
								human?.name ?? "",
								" ",
								t("mid.scriptHint")
							]
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							style: {
								padding: "2px 20px 16px",
								fontSize: "13.5px",
								lineHeight: 1.95,
								whiteSpace: "pre-wrap"
							},
							children: game.script
						})]
					}) : null,
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h2", {
						style: {
							fontSize: "14px",
							margin: "0 0 4px",
							fontWeight: 600
						},
						children: t(`phase.${phase}`)
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						style: {
							opacity: .7,
							fontSize: "12px",
							margin: "0 0 14px"
						},
						children: leadOf(phase, t)
					}),
					phase === "self-intro" ? (game?.seats ?? []).map((seat) => {
						const sitting = snapshot.players.find((player) => player.seat === seat);
						const role = caseEntry?.roles.find((one) => one.id === seat);
						return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Card, { children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							style: {
								display: "flex",
								gap: "8px",
								alignItems: "baseline"
							},
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("b", { children: role?.name ?? seat }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								style: {
									opacity: .6,
									fontSize: "11.5px"
								},
								children: sitting === void 0 ? t("left.notSeated") : `${t("saidSoFar")} · ${sitting.name}`
							})]
						}) }, seat);
					}) : null,
					phase === "inquiry" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Card, { children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						style: {
							fontSize: "12.5px",
							opacity: .75
						},
						children: t("right.pending")
					}) }) : null,
					phase === "search" ? (game?.clues ?? []).map((clue) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(Card, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						style: {
							display: "flex",
							gap: "8px",
							alignItems: "baseline",
							marginBottom: "3px"
						},
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							style: {
								fontSize: "11px",
								opacity: .6,
								border: "1px solid var(--dsw-border-subtle, rgba(127,127,127,0.28))",
								borderRadius: "5px",
								padding: "0 5px"
							},
							children: clue.id.replace(/^c/, "")
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("b", { children: [clue.title, clue.dealt ? "" : ` ${t("mid.clueSealed")}`] })]
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						style: {
							fontSize: "12px",
							opacity: clue.dealt ? .85 : .5
						},
						children: clue.text
					})] }, clue.id)) : null,
					phase === "final" || phase === "reveal" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Card, { children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						style: {
							fontSize: "12.5px",
							opacity: .75
						},
						children: t("right.pending")
					}) }) : null
				]
			});
		}
		/** 每个阶段那一句引导。 */
		function leadOf(phase, t) {
			switch (phase) {
				case "self-intro": return t("intro.lead");
				case "inquiry": return t("inquiry.lead");
				case "search": return t("search.lead");
				case "final": return t("final.lead");
				case "reveal": return t("reveal.lead");
			}
		}
		/**
		* 没开局时中栏显示的那一区：选本子、排座、拿指令。
		*
		* **排座只是组件状态**：排完就发出去，关掉就该忘——所以它不进 store、也不用端点。
		* 便签才要端点，因为那是要留下来的东西。
		* @param props - 能选的本子、演员池与本地化文案。
		* @returns 开一局那一区。
		*/
		function OpenGame({ snapshot, t }) {
			const [chosen, setChosen] = (0, react.useState)(null);
			const [cast, setCast] = (0, react.useState)({});
			const cases = snapshot.cases;
			const entry = cases.find((one) => one.id === chosen);
			const assignment = entry === void 0 ? [] : entry.roles.filter((role) => role.player === "ai").flatMap((role) => {
				const actor = snapshot.actors.find((one) => one.id === cast[`${entry.id}:${role.id}`]);
				return actor === void 0 ? [] : [{
					seat: role.id,
					roleName: role.name,
					actorId: actor.id,
					actorName: actor.name
				}];
			});
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				style: {
					maxWidth: "640px",
					width: "100%",
					margin: "0 auto",
					padding: "14px 20px 40px"
				},
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h2", {
						style: {
							fontSize: "14px",
							margin: "0 0 4px",
							fontWeight: 600
						},
						children: t("mid.noGame")
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Heading, { children: t("mid.cases") }),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						style: { marginTop: "14px" },
						children: cases.map((one) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							style: { marginBottom: "8px" },
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
										checked: chosen === one.id,
										onChange: () => setChosen(one.id)
									}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", { children: [
										one.title,
										"（case ",
										one.id,
										"｜",
										one.genre,
										"）"
									] })]
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
									style: {
										opacity: .65,
										fontSize: "12px",
										marginLeft: "20px"
									},
									children: one.roles.map((role) => `${role.id} ${role.name}`).join(" · ")
								}),
								chosen === one.id ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									style: {
										marginLeft: "20px",
										marginTop: "5px"
									},
									children: [one.roles.filter((role) => role.player === "ai").map((role) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
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
												value: cast[`${one.id}:${role.id}`] ?? "",
												onChange: (event) => setCast({
													...cast,
													[`${one.id}:${role.id}`]: event.target.value
												}),
												children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
													value: "",
													children: "—"
												}), snapshot.actors.map((actor) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
													value: actor.id,
													disabled: Object.entries(cast).some(([key, value]) => value === actor.id && key !== `${one.id}:${role.id}`),
													children: actor.name
												}, actor.id))]
											})
										]
									}, role.id)), assignment.length > 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("pre", {
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
										children: openingInstruction(one, assignment)
									}) : null]
								}) : null
							]
						}, one.id))
					})
				]
			});
		}
		/**
		* 右栏：桌上说了什么。
		* @param props - 本地化文案。
		* @returns 消息流那一栏。
		*/
		function RightColumn({ t }) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				style: { padding: "14px 16px" },
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Heading, { children: t("right.said") }),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						style: {
							fontSize: "12px",
							opacity: .7,
							marginBottom: "10px"
						},
						children: t("right.pending")
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						style: {
							borderTop: "1px solid var(--dsw-border-subtle, rgba(127,127,127,0.28))",
							paddingTop: "10px"
						},
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							style: {
								fontSize: "11.5px",
								opacity: .65
							},
							children: t("right.composer")
						})
					})
				]
			});
		}
		/**
		* 房间页：三栏。
		*
		* 容器是 `position: relative`——**便签层挂在这上面**（`position: absolute`，坐标相对容器）。
		* 这一条是「切走跟着走、切回来位置不变」的全部实现：不靠算坐标，靠挂载点。
		* @param props - 快照、本地化文案、会话 id 与便签层。
		* @returns 三栏。
		*/
		function RoomView({ snapshot, t, notes }) {
			const [phase, setPhase] = (0, react.useState)(PHASES.includes(snapshot.game?.phase) ? snapshot.game?.phase : "self-intro");
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				"data-jubensha-room": "",
				style: {
					position: "relative",
					minHeight: "100%"
				},
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						style: {
							display: "flex",
							gap: "4px",
							padding: "10px 20px 8px",
							flexWrap: "wrap"
						},
						children: PHASES.map((one) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							onClick: () => setPhase(one),
							style: {
								display: "flex",
								alignItems: "center",
								gap: "6px",
								font: "inherit",
								fontSize: "12px",
								padding: "3px 8px",
								borderRadius: "7px",
								cursor: "pointer",
								border: "none",
								background: phase === one ? "var(--dsw-surface-sunken, rgba(127,127,127,0.12))" : "transparent",
								color: "inherit",
								fontWeight: phase === one ? 600 : 400,
								opacity: phase === one ? 1 : .6
							},
							children: t(`phase.${one}`)
						}, one))
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						style: {
							display: "grid",
							gridTemplateColumns: "286px minmax(0,1fr) 366px",
							alignItems: "start"
						},
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								style: { borderRight: "1px solid var(--dsw-border-subtle, rgba(127,127,127,0.28))" },
								children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(LeftColumn, {
									snapshot,
									t
								})
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", { children: snapshot.game === null ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(OpenGame, {
								snapshot,
								t
							}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)(MidColumn, {
								snapshot,
								phase,
								t
							}) }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								style: { borderLeft: "1px solid var(--dsw-border-subtle, rgba(127,127,127,0.28))" },
								children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(RightColumn, { t })
							})
						]
					}),
					notes
				]
			});
		}
		//#endregion
		//#region src/client/notes.tsx
		/**
		* 便签层 —— 在房间页任意位置留的备忘。
		*
		* **它挂在标签页容器里**（`position: absolute`，坐标相对容器），所以切到别的标签时它跟着这一页
		* 一起消失，切回来位置不变。这条是靠**挂载点**守住的，不是靠算坐标——挂到 `body` 上再用
		* `fixed`，它的"位置"就成了屏幕上的位置，切走照样飘着。
		*
		* **状态在宿主侧**（按会话存，见 `../notes.ts`）：标签切走时组件会卸载，而便签要活下来。
		* 这也正是它需要端点、而不像排座那样只用组件状态的原因。
		*
		* 便签**不进对话、不进模型上下文**——它给自己看，不是发言。
		*
		* @module @max-null/dsh-jubensha/client/notes
		*/
		/** 房间页根节点上的标记——右键落在它里面才算「在房间里留便签」。 */
		const ROOM_ATTR = "data-jubensha-room";
		/** 九色。白底排第一格——它在这套界面里最隐蔽。 */
		const FILL = {
			white: "#fffefb",
			amber: "#ffe9a8",
			green: "#cdead0",
			blue: "#cfe4f7",
			pink: "#f9d5de",
			violet: "#ded2f5",
			orange: "#ffd9b8",
			teal: "#c3ecea",
			slate: "#dde1e6"
		};
		/** 拖动时最多到这个频率写一次盘——拖一下几十个 mousemove，一个都写一遍是白费。 */
		const DRAG_WRITE_MS = 300;
		/**
		* 往便签端点发一个动作。
		* @param action - `add` / `edit` / `remove`。
		* @param body - 请求体，会被并上 `session`。
		* @returns 端点回的那个值。
		*/
		async function post(action, body) {
			const response = await fetch(`/jubensha/note/${action}`, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify(body)
			});
			const parsed = await response.json();
			if (parsed.ok !== true) throw new Error(parsed.error ?? `HTTP ${response.status}`);
			return parsed.value;
		}
		/**
		* 便签层。
		* @param props - 本地化文案、会话 id、那板便签与两个回调。
		* @returns 便签层；右键弹出的色板也在这一层里。
		*/
		function NoteLayer({ t, sessionId, notes, onChanged, onProblem }) {
			const [menu, setMenu] = (0, react.useState)(null);
			const [dragging, setDragging] = (0, react.useState)(null);
			const guard = async (work) => {
				try {
					await work();
					onChanged();
				} catch (cause) {
					onProblem(cause instanceof Error ? cause.message : String(cause));
				}
			};
			/** 右键落在页面上（不是落在便签上）时弹色板。 */
			const openMenu = (event) => {
				const root = document.querySelector(`[${ROOM_ATTR}]`);
				if (root === null || !root.contains(event.target)) return;
				if (event.target.closest("[data-note]") !== null) return;
				event.preventDefault();
				const box = root.getBoundingClientRect();
				setMenu({
					x: event.clientX - box.left,
					y: event.clientY - box.top
				});
			};
			(0, react.useEffect)(() => {
				const closeMenu = () => setMenu(null);
				document.addEventListener("contextmenu", openMenu);
				document.addEventListener("click", closeMenu);
				return () => {
					document.removeEventListener("contextmenu", openMenu);
					document.removeEventListener("click", closeMenu);
				};
			});
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				style: {
					position: "absolute",
					inset: 0,
					pointerEvents: "none"
				},
				children: [notes.map((note) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					"data-note": note.id,
					onMouseDown: (event) => {
						if (event.target.dataset["kill"] !== void 0) return;
						if (event.currentTarget.parentElement?.getBoundingClientRect() === void 0) return;
						setDragging(note.id);
						const startX = event.clientX;
						const startY = event.clientY;
						let last = 0;
						const move = (moveEvent) => {
							const x = note.x + moveEvent.clientX - startX;
							const y = note.y + moveEvent.clientY - startY;
							const target = document.querySelector(`[data-note="${note.id}"]`);
							if (target !== null) {
								target.style.left = `${Math.max(0, x)}px`;
								target.style.top = `${Math.max(0, y)}px`;
							}
							const now = Date.now();
							if (now - last > DRAG_WRITE_MS) {
								last = now;
								post("edit", {
									session: sessionId,
									id: note.id,
									x: Math.max(0, x),
									y: Math.max(0, y)
								}).catch(() => {});
							}
						};
						const up = (upEvent) => {
							window.removeEventListener("mousemove", move);
							window.removeEventListener("mouseup", up);
							setDragging(null);
							guard(() => post("edit", {
								session: sessionId,
								id: note.id,
								x: Math.max(0, note.x + upEvent.clientX - startX),
								y: Math.max(0, note.y + upEvent.clientY - startY)
							}));
						};
						window.addEventListener("mousemove", move);
						window.addEventListener("mouseup", up);
					},
					style: {
						position: "absolute",
						left: `${note.x}px`,
						top: `${note.y}px`,
						width: "170px",
						minHeight: "54px",
						padding: "16px 10px 20px",
						borderRadius: "8px",
						background: FILL[note.color] ?? FILL["white"],
						border: note.color === "white" ? "1px solid rgba(0,0,0,.10)" : "1px solid transparent",
						boxShadow: "0 4px 14px rgba(0,0,0,.13)",
						color: "#23231f",
						fontSize: "12px",
						lineHeight: 1.55,
						pointerEvents: "auto",
						cursor: dragging === note.id ? "grabbing" : "grab",
						outline: "none",
						zIndex: 20
					},
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
							style: {
								position: "absolute",
								left: "7px",
								top: "3px",
								fontSize: "10px",
								opacity: .5,
								fontVariantNumeric: "tabular-nums"
							},
							children: ["#", note.seq]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							"data-kill": "1",
							title: t("note.remove"),
							onClick: () => void guard(() => post("remove", {
								session: sessionId,
								id: note.id
							})),
							style: {
								position: "absolute",
								right: "6px",
								bottom: "3px",
								cursor: "pointer",
								opacity: .45,
								fontSize: "11px"
							},
							children: "✕"
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							contentEditable: true,
							suppressContentEditableWarning: true,
							onBlur: (event) => {
								const text = event.currentTarget.textContent ?? "";
								if (text !== note.text) guard(() => post("edit", {
									session: sessionId,
									id: note.id,
									text
								}));
							},
							style: {
								outline: "none",
								minHeight: "18px",
								cursor: "inherit"
							},
							children: note.text
						})
					]
				}, note.id)), menu !== null ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					onClick: (event) => event.stopPropagation(),
					style: {
						position: "absolute",
						left: `${menu.x}px`,
						top: `${menu.y}px`,
						zIndex: 30,
						background: "var(--dsw-surface-raised, #fff)",
						border: "1px solid var(--dsw-border-subtle, rgba(0,0,0,.12))",
						borderRadius: "9px",
						padding: "6px",
						boxShadow: "0 8px 22px rgba(0,0,0,.18)",
						pointerEvents: "auto"
					},
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						style: {
							display: "grid",
							gridTemplateColumns: "repeat(3, 24px)",
							gap: "6px"
						},
						children: Object.entries(FILL).map(([color, fill]) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							"data-swatch": color,
							onClick: () => {
								const at = {
									x: menu.x,
									y: menu.y
								};
								setMenu(null);
								guard(() => post("add", {
									session: sessionId,
									color,
									text: t("note.placeholder"),
									x: at.x,
									y: at.y
								}));
							},
							style: {
								width: "24px",
								height: "24px",
								borderRadius: "6px",
								cursor: "pointer",
								background: fill,
								boxShadow: color === "white" ? "inset 0 0 0 1px rgba(0,0,0,.14)" : "none"
							}
						}, color))
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						style: {
							fontSize: "11px",
							opacity: .6,
							margin: "6px 2px 2px"
						},
						children: t("note.add")
					})]
				}) : null]
			});
		}
		//#endregion
		//#region src/client/locales.ts
		/**
		* 房间页的文案。
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
			"phase.self-intro": "自述",
			"phase.inquiry": "问话",
			"phase.search": "搜证",
			"phase.final": "发言投票",
			"phase.reveal": "复盘",
			"left.table": "这一桌",
			"left.relations": "人物关系",
			"left.timeline": "时间线 · 你们说过的",
			"left.you": "你",
			"left.notSeated": "还没上桌",
			"left.nothingSaid": "其余时段还没有人交代",
			"mid.script": "剧本正文",
			"mid.scriptHint": "（点这儿收起回看）",
			"mid.clues": "线索",
			"mid.cases": "可选的本子",
			"mid.clueSealed": "（还没发到桌上）",
			"mid.noGame": "还没开局。在对话里让主持人开一局，这里就会显示局面。",
			"right.said": "桌上说了什么",
			"right.composer": "说话在下面那个输入框里——它就是对话页那一个，两种形态共用同一局。",
			"right.pending": "这一栏的消息流还没接上：它要从会话里读，而那条路还在选（conversation node 还是 useSession）。",
			"intro.title": "逐个上桌",
			"intro.lead": "每个玩家从「我昨晚的经历」开始说。主持人一个个请他们上桌。",
			"inquiry.title": "问话",
			"inquiry.lead": "你可以问任何一个人任何问题，没有「不许问」的。",
			"search.title": "搜证",
			"search.lead": "主持人一次性把线索发到桌上。要指着哪条问，点「引用到对话」把它带进输入框。",
			"final.title": "发言与投票",
			"final.lead": "每人说一次「我怀疑谁、为什么」，然后投票。直接说就行。",
			"reveal.title": "复盘",
			"reveal.lead": "投票一结束就复盘：真相、时间线、以及三个「其实不是」。",
			"saidSoFar": "说过的",
			"notYet": "还没说",
			"note.add": "留一张便签",
			"note.placeholder": "写点什么……",
			"note.remove": "撕掉",
			"note.made": "便签加好了——点它就能改",
			"common.cancel": "算了",
			"common.loading": "载入中……"
		};
		/** English copy. */
		const en = {
			"view.team": "Team",
			"phase.self-intro": "Intros",
			"phase.inquiry": "Questions",
			"phase.search": "Search",
			"phase.final": "Vote",
			"phase.reveal": "Reveal",
			"left.table": "At the table",
			"left.relations": "Relations",
			"left.timeline": "Timeline · what they said",
			"left.you": "you",
			"left.notSeated": "not seated",
			"left.nothingSaid": "the rest of the night is still unaccounted for",
			"mid.script": "Your script",
			"mid.scriptHint": "(click to collapse)",
			"mid.clues": "Clues",
			"mid.cases": "Cases",
			"mid.clueSealed": "(not dealt yet)",
			"mid.noGame": "No game yet. Ask the host in the conversation to start one, and the table shows up here.",
			"right.said": "What was said",
			"right.composer": "You speak in the composer below — the same one the conversation page uses. Both share one game.",
			"right.pending": "The feed here is not wired up yet: it has to read from the session, and that route is still being chosen (conversation node vs useSession).",
			"intro.title": "Taking seats",
			"intro.lead": "Each player starts with what they did last night. The host brings them to the table one by one.",
			"inquiry.title": "Questions",
			"inquiry.lead": "You can ask anyone anything there is no off-limits question.",
			"search.title": "Search",
			"search.lead": "The host deals the clues all at once. To point at one, use \"quote to conversation\" to carry it into the composer.",
			"final.title": "Statements and vote",
			"final.lead": "Everyone says who they suspect and why, then votes. Just say it.",
			"reveal.title": "Reveal",
			"reveal.lead": "The reveal starts the moment the vote ends: the truth, the night, and the three \"it was not\".",
			"saidSoFar": "said",
			"notYet": "not yet",
			"note.add": "Leave a note",
			"note.placeholder": "Write something…",
			"note.remove": "Tear it off",
			"note.made": "Note added — click it to edit",
			"common.cancel": "Cancel",
			"common.loading": "Loading…"
		};
		//#endregion
		//#region src/client/index.tsx
		/**
		* 「团队」标签 —— 会话视图里的那个房间。
		*
		* **为什么叫「团队」**：它本来就在讲这件事——桌上坐着谁、谁演谁、这一局到哪一步了。
		* 一个叫「团队」的标签与「对话 / 轨迹 / 上下文」并列，看起来就是 Agent Teams 的名单。
		* 而**这个伪装性是有用的**：对话形态唯一的面板给不了的东西，就是「看起来在干别的」——
		* 那正是这个插件存在的第一个理由（用户原话「极其隐蔽，适合摸鱼」）。
		*
		* **它属于某个会话，不是属于这个进程。** `conversation.view` 的 inject 会告诉我们是谁在看我，
		* 而快照按那个 id 取——局面是每个会话各自一局（见 `../index.ts` 里 `games` 的注释）。
		*
		* **它是附加层，不是第二条数据通道。** 宿主半边不为它改结构：内容全部来自那个只读端点
		* `/jubensha/room`（见 `../room.ts`），而「排座」只生成一段文本交给主持人，不自己调工具。
		*
		* 三块东西各有各的文件：这一份只管接线，三栏在 `room.tsx`，便签层在 `notes.tsx`。
		*
		* @module @max-null/dsh-jubensha/client
		*/
		/** 需要的服务：`locale` 注册文案，`slots` 挂标签。 */
		const inject = ["locale", "slots"];
		/**
		* 多久拉一次快照。
		*
		* **一开始没做轮询**，理由是「用户看着它的时候正是他不太可能在推进阶段的时刻」——那个理由
		* 被推翻了：标签是**常驻**的，只在挂载时拉一次等于之后再不动，看着就像"房间和会话没有联动"。
		* 该问的不是"用户会看多久"，是"这个界面活多久"。
		*/
		const POLL_MS = 4e3;
		/**
		* 房间标签。
		* @param props - 本地化文案与注入面（谁在看我）。
		* @returns 三栏 + 便签层。
		*/
		function TeamView({ t, sessionId }) {
			const [snapshot, setSnapshot] = (0, react.useState)(null);
			const [problem, setProblem] = (0, react.useState)(null);
			/** 便签改过之后加一，让那个 effect 重跑一次——比手写一份本地便签副本少一处会不同步的状态。 */
			const [nonce, setNonce] = (0, react.useState)(0);
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
				}, POLL_MS);
				return () => {
					cancelled = true;
					window.clearInterval(timer);
				};
			}, [sessionId, nonce]);
			if (snapshot === null) return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				style: {
					padding: "18px 20px",
					fontSize: "12.5px",
					opacity: .7
				},
				children: problem ?? t("common.loading")
			});
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [problem !== null ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				style: {
					padding: "8px 20px",
					fontSize: "12px",
					color: "var(--dsw-danger, #e06c75)"
				},
				children: problem
			}) : null, /* @__PURE__ */ (0, react_jsx_runtime.jsx)(RoomView, {
				snapshot,
				t,
				notes: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(NoteLayer, {
					t,
					sessionId,
					notes: snapshot.notes,
					onChanged: () => setNonce((one) => one + 1),
					onProblem: setProblem
				})
			})] });
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
		exports.TeamView = TeamView;
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});

//# sourceMappingURL=client.js.map