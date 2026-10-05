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
				`开一局《${entry.title}》（case ${entry.id}）——**这一局要用团队模式**。`,
				"",
				"（第 ③ 步要让几位 AI 玩家上桌，而那是靠 team 的 spawn_teammate 创建的；DSH 默认不开团队，",
				"  所以要在这条消息里说清。少了这句，前两步会照常成功，第三步却报「这个部署里没有",
				"  agent-team 服务」——那看着像插件坏了，其实只差这一句。）",
				"",
				"① 取本子（先 load，它会顺带报出格式问题）：",
				`   jubensha_case —— action="load", dir="${entry.path}"`,
				"",
				"② 开局：",
				`   jubensha_state —— action="start", caseId="${entry.id}", title="${entry.title}", seats=${JSON.stringify(seats)}, humanSeat="${human[0] ?? ""}"`
			];
			if (assignment.length > 0) {
				lines.push("", "③ 让这几位上桌（这一步是唯一需要团队模式的）。**一座一份**：用 jubensha_case action=\"book\" 取到的是那个座位的引用，原样填进 roleBook，别转述、别换座位；actor 是他跨局的身份：");
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
		/**
		* 哪些来源**不是**「桌上说的话」。
		*
		* 右栏要的是人在桌上说的，而同一个通道里还流着上下文注入、技能目录、别的插件的通知、以及
		* 子 agent 的结算回执。这一串是**实测见到的非人话**——2026-10-06 从一次带两名玩家的真局里
		* 读出来的 `source.kind` 分布：真人是 `user`（21 条），玩家是 `agent-message`（11 条，直接在
		* 座）与 `team-message`（29 条，经 Team 的 send_message 发来），其余都不算。
		*
		* 用**排除法**而不是白名单：将来多出一种来源，多显示一句也比把玩家的话静默吃掉好。（这一条
		* 已经兑现过一次——`agent-message` 与 `team-message` 在实测之前是不知道的。）
		*/
		const NOT_SPOKEN = /* @__PURE__ */ new Set([
			"runtime-context",
			"agent-instructions",
			"skill-catalog",
			"time-context",
			"subagent-settled",
			"repeat-tool-reminder"
		]);
		/** 这条是不是「桌上说的话」。 */
		function isSaid(line) {
			return !NOT_SPOKEN.has(line.from) && !line.from.startsWith("plugin:");
		}
		/** 五个阶段，按顺序。 */
		const PHASES = [
			"self-intro",
			"inquiry",
			"search",
			"final",
			"reveal"
		];
		/** 一行小标题。 */
		function Heading$1({ children }) {
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
					marginBottom: "8px",
					boxSizing: "border-box"
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
		* 放大后的关系图：**连线图**。这一层才有画它的地方。
		*
		* 缩略（左栏那 258px）用列表，点开之后弹窗给足空间——连线图那套本来就需要宽度：节点摆在四角、
		* 标签写在线旁，而这两样都要地方。原型画的就是这个（`docs/设计/原型/房间-原型.html`），当时
		* 画得对是因为它假定标签只有两三个字；在弹窗里那个假定重新成立——四个标签各占一方，互不相干。
		*
		* @param props - 关系、中心那个人、以及关闭回调。
		* @returns 遮罩 + 弹窗。
		*/
		function RelationDialog({ relations, center, people, onClose, t }) {
			(0, react.useEffect)(() => {
				const onKey = (event) => {
					if (event.key === "Escape") onClose();
				};
				document.addEventListener("keydown", onKey);
				return () => document.removeEventListener("keydown", onKey);
			}, [onClose]);
			const width = 660;
			const height = 470;
			const midX = width / 2;
			const midY = height / 2;
			/** 四角。角上空间最大，而标签就写在从中心过去的路途中。 */
			const corners = [
				{
					x: 92,
					y: 78
				},
				{
					x: 568,
					y: 72
				},
				{
					x: 82,
					y: 396
				},
				{
					x: 578,
					y: 390
				}
			];
			const ends = [];
			for (const one of relations) if (one.from === center && !ends.includes(one.to)) ends.push(one.to);
			else if (one.to === center && !ends.includes(one.from)) ends.push(one.from);
			const at = (name) => {
				if (name === center) return {
					x: midX,
					y: midY
				};
				const index = ends.indexOf(name);
				return index < 0 ? {
					x: midX,
					y: midY
				} : corners[index % corners.length] ?? corners[0];
			};
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				role: "presentation",
				onClick: onClose,
				style: {
					position: "fixed",
					inset: 0,
					zIndex: 60,
					background: "rgba(0,0,0,0.42)",
					display: "flex",
					alignItems: "center",
					justifyContent: "center",
					animation: "jubensha-fade 140ms ease-out"
				},
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("style", { children: `
      @keyframes jubensha-fade { from { opacity: 0 } to { opacity: 1 } }
      @keyframes jubensha-grow { from { opacity: 0; transform: scale(0.88) } to { opacity: 1; transform: scale(1) } }
    ` }), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					role: "dialog",
					"aria-label": t("left.relations"),
					onClick: (event) => event.stopPropagation(),
					style: {
						width: `min(708px, 94vw)`,
						maxHeight: "88vh",
						overflow: "auto",
						background: "var(--dsw-surface, #fff)",
						borderRadius: "14px",
						boxShadow: "0 18px 60px rgba(0,0,0,0.32)",
						padding: "16px 24px 20px",
						boxSizing: "border-box",
						animation: "jubensha-grow 170ms cubic-bezier(0.2, 0.9, 0.3, 1)"
					},
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						style: {
							display: "flex",
							alignItems: "baseline",
							justifyContent: "space-between",
							marginBottom: "4px"
						},
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							style: {
								fontSize: "13px",
								fontWeight: 600
							},
							children: t("left.relations")
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							onClick: onClose,
							style: {
								font: "inherit",
								fontSize: "12px",
								padding: "3px 10px",
								borderRadius: "7px",
								cursor: "pointer",
								border: "1px solid var(--dsw-border-subtle, rgba(127,127,127,0.3))",
								background: "transparent",
								color: "inherit"
							},
							children: t("common.close")
						})]
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("svg", {
						viewBox: `0 0 ${width} ${height}`,
						style: {
							width: "100%",
							height: "auto",
							display: "block"
						},
						children: [
							relations.map((one, index) => {
								const from = at(one.from);
								const to = at(one.to);
								return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("line", {
									x1: from.x,
									y1: from.y,
									x2: to.x,
									y2: to.y,
									stroke: "var(--dsw-border-subtle, rgba(127,127,127,0.45))",
									strokeWidth: 1.3
								}, `e${index}`);
							}),
							relations.map((one, index) => {
								const from = at(one.from);
								const to = at(one.to);
								const px = from.x + (to.x - from.x) * .38;
								const py = from.y + (to.y - from.y) * .38;
								return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("text", {
									x: px,
									y: py,
									textAnchor: "middle",
									style: {
										fontSize: "10.5px",
										fill: "currentColor",
										opacity: .72,
										paintOrder: "stroke",
										stroke: "var(--dsw-surface, #fff)",
										strokeWidth: "4px",
										strokeLinejoin: "round"
									},
									children: one.label
								}, `l${index}`);
							}),
							[center, ...ends].map((name) => {
								const { x, y } = at(name);
								const isCenter = name === center;
								const person = people.find((one) => one.name === name);
								const boxW = isCenter ? 156 : 172;
								const boxH = isCenter ? 46 : 50;
								return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("foreignObject", {
									x: x - boxW / 2,
									y: y - boxH / 2,
									width: boxW,
									height: boxH,
									children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
										style: {
											width: "100%",
											height: "100%",
											boxSizing: "border-box",
											display: "flex",
											flexDirection: "column",
											justifyContent: "center",
											padding: "5px 10px",
											borderRadius: "10px",
											background: "var(--dsw-surface, #fff)",
											border: isCenter ? "1px solid var(--dsw-border-strong, rgba(127,127,127,0.5))" : "1px solid var(--dsw-border-subtle, rgba(127,127,127,0.3))",
											boxShadow: isCenter ? "0 2px 8px rgba(0,0,0,0.13)" : "0 1px 3px rgba(0,0,0,0.08)",
											textAlign: "center",
											overflow: "hidden"
										},
										children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
											style: {
												fontSize: isCenter ? "12.5px" : "12px",
												fontWeight: 600,
												lineHeight: 1.3
											},
											children: [
												name,
												person?.mine === true ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
													style: {
														marginLeft: "5px",
														fontSize: "10px",
														fontWeight: 400,
														color: "var(--dsw-accent, #4a7fd4)"
													},
													children: t("left.you")
												}) : null,
												person?.dead === true ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
													style: {
														marginLeft: "5px",
														fontSize: "10px",
														fontWeight: 400,
														opacity: .55
													},
													children: t("left.dead")
												}) : null
											]
										}), person === void 0 || person.blurb === "" ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
											style: {
												fontSize: "9.5px",
												opacity: .62,
												lineHeight: 1.28,
												marginTop: "2px",
												overflow: "hidden",
												display: "-webkit-box",
												WebkitLineClamp: 2,
												WebkitBoxOrient: "vertical"
											},
											children: person.blurb
										})]
									})
								}, name);
							})
						]
					})]
				})]
			});
		}
		/**
		* 人物关系：**缩略一行一个，点开是连线图**。
		*
		* 试过三版图形布局都撞（正圆星形、错开的树形、以及把标签挪来挪去）——根因是**地方不够**：
		* 这块只有 258px 宽，「一个中心 + 四个节点 + 四条带字的连线」在这个宽度里无论怎么排都会打架。
		*
		* 用户给的解法比我的三版都好：**缩略用列表、点开弹窗画连线图**——「就像缩略图和原图的关系」。
		* 于是两件事各自成立：列表在窄栏里好读、而连线图拿到足够宽度之后才能画（原型那套本来就需要
		* 宽度，它的标签假定是两三个字）。
		*
		* @param props - 关系列表、中心那个人、以及本子里所有角色名。
		* @returns 关系表（可点开）。
		*/
		function RelationGraph({ relations, center, names, people, t }) {
			const [expanded, setExpanded] = (0, react.useState)(false);
			const arms = [];
			const between = [];
			for (const one of relations) if (one.from === center) arms.push({
				who: one.to,
				label: one.label
			});
			else if (one.to === center) arms.push({
				who: one.from,
				label: one.label
			});
			else between.push(one);
			const listed = new Set(arms.map((one) => one.who));
			const missing = names.filter((one) => one !== center && !listed.has(one));
			const canExpand = relations.length > 0;
			const row = (who, label, key) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				style: {
					display: "flex",
					gap: "8px",
					alignItems: "baseline",
					minHeight: "22px"
				},
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						"aria-hidden": true,
						style: {
							width: "12px",
							flexShrink: 0,
							alignSelf: "stretch",
							position: "relative",
							borderLeft: "1px solid var(--dsw-border-subtle, rgba(127,127,127,0.38))"
						},
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { style: {
							position: "absolute",
							left: 0,
							top: "11px",
							width: "9px",
							height: "1px",
							background: "var(--dsw-border-subtle, rgba(127,127,127,0.38))"
						} })
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						style: {
							fontSize: "11.5px",
							fontWeight: 500,
							flexShrink: 0,
							minWidth: "44px"
						},
						children: who
					}),
					label === "" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						style: {
							fontSize: "10.5px",
							opacity: .45,
							fontStyle: "italic"
						},
						children: t("left.relationMissing")
					}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						style: {
							fontSize: "10.5px",
							opacity: .68,
							lineHeight: 1.35
						},
						children: label
					})
				]
			}, key);
			const body = /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
				/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					style: {
						display: "inline-flex",
						alignItems: "center",
						padding: "3px 10px",
						borderRadius: "8px",
						marginBottom: "2px",
						background: "var(--dsw-surface-sunken, rgba(127,127,127,0.14))",
						fontSize: "11.5px",
						fontWeight: 600
					},
					children: center
				}),
				relations.length === 0 && names.length <= 1 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					style: {
						fontSize: "11px",
						opacity: .6,
						marginTop: "4px"
					},
					children: t("left.noRelations")
				}) : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					style: { marginTop: "1px" },
					children: [arms.map((one, index) => row(one.who, one.label, `a${index}`)), missing.map((one, index) => row(one, "", `m${index}`))]
				}),
				between.length > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					style: { marginTop: "6px" },
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						style: {
							fontSize: "10px",
							opacity: .5,
							marginBottom: "2px"
						},
						children: t("left.between")
					}), between.map((one, index) => row(`${one.from} · ${one.to}`, one.label, `b${index}`))]
				})
			] });
			if (!canExpand) return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", { children: body });
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [
				/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
					type: "button",
					onClick: () => setExpanded(true),
					title: t("left.expandHint"),
					style: {
						display: "block",
						width: "100%",
						textAlign: "left",
						font: "inherit",
						color: "inherit",
						cursor: "zoom-in",
						padding: "4px 6px 6px",
						margin: "-4px -6px -6px",
						borderRadius: "9px",
						border: "none",
						background: "transparent"
					},
					onMouseEnter: (event) => {
						event.currentTarget.style.background = "var(--dsw-surface-sunken, rgba(127,127,127,0.08))";
					},
					onMouseLeave: (event) => {
						event.currentTarget.style.background = "transparent";
					},
					children: body
				}),
				/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					style: {
						fontSize: "10px",
						opacity: .45,
						marginTop: "4px"
					},
					children: t("left.expandHint")
				}),
				expanded && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(RelationDialog, {
					relations,
					center,
					people,
					t,
					onClose: () => setExpanded(false)
				})
			] });
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
				style: {
					padding: "14px 16px",
					boxSizing: "border-box"
				},
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
						style: { marginBottom: "18px" },
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Heading$1, { children: t("left.table") }), seats.length === 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
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
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Heading$1, { children: t("left.relations") }), (() => {
							const relations = caseEntry?.relations ?? [];
							const victimName = game?.victim?.name ?? "";
							if (relations.length === 0) return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								style: { fontSize: "12px" },
								children: [(caseEntry?.roles ?? []).map((role) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									style: { padding: "2px 0" },
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("b", { children: role.name }), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
										style: { opacity: .65 },
										children: ["　", role.public]
									})]
								}, role.id)), caseEntry === void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
									style: { opacity: .6 },
									children: "—"
								}) : null]
							});
							const names = [.../* @__PURE__ */ new Set([
								...victimName === "" ? [] : [victimName],
								...(caseEntry?.roles ?? []).map((role) => role.name),
								...relations.flatMap((one) => [one.from, one.to])
							])];
							const people = [...seats.map((seat) => {
								const role = roleOf(seat);
								return {
									name: role?.name ?? seat,
									blurb: role?.public ?? "",
									mine: seat === game?.humanSeat,
									dead: false
								};
							}), ...victimName === "" ? [] : [{
								name: victimName,
								blurb: "",
								mine: false,
								dead: true
							}]];
							return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(RelationGraph, {
								relations,
								center: victimName,
								names,
								people,
								t
							});
						})()]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Heading$1, { children: t("left.timeline") }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
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
					padding: "14px 20px 40px",
					boxSizing: "border-box"
				},
				children: [
					game?.script !== void 0 && game.script !== "" ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("details", {
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
						children: t("mid.pending")
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
						children: t("mid.pending")
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
			/**
			* 把池子里的人随机分给这一桌的 AI 位子。
			*
			* **整桌重排，不是只补空位**——点「随机」就是要把挑好的换掉；只补空位会让人以为按钮坏了。
			* 用 Fisher-Yates 而不是 `sort(() => Math.random() - 0.5)`：后者不是洗牌，多数引擎下分布偏。
			* @param one - 要给哪个本子排座。
			*/
			const shuffle = (one) => {
				const pool = snapshot.actors.map((actor) => actor.id);
				for (let i = pool.length - 1; i > 0; i -= 1) {
					const j = Math.floor(Math.random() * (i + 1));
					const held = pool[i];
					pool[i] = pool[j];
					pool[j] = held;
				}
				const next = {};
				one.roles.filter((role) => role.player === "ai").forEach((role, index) => {
					const pick = pool.length === 0 ? void 0 : pool[index % pool.length];
					if (pick !== void 0) next[`${one.id}:${role.id}`] = pick;
				});
				setCast(next);
			};
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				style: {
					maxWidth: "640px",
					width: "100%",
					margin: "0 auto",
					padding: "14px 20px 40px",
					boxSizing: "border-box"
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
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Heading$1, { children: t("mid.cases") }),
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
									children: [
										/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
											style: {
												display: "flex",
												alignItems: "baseline",
												gap: "9px",
												marginBottom: "7px"
											},
											children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
												type: "button",
												onClick: () => shuffle(one),
												style: {
													font: "inherit",
													fontSize: "12px",
													padding: "3px 11px",
													borderRadius: "7px",
													cursor: "pointer",
													border: "1px solid var(--dsw-accent, #4a7fd4)",
													background: "transparent",
													color: "var(--dsw-accent, #4a7fd4)"
												},
												children: t("mid.shuffle")
											}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
												style: {
													fontSize: "11.5px",
													opacity: .6
												},
												children: t("mid.shuffleHint")
											})]
										}),
										one.roles.filter((role) => role.player === "ai").map((role) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
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
										}, role.id)),
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
												whiteSpace: "pre-wrap",
												wordBreak: "break-all",
												maxWidth: "100%",
												boxSizing: "border-box"
											},
											children: openingInstruction(one, assignment)
										}) : null
									]
								}) : null
							]
						}, one.id))
					})
				]
			});
		}
		/**
		* 右栏：桌上说了什么。
		* @param props - 本地化文案与已经读到的那些话。
		* @returns 消息流那一栏。
		*/
		/**
		* 从 Team 的成员名（`p1-m3k8f2a`）里找出这个人演的角色叫什么。
		*
		* 成员名的前缀是座位 id（宿主的 `teammateName` 就是 `${seat}-<时间戳><随机>` 拼的），而那是分辨
		* 「这一句是谁说的」唯一的线索——信封里只有这个内部名。查不到就给 `undefined`，由调用方决定
		* 退回什么。
		*
		* @param who - `SaidLine.who`。
		* @param seatNames - 座位 id → 角色名。
		* @returns 角色名；这个座位不在桌上（或者名字不是那个形状）时给 `undefined`。
		*/
		function seatName(who, seatNames) {
			const seat = who.split("-")[0];
			return seat === void 0 ? void 0 : seatNames.get(seat);
		}
		/**
		* 右栏：桌上说了什么。
		* @param props - 本地化文案、句子、开局了没有、以及座位到角色名的对照。
		* @returns 一栏发言。
		*/
		function RightColumn({ t, said, started, seatNames }) {
			const lines = said.filter(isSaid);
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				style: {
					padding: "14px 16px",
					boxSizing: "border-box"
				},
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Heading$1, { children: t("right.said") }),
					!started && lines.length > 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						style: {
							fontSize: "11.5px",
							opacity: .6,
							marginBottom: "8px",
							lineHeight: 1.5
						},
						children: t("right.notStarted")
					}) : null,
					lines.length === 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						style: {
							fontSize: "12px",
							opacity: .7,
							marginBottom: "10px"
						},
						children: t("right.empty")
					}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						style: { marginBottom: "10px" },
						children: lines.map((line, index) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							style: {
								padding: "5px 0",
								borderBottom: "1px solid var(--dsw-border-subtle, rgba(127,127,127,0.16))"
							},
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								style: {
									fontSize: "11px",
									opacity: .6,
									marginBottom: "2px"
								},
								children: line.from === "user" ? t("right.you") : line.who !== void 0 ? seatName(line.who, seatNames) ?? line.who.split("-")[0] ?? t("right.player") : line.from === "agent-message" || line.from === "team-message" ? t("right.player") : line.from
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								style: {
									fontSize: "12.5px",
									lineHeight: 1.7,
									whiteSpace: "pre-wrap",
									wordBreak: "break-word"
								},
								children: line.text
							})]
						}, `${line.seq}-${index}`))
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
		function RoomView({ snapshot, t, said, notes }) {
			const live = PHASES.includes(snapshot.game?.phase) ? snapshot.game?.phase : PHASES[0];
			const reached = snapshot.game === null ? -1 : PHASES.indexOf(live);
			const seatNames = new Map((snapshot.cases.find((one) => one.id === snapshot.game?.caseId)?.roles ?? []).map((role) => [role.id, role.name]));
			const [peek, setPeek] = (0, react.useState)(null);
			const shown = peek ?? live;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				"data-jubensha-room": "",
				style: {
					position: "relative",
					height: "calc(100vh - 246px)",
					display: "flex",
					flexDirection: "column"
				},
				children: [
					reached >= 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						style: {
							display: "flex",
							alignItems: "center",
							gap: "0",
							padding: "10px 20px 8px"
						},
						children: [PHASES.map((one, index) => {
							const done = index < reached;
							const now = index === reached;
							const canPeek = index <= reached;
							return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react.Fragment, { children: [index > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", { style: {
								width: "18px",
								height: "1px",
								flexShrink: 0,
								background: index <= reached ? "var(--dsw-text-secondary, rgba(127,127,127,0.85))" : "var(--dsw-border-subtle, rgba(127,127,127,0.28))"
							} }), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
								type: "button",
								disabled: !canPeek,
								onClick: () => setPeek(one === live ? null : one),
								title: canPeek ? void 0 : t("step.notYet"),
								style: {
									display: "flex",
									alignItems: "center",
									gap: "6px",
									font: "inherit",
									fontSize: "12px",
									padding: "3px 8px",
									borderRadius: "7px",
									border: "none",
									background: shown === one && canPeek ? "var(--dsw-surface-sunken, rgba(127,127,127,0.12))" : "transparent",
									color: "inherit",
									fontWeight: now ? 600 : 400,
									opacity: canPeek ? 1 : .35,
									cursor: canPeek ? "pointer" : "default"
								},
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									"aria-hidden": true,
									style: {
										width: "7px",
										height: "7px",
										borderRadius: "50%",
										flexShrink: 0,
										boxSizing: "border-box",
										background: index <= reached ? "currentColor" : "transparent",
										border: index <= reached ? "none" : "1px solid currentColor",
										boxShadow: now ? "0 0 0 3px var(--dsw-surface-sunken, rgba(127,127,127,0.22))" : "none",
										opacity: done ? .55 : 1
									}
								}), t(`phase.${one}`)]
							})] }, one);
						}), peek !== null && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							onClick: () => setPeek(null),
							style: {
								font: "inherit",
								fontSize: "11.5px",
								marginLeft: "10px",
								padding: "3px 8px",
								borderRadius: "7px",
								cursor: "pointer",
								border: "none",
								background: "transparent",
								color: "inherit",
								opacity: .6,
								textDecoration: "underline"
							},
							children: t("step.backToNow")
						})]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						style: {
							display: "grid",
							gridTemplateColumns: "minmax(150px, 286px) minmax(300px, 1fr) minmax(190px, 366px)",
							flex: 1,
							minHeight: 0
						},
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								style: {
									minWidth: 0,
									minHeight: 0,
									overflowY: "auto",
									borderRight: "1px solid var(--dsw-border-subtle, rgba(127,127,127,0.28))"
								},
								children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(LeftColumn, {
									snapshot,
									t
								})
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								style: {
									minWidth: 0,
									minHeight: 0,
									overflowY: "auto"
								},
								children: snapshot.game === null ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(OpenGame, {
									snapshot,
									t
								}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)(MidColumn, {
									snapshot,
									phase: shown,
									t
								})
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								style: {
									minWidth: 0,
									minHeight: 0,
									overflowY: "auto",
									borderLeft: "1px solid var(--dsw-border-subtle, rgba(127,127,127,0.28))"
								},
								children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(RightColumn, {
									t,
									said,
									started: snapshot.game !== null,
									seatNames
								})
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
		//#region src/client/hidden-entry.ts
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
		function installHiddenEntry(onTrigger) {
			/** 三下之间的间隔上限。超过就当是新的一轮，免得白天随手点的三下攒到晚上一起算。 */
			const WINDOW_MS = 900;
			let hits = 0;
			let last = 0;
			const onClick = (event) => {
				const target = event.target;
				if (!(target instanceof Element)) return;
				if (target.closest("[class*=\"_headline\"]") === null) {
					hits = 0;
					return;
				}
				const now = Date.now();
				hits = now - last <= WINDOW_MS ? hits + 1 : 1;
				last = now;
				if (hits < 3) return;
				hits = 0;
				onTrigger();
			};
			document.addEventListener("click", onClick, true);
			return () => document.removeEventListener("click", onClick, true);
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
		function fillComposer(text) {
			const composer = document.querySelector("textarea, [contenteditable=\"true\"]");
			if (composer === null) return false;
			if (composer instanceof HTMLTextAreaElement) {
				composer.focus();
				composer.setSelectionRange(0, composer.value.length);
			} else {
				const range = document.createRange();
				range.selectNodeContents(composer);
				const selection = window.getSelection();
				selection?.removeAllRanges();
				selection?.addRange(range);
				if (composer instanceof HTMLElement) composer.focus();
			}
			document.execCommand("insertText", false, text);
			return true;
		}
		//#endregion
		//#region src/client/said.ts
		/** 投影的名字。读它时用同一个字符串。 */
		const SAID_KIND = "jubensha-said";
		/**
		* 剥掉 Team 消息自带的信封，**但把发信人留下来**。
		*
		* 玩家经 Team 的 `send_message` 发来的话，正文前面带着一段
		* `Team message <消息 id> from <成员名>: `——那是信道的记账，不是他说的话，所以正文要剥掉它。
		* 而**那个成员名是这一段里唯一能分辨"谁说的"的东西**：原先连它一起剥了，于是右栏只能笼统说
		* 「玩家」，四个座位分不出是哪一个（用户 2026-10-06 报的）。成员名的前缀就是座位 id。
		*
		* @param text - 原始正文。
		* @returns 剥掉信封的正文与发信人；没有信封时 `who` 为空。
		*/
		function unwrapTeamMessage(text) {
			const match = /^Team message \S+ from (\S+):\s*/u.exec(text);
			if (match === null) return { text };
			return {
				text: text.slice(match[0].length).trim(),
				who: match[1]
			};
		}
		/**
		* 把一条消息的 `content` 拍成一段文字。
		*
		* 它是富结构（`[{ type: 'text', text }]` 起头，还可能有别的东西），而房间页只要一句话。
		* 非文字的部分**不猜**——拍不出来就给空串，让调用方把这条丢掉。
		* @param content - 事件里的 `content` 字段。
		* @returns 拼起来的文字；没有文字内容时给空串。
		*/
		function textOf(content) {
			if (typeof content === "string") return unwrapTeamMessage(content.trim());
			if (!Array.isArray(content)) return { text: "" };
			const parts = [];
			for (const item of content) {
				if (typeof item === "string") {
					parts.push(item);
					continue;
				}
				if (typeof item !== "object" || item === null) continue;
				const one = item;
				if (one.type === "text" && typeof one.text === "string") parts.push(one.text);
			}
			return unwrapTeamMessage(parts.join("\n").trim());
		}
		/**
		* 「谁说了什么」的投影定义。
		*
		* 每个 splice 一条 node（id 用事件序号），所以 `update` 直接回 `context.state` 就够——同一个
		* splice 不会被折叠第二次。
		*/
		const saidDefinition = {
			kind: SAID_KIND,
			target: "chat",
			match: (event) => event.type === "agent/inbox/spliced" ? {
				id: String(event.seq),
				role: "start"
			} : null,
			start: (_context, match) => {
				const event = match.event;
				if (event.type !== "agent/inbox/spliced") throw new Error("jubensha-said: start requires agent/inbox/spliced");
				const data = event.data;
				const inserted = Array.isArray(data.inserted) ? data.inserted : [];
				const lines = [];
				for (const item of inserted) {
					if (typeof item !== "object" || item === null) continue;
					const one = item;
					const { text, who } = textOf(one.content);
					if (text === "") continue;
					lines.push({
						seq: event.seq,
						from: typeof one.source?.kind === "string" ? one.source.kind : "(没有来源)",
						...who === void 0 ? {} : { who },
						text
					});
				}
				return {
					seq: event.seq,
					lines
				};
			},
			update: (context) => context.state,
			buildViewNode: (context) => {
				const start = context.start ?? context.matches[0];
				if (start === void 0 || context.state === void 0) return null;
				return {
					key: context.key,
					kind: SAID_KIND,
					id: context.id,
					target: "chat",
					anchorSeq: start.event.seq,
					location: start.location,
					visibility: "hidden",
					data: context.state
				};
			}
		};
		/**
		* 一个 node 的 `data` 是不是我要的那一批。
		*
		* `ConversationViewNode.data` 的类型是 `unknown`——那是定义方与渲染方之间的边界，所以这里
		* 窄化一次，形状不对就当没看见（别让一个别的东西把右栏炸掉）。
		* @param data - node 上的 `data`。
		* @returns 认得出来就给那一批，否则给 `undefined`。
		*/
		function asBatch(data) {
			if (typeof data !== "object" || data === null) return void 0;
			const one = data;
			if (typeof one.seq !== "number" || !Array.isArray(one.lines)) return void 0;
			return {
				seq: one.seq,
				lines: one.lines
			};
		}
		/**
		* 从会话快照里读「谁说了什么」。
		*
		* 走 `nodes.values()`——**全部已投影的 node**，一步到位：它不要求「哪几轮加载了」，也不要求
		* node 是可见的。这一点很关键：「团队」标签显示的时候对话页并没有在显示，那些轮可能根本不在
		* 导航索引里，而 `turnDataSource(turn, kind)` 是从导航索引拿 turn 的。
		*
		* 拿不到快照时给空数组——房间页那侧已经在轮询，这一格空着比整页报错好。
		* @param snapshot - Chat 目标的快照；目标还没就绪时给 `undefined`。
		* @returns 按时间序的句子，最多 `SAID_LIMIT` 条。
		*/
		function readSaid(snapshot) {
			if (snapshot === void 0) return [];
			const lines = [];
			for (const node of snapshot.nodes.values()) {
				if (node.kind !== "jubensha-said") continue;
				const batch = asBatch(node.data);
				if (batch === void 0) continue;
				lines.push(...batch.lines);
			}
			lines.sort((left, right) => left.seq - right.seq);
			return lines.length > 40 ? lines.slice(lines.length - 40) : lines;
		}
		//#endregion
		//#region src/client/settings.tsx
		/**
		* 设置页 —— 出现在「设置 → 插件 → 剧本杀」。
		*
		* **只放跨局的东西**：演员（谁在玩）与本子来源（去哪儿找本子）。判断是一句话——**换一局它
		* 还成立吗**：演员是，座位不是。所以一局里的东西（谁坐哪、线索发了几条、便签）都在「团队」
		* 标签里，不进这里。
		*
		* 挂 `settings.plugins.tab` 而**不是** `settings.section`：功能插件不占左边那列导航，只往
		* 「插件」那一栏贡献一个页面（`ui-settings-plugins` 的注释就是这么定的）。
		*
		* 性格在这里**手写**，LLM 起草仍留在对话里（`jubensha_actor action="draft"`）——设置页是
		* 浏览器半边，它调不了模型。
		*
		* @module @max-null/dsh-jubensha/client/settings
		*/
		/** 往演员端点发一个动作。 */
		async function act(action, body) {
			const response = await fetch(`/jubensha/actor/${action}`, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify(body)
			});
			const parsed = await response.json();
			if (parsed.ok !== true) throw new Error(parsed.error ?? `HTTP ${response.status}`);
			return parsed.value;
		}
		/** 读整个演员池。**不需要会话**——演员是跨会话的。 */
		async function listActors() {
			const response = await fetch("/jubensha/actor");
			const parsed = await response.json();
			if (parsed.ok !== true || parsed.value === void 0) throw new Error(parsed.error ?? `HTTP ${response.status}`);
			return parsed.value;
		}
		/** 读本子目录这份配置。也不需要会话——它跟着这台机器上的人走。 */
		async function listCaseDirs() {
			const response = await fetch("/jubensha/case-dirs");
			const parsed = await response.json();
			if (parsed.ok !== true || parsed.value === void 0) throw new Error(parsed.error ?? `HTTP ${response.status}`);
			return parsed.value;
		}
		/** 加一个本子目录，或者去掉一个。 */
		async function writeCaseDir(action, dir) {
			const response = await fetch(`/jubensha/case-dirs/${action}`, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ dir })
			});
			const parsed = await response.json();
			if (parsed.ok !== true || parsed.value === void 0) throw new Error(parsed.error ?? `HTTP ${response.status}`);
			return parsed.value;
		}
		/** 一行小标题。 */
		function Heading({ children }) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", {
				style: {
					fontSize: "13px",
					margin: "0 0 4px",
					fontWeight: 600
				},
				children
			});
		}
		/** 一张输入。 */
		const inputStyle = {
			width: "100%",
			font: "inherit",
			fontSize: "12.5px",
			padding: "6px 9px",
			borderRadius: "8px",
			border: "1px solid var(--dsw-border-subtle, rgba(127,127,127,0.28))",
			background: "var(--dsw-surface, transparent)",
			color: "inherit",
			boxSizing: "border-box"
		};
		/**
		* 演员那一区。
		* @param props - 演员、重读与本地化文案。
		* @returns 每张卡可改名字、性格、头像，可删；底下是招人。
		*/
		function Actors({ actors, reload, onProblem, t }) {
			const [draft, setDraft] = (0, react.useState)(null);
			const guard = async (work) => {
				try {
					await work();
					reload();
				} catch (cause) {
					onProblem(cause instanceof Error ? cause.message : String(cause));
				}
			};
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
				/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Heading, { children: t("set.actors") }),
				/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
					style: {
						opacity: .7,
						fontSize: "12px",
						margin: "0 0 10px"
					},
					children: t("set.actorsLead")
				}),
				actors.map((actor) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					style: {
						display: "flex",
						gap: "12px",
						alignItems: "flex-start",
						border: "1px solid var(--dsw-border-subtle, rgba(127,127,127,0.28))",
						borderRadius: "10px",
						background: "var(--dsw-surface-sunken, rgba(127,127,127,0.06))",
						padding: "12px",
						marginBottom: "10px"
					},
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Face, {
							id: actor.id,
							...actor.avatar === void 0 ? {} : { avatar: actor.avatar },
							size: 44
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							style: {
								flex: 1,
								minWidth: 0,
								display: "grid",
								gap: "7px"
							},
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
									style: { display: "block" },
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										style: {
											fontSize: "11px",
											opacity: .7,
											display: "block",
											marginBottom: "2px"
										},
										children: t("set.name")
									}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
										style: inputStyle,
										defaultValue: actor.name,
										onBlur: (event) => {
											const name = event.currentTarget.value.trim();
											if (name !== "" && name !== actor.name) guard(() => act("rename", {
												id: actor.id,
												name
											}));
										}
									})]
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
									style: { display: "block" },
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										style: {
											fontSize: "11px",
											opacity: .7,
											display: "block",
											marginBottom: "2px"
										},
										children: t("set.style")
									}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("textarea", {
										style: {
											...inputStyle,
											minHeight: "54px",
											lineHeight: 1.65,
											resize: "vertical"
										},
										defaultValue: actor.style,
										onBlur: (event) => {
											const style = event.currentTarget.value;
											if (style !== actor.style) guard(() => act("style", {
												id: actor.id,
												style
											}));
										}
									})]
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									style: {
										fontSize: "12px",
										opacity: .7
									},
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										style: {
											display: "block",
											fontSize: "11px",
											opacity: .8,
											marginBottom: "2px"
										},
										children: t("set.notes")
									}), actor.notes.length === 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: ["· ", t("set.noNotes")] }) : actor.notes.map((one, index) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: ["· ", one] }, index))]
								})
							]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							style: {
								display: "flex",
								flexDirection: "column",
								gap: "6px"
							},
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								onClick: () => void guard(() => act("avatar", {
									id: actor.id,
									image: ""
								})),
								style: {
									font: "inherit",
									fontSize: "12px",
									padding: "4px 10px",
									borderRadius: "7px",
									border: "1px solid var(--dsw-border-subtle, rgba(127,127,127,0.28))",
									background: "transparent",
									color: "inherit",
									cursor: "pointer"
								},
								children: t("set.resetFace")
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								onClick: () => {
									if (window.confirm(t("set.removeAsk").replace("{name}", actor.name))) guard(() => act("remove", { id: actor.id }));
								},
								style: {
									font: "inherit",
									fontSize: "12px",
									padding: "4px 10px",
									borderRadius: "7px",
									border: "1px solid var(--dsw-border-subtle, rgba(127,127,127,0.28))",
									background: "transparent",
									color: "var(--dsw-danger, #e06c75)",
									cursor: "pointer"
								},
								children: t("set.remove")
							})]
						})
					]
				}, actor.id)),
				draft === null ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
					type: "button",
					onClick: () => setDraft({
						id: "",
						name: ""
					}),
					style: {
						width: "100%",
						padding: "9px",
						borderRadius: "9px",
						border: "1px dashed var(--dsw-border-subtle, rgba(127,127,127,0.4))",
						background: "transparent",
						color: "inherit",
						font: "inherit",
						fontSize: "12.5px",
						cursor: "pointer"
					},
					children: t("set.add")
				}) : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					style: {
						border: "1px dashed var(--dsw-border-subtle, rgba(127,127,127,0.4))",
						borderRadius: "10px",
						padding: "12px",
						display: "grid",
						gap: "7px"
					},
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
							style: inputStyle,
							placeholder: t("set.newId"),
							value: draft.id,
							onChange: (event) => setDraft({
								...draft,
								id: event.target.value
							})
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
							style: inputStyle,
							placeholder: t("set.newName"),
							value: draft.name,
							onChange: (event) => setDraft({
								...draft,
								name: event.target.value
							})
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							style: {
								display: "flex",
								gap: "8px"
							},
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								onClick: () => {
									const id = draft.id.trim();
									const name = draft.name.trim();
									if (id === "" || name === "") {
										onProblem(t("set.needBoth"));
										return;
									}
									guard(() => act("add", {
										id,
										name,
										style: ""
									})).then(() => setDraft(null));
								},
								style: {
									font: "inherit",
									fontSize: "12px",
									padding: "4px 12px",
									borderRadius: "7px",
									border: "1px solid var(--dsw-accent, #4a7fd4)",
									background: "transparent",
									color: "var(--dsw-accent, #4a7fd4)",
									cursor: "pointer"
								},
								children: t("set.confirm")
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								onClick: () => setDraft(null),
								style: {
									font: "inherit",
									fontSize: "12px",
									padding: "4px 12px",
									borderRadius: "7px",
									border: "1px solid var(--dsw-border-subtle, rgba(127,127,127,0.28))",
									background: "transparent",
									color: "inherit",
									cursor: "pointer"
								},
								children: t("common.cancel")
							})]
						})
					]
				})
			] });
		}
		/**
		* 设置页。
		* @param props - 本地化文案。
		* @returns 演员与本子来源两区。
		*/
		function SettingsTab({ t }) {
			const [actors, setActors] = (0, react.useState)(null);
			const [dirs, setDirs] = (0, react.useState)(null);
			const [draft, setDraft] = (0, react.useState)("");
			const [problem, setProblem] = (0, react.useState)(null);
			const [nonce, setNonce] = (0, react.useState)(0);
			(0, react.useEffect)(() => {
				let cancelled = false;
				Promise.all([listActors(), listCaseDirs()]).then(([list, extra]) => {
					if (!cancelled) {
						setActors(list);
						setDirs(extra);
						setProblem(null);
					}
				}).catch((cause) => {
					if (!cancelled) setProblem(cause instanceof Error ? cause.message : String(cause));
				});
				return () => {
					cancelled = true;
				};
			}, [nonce]);
			const reload = () => setNonce((one) => one + 1);
			const touchDir = async (action, dir) => {
				try {
					setDirs(await writeCaseDir(action, dir));
					setDraft("");
					reload();
				} catch (cause) {
					setProblem(cause instanceof Error ? cause.message : String(cause));
				}
			};
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				style: {
					padding: "20px 24px 40px",
					fontSize: "13px",
					lineHeight: 1.6,
					maxWidth: "760px"
				},
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h2", {
						style: {
							fontSize: "16px",
							margin: "0 0 4px",
							fontWeight: 600
						},
						children: t("set.title")
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						style: {
							opacity: .7,
							fontSize: "12px",
							margin: "0 0 20px"
						},
						children: t("set.lead")
					}),
					problem !== null ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						style: {
							marginBottom: "12px",
							fontSize: "12px",
							color: "var(--dsw-danger, #e06c75)"
						},
						children: problem
					}) : null,
					actors === null ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						style: { opacity: .7 },
						children: t("common.loading")
					}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("section", {
						style: { marginBottom: "26px" },
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Actors, {
							actors,
							reload,
							onProblem: setProblem,
							t
						})
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", { children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Heading, { children: t("set.cases") }),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
							style: {
								opacity: .7,
								fontSize: "12px",
								margin: "0 0 10px"
							},
							children: t("set.casesLead")
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							style: {
								display: "flex",
								alignItems: "center",
								gap: "8px",
								padding: "7px 0",
								borderBottom: "1px solid var(--dsw-border-subtle, rgba(127,127,127,0.28))",
								fontSize: "12.5px"
							},
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								style: {
									fontSize: "11px",
									opacity: .7,
									border: "1px solid var(--dsw-border-subtle, rgba(127,127,127,0.28))",
									borderRadius: "5px",
									padding: "0 5px"
								},
								children: t("set.bundled")
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								style: {
									flex: 1,
									fontFamily: "ui-monospace, Consolas, monospace",
									fontSize: "11.5px",
									opacity: .75
								},
								children: "cases/"
							})]
						}),
						(dirs ?? []).map((dir) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							style: {
								display: "flex",
								alignItems: "center",
								gap: "8px",
								padding: "7px 0",
								borderBottom: "1px solid var(--dsw-border-subtle, rgba(127,127,127,0.28))",
								fontSize: "12.5px"
							},
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									style: {
										fontSize: "11px",
										opacity: .7,
										border: "1px solid var(--dsw-border-subtle, rgba(127,127,127,0.28))",
										borderRadius: "5px",
										padding: "0 5px"
									},
									children: t("set.mine")
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									style: {
										flex: 1,
										fontFamily: "ui-monospace, Consolas, monospace",
										fontSize: "11.5px",
										opacity: .75,
										wordBreak: "break-all"
									},
									children: dir
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									onClick: () => void touchDir("remove", dir),
									style: {
										font: "inherit",
										fontSize: "12px",
										padding: "3px 9px",
										borderRadius: "7px",
										border: "1px solid var(--dsw-border-subtle, rgba(127,127,127,0.28))",
										background: "transparent",
										color: "inherit",
										cursor: "pointer"
									},
									children: t("set.dropDir")
								})
							]
						}, dir)),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							style: {
								display: "flex",
								gap: "8px",
								marginTop: "10px"
							},
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
								style: {
									...inputStyle,
									flex: 1
								},
								placeholder: t("set.dirPlaceholder"),
								value: draft,
								onChange: (event) => setDraft(event.target.value),
								onKeyDown: (event) => {
									if (event.key === "Enter" && draft.trim() !== "") touchDir("add", draft.trim());
								}
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								onClick: () => {
									if (draft.trim() === "") {
										setProblem(t("set.needDir"));
										return;
									}
									touchDir("add", draft.trim());
								},
								style: {
									font: "inherit",
									fontSize: "12px",
									padding: "4px 12px",
									borderRadius: "7px",
									border: "1px solid var(--dsw-accent, #4a7fd4)",
									background: "transparent",
									color: "var(--dsw-accent, #4a7fd4)",
									cursor: "pointer"
								},
								children: t("set.addDir")
							})]
						})
					] })
				]
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
			"left.relationMissing": "（本子里没写）",
			"left.noRelations": "这本子没写人物关系。",
			"left.between": "彼此之间",
			"left.expandHint": "点开看大图",
			"left.relations": "人物关系",
			"left.timeline": "时间线 · 你们说过的",
			"left.you": "你",
			"left.dead": "死者",
			"left.notSeated": "还没上桌",
			"left.nothingSaid": "其余时段还没有人交代",
			"mid.script": "剧本正文",
			"mid.scriptHint": "（点这儿收起回看）",
			"mid.clues": "线索",
			"mid.cases": "可选的本子",
			"mid.pending": "这一页的内容要从对话里来，还没接上——右栏已经在读了。",
			"step.notYet": "还没走到这一步",
			"step.backToNow": "回到当前",
			"mid.shuffle": "随机排",
			"mid.shuffleHint": "从演员池里随机挑，整桌重排",
			"mid.clueSealed": "（还没发到桌上）",
			"mid.noGame": "还没开局。在对话里让主持人开一局，这里就会显示局面。",
			"right.said": "桌上说了什么",
			"right.notStarted": "这一栏读的是这个会话里说过的话，跟局面无关——开一局之后，它们才是桌上的发言。",
			"right.composer": "说话在下面那个输入框里——它就是对话页那一个，两种形态共用同一局。",
			"right.empty": "还没人说话。开一局之后，桌上说的话会一条条出现在这儿。",
			"right.you": "你",
			"right.player": "玩家",
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
			"set.tab": "剧本杀",
			"set.title": "剧本杀",
			"set.lead": "这里管的是跨局的东西——演员是谁、他去哪儿找本子。这一局打到哪了，在「团队」标签里看。",
			"set.actors": "演员",
			"set.actorsLead": "演员是「谁在玩」，与「这一局演谁」无关。性格写得越像个人，他在桌上越不像在念稿。",
			"set.name": "名字",
			"set.style": "他/她怎么玩",
			"set.notes": "跨局印象（每局复盘后自己攒的，不能手改）",
			"set.noNotes": "还没有印象——这是他的第一条性格",
			"set.resetFace": "换回默认头像",
			"set.remove": "请走",
			"set.removeAsk": "把「{name}」请走？他攒下的跨局印象会一起没，这个撤销不了。",
			"set.add": "＋ 招一个演员",
			"set.newId": "id（英文小写，认人用）",
			"set.newName": "名字",
			"set.needBoth": "id 与名字都要填。",
			"set.confirm": "招进来",
			"set.cases": "本子上哪儿找",
			"set.casesLead": "插件自带的那份永远在；你自己的本子放在哪个目录，在这儿加一行就行。加完「团队」标签里的可选本子会多出来。",
			"set.bundled": "自带",
			"set.mine": "我的",
			"set.dropDir": "移除",
			"set.dirPlaceholder": "目录的绝对路径",
			"set.needDir": "要填一个目录。",
			"set.addDir": "＋ 加目录",
			"common.cancel": "算了",
			"common.close": "关闭",
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
			"left.relationMissing": "(not written in this case)",
			"left.noRelations": "This case does not describe any relations.",
			"left.between": "Between them",
			"left.expandHint": "click to enlarge",
			"left.relations": "Relations",
			"left.timeline": "Timeline · what they said",
			"left.you": "you",
			"left.dead": "the deceased",
			"left.notSeated": "not seated",
			"left.nothingSaid": "the rest of the night is still unaccounted for",
			"mid.script": "Your script",
			"mid.scriptHint": "(click to collapse)",
			"mid.clues": "Clues",
			"mid.cases": "Cases",
			"step.notYet": "Not reached yet",
			"step.backToNow": "Back to now",
			"mid.pending": "This page reads from the conversation — not wired up yet. The right column already is.",
			"mid.shuffle": "Shuffle",
			"mid.shuffleHint": "pick at random from the actor pool, re-seating the whole table",
			"mid.clueSealed": "(not dealt yet)",
			"mid.noGame": "No game yet. Ask the host in the conversation to start one, and the table shows up here.",
			"right.said": "What was said",
			"right.notStarted": "This column reads what has been said in this session — it is not tied to the game. Once a game starts, these become the words spoken at the table.",
			"right.composer": "You speak in the composer below — the same one the conversation page uses. Both share one game.",
			"right.empty": "Nobody has spoken yet. Once a game starts, what is said at the table shows up here.",
			"right.you": "You",
			"right.player": "Player",
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
			"set.tab": "Jubensha",
			"set.title": "Jubensha",
			"set.lead": "Everything here is cross-game — who the actors are, where cases live. Which table is mid-game is in the Team tab.",
			"set.actors": "Actors",
			"set.actorsLead": "An actor is who is playing, not who they play this game. The more like a person the style reads, the less he sounds like he is reading lines.",
			"set.name": "Name",
			"set.style": "How they play",
			"set.notes": "Cross-game impressions (earned each reveal, not hand-editable)",
			"set.noNotes": "No impressions yet — this is his first character note",
			"set.resetFace": "Reset face",
			"set.remove": "Let go",
			"set.removeAsk": "Let \"{name}\" go? The cross-game impressions go with him, and this cannot be undone.",
			"set.add": "＋ Add an actor",
			"set.newId": "id (lowercase, how he is referred to)",
			"set.newName": "Name",
			"set.needBoth": "Both an id and a name are needed.",
			"set.confirm": "Add",
			"set.cases": "Where cases live",
			"set.casesLead": "The bundled ones are always there; add a line here for a directory of your own. They show up in the Team tab right after.",
			"set.bundled": "bundled",
			"set.mine": "mine",
			"set.dropDir": "Remove",
			"set.dirPlaceholder": "absolute path to a directory",
			"set.needDir": "A directory is needed.",
			"set.addDir": "＋ Add a directory",
			"common.cancel": "Cancel",
			"common.close": "Close",
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
		/** 需要的服务：`locale` 注册文案，`slots` 挂标签，`sessions` 找会话绑定，`uiConversation` 读投影。 */
		const inject = [
			"locale",
			"slots",
			"sessions",
			"uiConversation"
		];
		/**
		* 连点三下标题之后填进输入框的那句话。
		*
		* 写得像人话，因为它会**出现在用户的输入框里**——他看得见、能改、能删。而它也得让模型一眼
		* 知道该干什么：插件注册的 `jubensha_*` 工具就摆在那儿，这句话就是那条路的开头。
		*/
		const HIDDEN_ENTRY_TEXT = "来一局剧本杀";
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
		function TeamView({ t, sessionId, readSaid }) {
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
				said: readSaid(),
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
			ctx.effect(() => installHiddenEntry(() => {
				fillComposer(HIDDEN_ENTRY_TEXT);
			}), "jubensha: hidden entry");
			ctx.effect(() => ctx.uiConversation.events.register(saidDefinition), "jubensha: said definition");
			ctx.slots.inject("conversation.view", () => ctx.slots.register({
				name: "conversation.view",
				id: "jubensha.team",
				order: 20,
				locale: "jubensha",
				label: () => ctx.locale.bind("jubensha")("view.team"),
				inject: (sessionId) => {
					const chat = ctx.uiConversation.binding(sessionId).target("chat");
					return {
						sessionId,
						readSaid: () => readSaid(chat.getSnapshot())
					};
				}
			}, TeamView));
			ctx.slots.inject("plugins.bundle.config", () => ctx.slots.register({
				name: "plugins.bundle.config",
				key: "@max-null/dsh-jubensha",
				locale: "jubensha"
			}, SettingsTab));
		}
		//#endregion
		exports.TeamView = TeamView;
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});

//# sourceMappingURL=client.js.map