import { readFileSync } from "node:fs";
import { join } from "node:path";
import { defineTool } from "@deepseek-ai/dsh-tools";
import { DomainFacility, defineDomain, domainTable } from "@deepseek-ai/dsh-storage-domain";
import { JsonStorageBackend } from "@deepseek-ai/dsh-storage-json";
import { homedir } from "node:os";
import { z } from "zod";
import { parse } from "yaml";
//#region src/actor.ts
/**
* 演员 —— 跨局存在的那个人，与它这一局演什么角色无关。
*
* **为什么需要它**：`spawn_teammate` 建出来的玩家是**会话内**的成员，一局打完就散。
* 而设计方案把人设分成两层（§2.2）：角色人设是本子给的，**玩家性格**——这个人怎么玩游戏
* ——是**跨局稳定**的。「同一份剧本换个人玩，玩法完全不同」这句话要成立，就得有一个不随
* 会话消失的载体。那就是演员：一局里他坐在某个位子上、拿某个角色本；下一局可能换位子、
* 换本子，但「他是谁」不变。
*
* 这条在「一局一个会话」拍板之后从「锦上添花」变成了**必须**：跨局的连续性再没有第二个
* 地方可放。
*
* **落盘走宿主提供的 storage，不自己写文件**：域有 zod schema 校验，一条不合格的记录会让
* 整个打开失败（fail loud）；手写的 JSON 坏掉时是静默半坏，而这份数据是跨局的——坏一次
* 会跟着所有后续的局。机制与调用顺序照 `dsh-memory/src/engine.ts` 的存储层。
*
* @module @max-null/dsh-jubensha/actor
*/
/** 存储里一条演员记录的字段；zod 是它的唯一定义处，类型由它推。 */
const storedActorSchema = z.object({
	/** 稳定 id。 */
	id: z.string(),
	/** 人看的名字，比如「老周」。 */
	name: z.string(),
	/** 这个人怎么玩游戏——第二层人设，跨局稳定。 */
	style: z.string(),
	/** 跨局攒下来的印象，**新的在前**。 */
	notes: z.array(z.string()),
	/**
	* 头像图片的位置。
	*
	* **没配就是不配**——缺省时界面按 id 生成一个 SVG（见 `avatar.ts`）。所以这里不需要一个
	* `kind: 'svg'` 的分支：生成是缺省行为，存下来的只会是"用户真的换了张图"。
	*/
	avatar: z.string().optional()
});
/**
* 演员域的声明。
*
* 域名与表名都要匹配 `UNIT_NAME_RE`（`/^[a-z][a-z0-9_]*$/`，`storage/src/backend.ts:10`），
* 因为它同时是文件名与 SQL 标识符的一段。`defineDomain` 在**模块加载时**就校验这些，
* 早于任何介质被触碰。
*/
const actorSpec = defineDomain({
	name: "jubensha",
	version: 1,
	tables: { actors: domainTable(storedActorSchema) }
});
/**
* 演员池落在哪。
*
* 跟 `dsh-memory` 的 `memory.json` 同目录——一个宿主 home 一份，**跟着人走而不是跟着工作区
* 走**：换个工作区开一局，坐下来的还是同一批演员。这也是它不进 `<cwd>/.dsh/storages` 的
* 理由（那个根随 git 分享，而演员池是私人的）。
* @returns 存储根目录。
*/
function actorRoot() {
	return join(process.env["DSH_HOME"] ?? join(homedir(), ".dsh"), "storages");
}
/**
* 打开演员池。
*
* `register` 对重名抛 `duplicate-backend`，所以 backend **只注册一次**：域名固定为
* `jubensha`，同进程重复打开会撞上它。调用方拿单例（`index.ts` 的 `requireActors`）。
* @param ctx - 插件上下文，用来取 storage 服务。
* @returns 打开的演员池。
*/
async function openActorPool(ctx) {
	ctx.storage.backend.register("jubensha_actors", new JsonStorageBackend(actorRoot()));
	const table = (await new DomainFacility(ctx, {
		backend: "jubensha_actors",
		routes: {}
	}).open(actorSpec)).table("actors");
	return {
		list() {
			const all = [...table.entries()].map(([, actor]) => actor);
			return Promise.resolve(all.sort((left, right) => left.name.localeCompare(right.name, "zh")));
		},
		get(id) {
			return Promise.resolve(table.get(id));
		},
		async add(input) {
			if (table.get(input.id) !== void 0) throw new Error(`演员池里已经有 "${input.id}" 了——换一个 id，或者用 action="note" 给他记一条。`);
			const actor = {
				id: input.id,
				name: input.name,
				style: input.style,
				notes: []
			};
			await table.put(input.id, actor);
			return actor;
		},
		note(id, text) {
			if (table.get(id) === void 0) throw new Error(`演员池里没有 "${id}"。先 action="list" 看看都有谁。`);
			return table.update(id, (current) => ({
				...current,
				notes: [text, ...current.notes]
			}));
		},
		setStyle(id, style) {
			if (table.get(id) === void 0) throw new Error(`演员池里没有 "${id}"。先 action="list" 看看都有谁。`);
			return table.update(id, (current) => ({
				...current,
				style
			}));
		},
		setAvatar(id, image) {
			if (table.get(id) === void 0) throw new Error(`演员池里没有 "${id}"。先 action="list" 看看都有谁。`);
			return table.update(id, (current) => {
				if (image !== "") return {
					...current,
					avatar: image
				};
				const { avatar: _dropped, ...withoutAvatar } = current;
				return withoutAvatar;
			});
		}
	};
}
//#endregion
//#region src/case.ts
/**
* 本子：从 YAML 到「该给谁什么」。
*
* **为什么需要它**：三局的本子都是手写 Markdown，角色本靠 DM 从手册里**手抄**再发给玩家
* ——抄漏一句就是信息隔离破了，而抄的过程没有任何检查。这里把本子变成可校验的数据：
* 格式由 `schema/case.schema.yml` 定，加载时能查出结构问题，角色本能**按角色切出来**。
*
* **只把 `roles` 结构化**：别的段落（真相、线索、带局脚本…）是给 DM 读的整块文本，
* 拆开反而丢信息，所以原样留在 `sections` 里按段取。角色本不一样——它要按座位切成
* 各自那一份，切口必须精确。
*
* @module @max-null-plugins/dsh-jubensha/case
*/
/** 本子结构不对时抛这个 —— 它意味着这份文件根本没法用，不是"提醒一下"。 */
var CaseFormatError = class extends Error {
	constructor(message) {
		super(message);
		this.name = "CaseFormatError";
	}
};
/** 取一个字段的文本；缺失时给空串（结构由调用方的校验负责，这里不重复报错）。 */
function text(value) {
	return typeof value === "string" ? value : "";
}
/** 取一个字符串数组；非数组或含非字符串项时按空处理。 */
function strings(value) {
	if (!Array.isArray(value)) return [];
	return value.filter((item) => typeof item === "string");
}
/** 取一个对象；不是对象时给空对象。 */
function record(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value) ? value : {};
}
/** 从原始 roles 段读出一条。 */
function readRole(raw, index) {
	const entry = record(raw);
	const id = text(entry["id"]);
	if (id === "") throw new CaseFormatError(`roles[${index}] 没有 id —— 每个角色都要有个座位号。`);
	const player = entry["player"] === "human" ? "human" : "ai";
	return {
		id,
		name: text(entry["name"]),
		player,
		publicIdentity: text(entry["public"]),
		now: text(entry["now"]),
		privateHistory: text(entry["private"]),
		secret: text(entry["secret"]),
		knows: strings(entry["knows"]),
		goals: strings(entry["goals"]),
		play: text(entry["play"]),
		culprit: false
	};
}
/**
* 复盘之前可以随时取用的段落。
*
* **这是白名单，不是黑名单**：不在里面的段落，`phase` 走到 `reveal` 之前一律拒答。
* 用白名单是因为漏的代价不对称——漏掉一段该开的，DM 当场就知道（取不到，报错里
* 还列着段名）；而漏掉一段该锁的，是**玩家的操作条里静静躺着一份真相**，
* 谁也不会发现，直到有人展开它。以后往 schema 加段落时，默认落在安全的那一侧。
*/
const OPEN_BEFORE_REVEAL = [
	"meta",
	"scene",
	"briefing",
	"style",
	"phases",
	"audit",
	"world_facts",
	"liberty_to_slip"
];
/** 一段在复盘之前能不能取。 */
function openBeforeReveal(section) {
	return OPEN_BEFORE_REVEAL.includes(section);
}
/**
* 取线索的**牌桌原文**，丢掉 `supports`。
*
* 这是线索进牌桌的唯一出口。分开的理由在 schema 里写着：`text` 是"现场留下了什么"，
* `supports` 是"这意味着什么"——后者只给 DM 判断用。两者若从同一个口子出去，
* 迟早有一次会被整段贴到桌上，而**连"那条没有配对的进"都替玩家讲了，线索就只剩盖章**。
* @param loaded - 加载好的本子。
* @param ids - 要取的线索 id；给空数组表示全部。
* @returns 牌桌可用的线索，以及在本子里找不到的 id。
*/
function tableClues(loaded, ids) {
	const raw = loaded.sections["clues"];
	const all = (Array.isArray(raw) ? raw : []).map((item, index) => {
		const entry = record(item);
		return {
			id: text(entry["id"]) || `c${index + 1}`,
			title: text(entry["title"]),
			text: text(entry["text"])
		};
	});
	if (ids.length === 0) return {
		clues: all,
		missing: []
	};
	const wanted = new Set(ids);
	const clues = all.filter((clue) => wanted.has(clue.id));
	const found = new Set(clues.map((clue) => clue.id));
	return {
		clues,
		missing: ids.filter((id) => !found.has(id))
	};
}
/** ref 的前缀。`roleBook` 靠它分辨手里那串是引用还是正文。 */
const BOOK_REF_PREFIX = "book:";
/**
* 一个座位的角色本封存引用。
*
* 带上本子编号，跨局不会串。**引用本身就是"这一份属于谁"的凭据**——`spawn` 时拿它和
* 座位号核一遍，就能挡住"把 p2 的本子发给了 p1"。
* @param caseId - 本子编号。
* @param seat - 座位 id。
* @returns 形如 `book:p1@03` 的引用。
*/
function bookRef(caseId, seat) {
	return `${BOOK_REF_PREFIX}${seat}@${caseId}`;
}
/**
* 从一个引用里读回座位号。
*
* 与 `bookRef` 是一对，**改动其中一边必须同时改另一边**——所以这里的用例是往返一致性，
* 而不是某个写死的字符串。
* @param ref - 待解析的引用。
* @returns 座位 id；不是本插件发的引用时给 `undefined`。
*/
function bookRefSeat(ref) {
	if (!ref.startsWith("book:")) return void 0;
	const seat = ref.slice(5).split("@")[0];
	return seat === void 0 || seat === "" ? void 0 : seat;
}
/**
* 在一段文本里认出一个引用。
*
* **只认已知的那几个**（`known` 是登记表）——所以正文里偶然出现 `book:` 字样不会被误认，
* 这让它可以比正则宽松得多：整串相等算，**整段文本里含有**也算。
*
* 需要"含有"这一档是实测逼出来的（2026-10-05）：`book` 的返回值里既有一行摘要、又有一句
* "roleBook 只填这一串"，而 DM 把**整段**填了进去。只认"整串相等"会让这种最自然的用法
* 静默失败——玩家拿不到角色本，照样能说话，从外面看不出来。
* @param text - 调用方填进 `roleBook` 的东西。
* @param known - 本进程发出去的引用们。
* @returns 认出来的引用；认不出时 `undefined`（调用方据此当作全文）。
*/
function pickBookRef(text, known) {
	if (known.has(text)) return text;
	for (const ref of known.keys()) if (text.includes(ref)) return ref;
}
/**
* 封存期内给 DM 看的一行摘要。
*
* 它只取 `public :` 与角色名——**开场就要念给所有人听的**那两样。所以它不泄漏任何东西，
* 却足以让 DM 确认手里那个 ref 指向的确实是这个位子的本子。
* @param role - 一个角色的资料。
* @returns 摘要文本。
*/
function bookPreview(role) {
	return `你是「${role.name}」。${role.publicIdentity}`;
}
/**
* 把加载好的本子拼成能直接发给玩家的角色本。
*
* **不含 `culprit`**：那是真相，属于 DM 与监察。这一条是硬的——角色本里出现
* 「你是凶手」，这一局就完了。
* @param role - 一个角色的资料。
* @returns 作为玩家首条消息正文的角色本文本。
*/
function roleBook(role) {
	const parts = [`你是「${role.name}」。`, role.publicIdentity];
	if (role.now !== "") parts.push(`--- 你现在 ---\n${role.now}`);
	parts.push(`--- 你的真实经历 ---\n${role.privateHistory}`);
	if (role.secret !== "") parts.push(`--- 你要瞒的事 ---\n${role.secret}`);
	if (role.knows.length > 0) parts.push(`--- 你知道的 ---\n${role.knows.map((item) => `- ${item}`).join("\n")}`);
	if (role.goals.length > 0) parts.push(`--- 你想要什么 ---\n${role.goals.map((item) => `- ${item}`).join("\n")}`);
	if (role.play !== "") parts.push(`--- 你要怎么演 ---\n${role.play}`);
	return parts.filter((part) => part.trim() !== "").join("\n\n");
}
/**
* 机械可查的那几条判据。
*
* 只收**程序答得了的**：结构一致性、类型与内容的匹配。像「出口有没有修在动机的延长线上」
* 这种要读懂本子才判断的，一条都不在这里——把它们写成检查只会得到假信号。
* @param genre - 本子类型。
* @param roles - 全部角色。
* @param sections - 除 roles 外的原始段落。
* @returns 发现的问题（可能为空）。
*/
function inspect(genre, roles, sections) {
	const issues = [];
	const culprit = text(record(sections["truth"])["culprit"]);
	if (genre === "deduction") {
		if (culprit === "") issues.push({
			level: "error",
			message: "genre 是 deduction，但 truth.culprit 是空的——推理本得有凶手。"
		});
		else if (!roles.some((role) => role.id === culprit)) issues.push({
			level: "error",
			message: `truth.culprit "${culprit}" 不在 roles 里。`
		});
		if (!Array.isArray(sections["clues"]) || sections["clues"].length === 0) issues.push({
			level: "warn",
			message: "genre 是 deduction，但 clues 是空的——玩家拿什么推。"
		});
	}
	if (genre === "drama") {
		if (!Array.isArray(sections["emotional"]) || sections["emotional"].length === 0) issues.push({
			level: "warn",
			message: "genre 是 drama，但 emotional 是空的——情感本的主干不该缺。"
		});
		if (culprit !== "") issues.push({
			level: "warn",
			message: `genre 是 drama，却写了 truth.culprit "${culprit}"——情感本一般没有凶手。`
		});
	}
	const humans = roles.filter((role) => role.player === "human");
	if (humans.length !== 1) issues.push({
		level: "error",
		message: `真人位应当恰好一个，这本里有 ${humans.length} 个。`
	});
	else if (humans[0]?.id !== "p0") issues.push({
		level: "warn",
		message: `真人位是 "${humans[0]?.id}"，惯例是 p0。`
	});
	const missingNow = roles.filter((role) => role.now === "").map((role) => role.id);
	if (missingNow.length > 0) issues.push({
		level: "warn",
		message: `这些角色没写「现在」：${missingNow.join("、")}——玩家会问「我人物背景呢」。`
	});
	const missingPlay = roles.filter((role) => role.player === "ai" && role.play === "").map((role) => role.id);
	if (missingPlay.length > 0) issues.push({
		level: "warn",
		message: `这些 AI 角色没写 play（怎么演）：${missingPlay.join("、")}——它只会照剧情陈述。`
	});
	return issues;
}
/**
* 解析一份本子 YAML。
*
* 结构缺到没法用时**抛 `CaseFormatError`**；能用但有问题时把问题放在 `issues` 里返回——
* 后者交给调用方决定是拦下还是提醒。
* @param source - 本子文件的全文。
* @returns 加载好的本子与校验结果。
*/
function loadCase(source) {
	let document;
	try {
		document = parse(source);
	} catch (error) {
		throw new CaseFormatError(`本子不是合法的 YAML：${error instanceof Error ? error.message : String(error)}`);
	}
	const root = record(document);
	const meta = record(root["meta"]);
	const id = text(meta["id"]);
	if (id === "") throw new CaseFormatError("meta.id 是空的——本子要有个编号。");
	const rolesRaw = root["roles"];
	if (!Array.isArray(rolesRaw) || rolesRaw.length === 0) throw new CaseFormatError("roles 段缺失或是空的——没有角色就不是本子。");
	const culpritId = text(record(root["truth"])["culprit"]);
	const roles = rolesRaw.map((raw, index) => {
		const role = readRole(raw, index);
		return culpritId !== "" && role.id === culpritId ? {
			...role,
			culprit: true
		} : role;
	});
	const declared = typeof meta["players"] === "number" ? meta["players"] : roles.length;
	const sections = {};
	for (const [key, value] of Object.entries(root)) if (key !== "roles") sections[key] = value;
	const issues = inspect(text(meta["genre"]), roles, sections);
	if (declared !== roles.length) issues.push({
		level: "error",
		message: `meta.players 写的是 ${declared}，实际有 ${roles.length} 个角色。`
	});
	return {
		id,
		title: text(meta["title"]),
		genre: text(meta["genre"]),
		roles,
		sections,
		issues
	};
}
/**
* 玩家能做的全部事情。
*
* 这份名单是**两层收窄**共同的输入（`index.ts` 的 `confine`）：
*
* - `tools.restrict({ allow: PLAYER_TOOLS })` 管**看不看得见**。不在名单里的工具对玩家根本不
*   存在，模型不会去试，省掉一轮浪费。
* - `tools/pre-execute` 上的兜底闸管**准不准执行**。`restrict` 按定义只过滤 scope **继承**到的
*   东西（`view()` 的 JSDoc：`never what its OWN layer registers`），而内核的委派工具
*   `subagent` 正是每个 agent 创建时注册进**它自己那层**的（`tool-subagent/src/index.ts:665-683`
*   用 `candidate.ctx`）——那一层只有这道闸拦得住。
*
* **用白名单而不是黑名单**：新内核会加新工具，逐个 `deny` 的清单会随时间过期，而白名单只保留
* 点名的那些，天然免疫这件事。代价是名字必须真实存在——`restrict()` 对未知名字直接抛错，而那
* 个失败模式正好是我们想知道的：名单里少了 `send_message`，就等于玩家没法开口。
*
* 两层机制的实测、源码位置与那次「假名字换出可过滤工具全表」的实验见
* `docs/设计/2026-10-05-spawn_player-可行方案.md`。
*/
const PLAYER_TOOLS = ["send_message"];
/**
* 演员那一段。**不写座位**——同一批演员换位子是常事，写了反而让他以为换了人。
* @param actor - 谁来演这一局。
* @returns 插在角色本之前的那一段。
*/
function actorSection(actor) {
	const parts = [`--- 谁在玩这个角色 ---\n这一局由「${actor.name}」来演。你怎么玩这个游戏，跟你这次拿到什么角色无关：`, actor.style];
	if (actor.notes.length > 0) {
		parts.push("你还记得这些（都是**前面几局**的事，跟这一局的人无关）：");
		parts.push(actor.notes.map((note) => `- ${note}`).join("\n"));
	}
	return parts.join("\n");
}
/**
* 拼一位玩家的上台说明 —— 他这个子会话收到的第一段话。
*
* **只说 `lead`，不说 session id。** Team 的 `send_message` 按成员**名字**解析目标
* （`agent-team/src/mailbox.ts:120` 的 `resolveActiveMember(root, state, request.target)`），
* 找不到就抛 `active teammate "…" not found`（`roster.ts:52`）。而主持人的 session id
* **不是**一个成员名——2026-10-05 实测：告诉玩家 session id，它十次全失败，一个字都没说出口；
* 那一局从外面看只是"这位玩家很安静"。所以这里只给一个走得通的名字，闸也只放这一个。
*
* 只写游戏层的事：他是谁、话怎么传到桌上、他的角色本是什么。**不写**「你没有别的工具」
* 这类权限说明——内核已经给每个子 agent 注入了委派范围声明（`SUBAGENT_DELEGATION_CONTEXT`），
* 再说一遍只是噪声。
* @param input - 座位、角色名、角色本，以及谁来演这一局。
* @returns 作为子会话首条用户消息的文本。
*/
function playerBrief(input) {
	const parts = [`你是「${input.name}」，坐在 ${input.seat} 号位。这是一桌剧本杀，你是**玩家**，不是助手：你要以这个角色的身份说话、被人盘问、也盘问别人，而不是帮谁完成任务。`];
	if (input.actor !== void 0) parts.push(actorSection(input.actor));
	parts.push("你的每一句发言都用 send_message 发给 \"lead\"——那就是主持人，target 就填这一串。发言没发出去，就等于你什么都没说——桌上没有人替你转达。\n消息正文就是你说出口的话，不要加「我说：」这类前缀，也不要在消息之外补充说明。");
	parts.push(`--- 你的角色本 ---\n${input.roleBook}\n--- 角色本结束 ---`);
	parts.push("角色本没写的事，你就是不知道。想知道，去问别人。");
	return parts.join("\n\n");
}
/**
* 建一张空的玩家登记表。
*
* 同座位重复上桌**抛错而不是替换**：第二次 spawn 会创建一个新的子会话，而第一个还挂在
* 那个座位上、还在等消息——静默替换会把一个活着的 player 变成没人收的孤儿。
* @returns 新的登记表。
*/
function createRegistry() {
	const bySeat = /* @__PURE__ */ new Map();
	const said = /* @__PURE__ */ new Map();
	return {
		seat(handle) {
			const sitting = bySeat.get(handle.seat);
			if (sitting !== void 0) throw new Error(`座位 "${handle.seat}" 上已经有人了（${sitting.name}）；先 unseat 再 spawn。`);
			bySeat.set(handle.seat, handle);
		},
		get(seat) {
			return bySeat.get(seat);
		},
		find(childId) {
			for (const handle of bySeat.values()) if (handle.childId === childId) return handle;
		},
		unseat(seat) {
			said.delete(seat);
			return bySeat.delete(seat);
		},
		list() {
			return [...bySeat.values()];
		},
		recordSaid(seat, text) {
			said.set(seat, text);
		},
		lastSaid(seat) {
			return said.get(seat);
		}
	};
}
//#endregion
//#region src/state.ts
/**
* 局面状态机 —— 一局剧本杀「现在到哪了」的机器可读记录。
*
* **为什么需要它**：跑三局的过程中，阶段、轮次、线索给没给，一直记在 DM 的对话记忆里。
* 一旦上下文被压缩或会话断掉，这些事实就跟着没了，复盘也只能靠回忆。这里把它变成一份
* 可读、可写、可测的状态 —— **复盘 = 读日志**。
*
* 两条来自实测的领域规则：
*
* 1. **线索只记 id，不记文本**。进牌桌的是本子里的原文；写本时标注的 `supports`
*    （"它能推出什么"）是给 DM 判断用的。`schema/case.schema.yml` 的判据 4 记着这条的
*    来由：第二局的监察追问「桌上给玩家的门禁文本，是只给六条时间，还是把『22:41 没有
*    配对的进』这句注解一起给了？」—— 连"那条没有配对的进"都替他讲了，线索就只剩盖章。
*    状态机因此只记「发了哪一条」，正文与解读都不经过它。
* 2. **搜证阶段之前不给线索** —— 提前给会让问话阶段失去意义。
*
* @module @max-null/dsh-jubensha/state
*/
/** 阶段顺序，与 `schema/case.schema.yml` 的 `phases` 一致。 */
const PHASE_ORDER = [
	"self-intro",
	"inquiry",
	"search",
	"final",
	"reveal"
];
/** 在一个已有日志后面追加一条。 */
function append(log, phase, kind, detail) {
	return [...log, {
		at: log.length + 1,
		phase,
		kind,
		detail
	}];
}
/**
* 开一局：落在第一个阶段，并留下一条进入记录。
* @param input - 开局输入。
* @returns 初始局面。
*/
function createGame(input) {
	const phase = PHASE_ORDER[0];
	return {
		caseId: input.caseId,
		title: input.title,
		seats: [...input.seats],
		humanSeat: input.humanSeat,
		phase,
		round: 1,
		revealedClues: [],
		log: append([], phase, "phase-enter", phase)
	};
}
/**
* 推进到下一阶段。
*
* **已在终点（复盘）时原样返回同一个对象** —— 不是"再进一个空阶段"。判据是复盘之后
* 没有下一步可走，凭空造一个阶段会让日志与流程对不上。
* @param state - 当前局面。
* @returns 推进后的新局面；已在终点时即传入的那个对象。
*/
function advance(state) {
	const next = PHASE_ORDER[PHASE_ORDER.indexOf(state.phase) + 1];
	if (next === void 0) return state;
	return {
		...state,
		phase: next,
		log: append(state.log, next, "phase-enter", next)
	};
}
/**
* 公布线索。
*
* 只接受线索 id：正文与解读都不经过状态机（见模块注释规则 1）。搜证阶段之前调用是**空操作**，
* 返回传入的那个对象 —— 让调用方无法用"早给一条"绕过阶段约束，也让这类调用在日志里没有痕迹。
* @param state - 当前局面。
* @param ids - 本次公布到桌上的线索 id。
* @returns 公布后的新局面；阶段未到或全部重复时即传入的那个对象。
*/
function revealClues(state, ids) {
	if (state.phase === "self-intro" || state.phase === "inquiry") return state;
	const fresh = ids.filter((id) => !state.revealedClues.includes(id));
	if (fresh.length === 0) return state;
	let log = state.log;
	for (const id of fresh) log = append(log, state.phase, "clue-revealed", id);
	return {
		...state,
		revealedClues: [...state.revealedClues, ...fresh],
		log
	};
}
/**
* 是否已到复盘阶段。
* @param state - 当前局面。
* @returns 到达复盘阶段为 `true`。
*/
function isFinished(state) {
	return state.phase === "reveal";
}
/**
* 是不是还在**封存期**——带答案的东西一件都不交出去。
*
* 与 `isFinished` 是同一件事的两面：**复盘就是解封**。给它一个独立的名字，是因为调用点
* 问的是「现在能不能给」（真相保险箱），不是「这局跑完了没有」；两者哪天分开了，
* 只有一个地方要改。
*
* **没开局也算封存期**：这条判据按"默认不给"写。没开局却要真相，只可能是取错了本子，
* 让它失败比让它通过有用。
* @param state - 当前局面；还没开局时给 `undefined`。
* @returns 复盘之前一律 `true`。
*/
function isSealed(state) {
	return state === void 0 || !isFinished(state);
}
//#endregion
//#region src/index.ts
/** 插件名。 */
const name = "dsh-jubensha";
/**
* 需要的服务。
*
* **`storage` 必须声明，不是"用 `ctx.get` 兜着就行"**：演员池用的 `DomainFacility` 与
* `JsonStorageBackend` 内部按**属性**访问 `ctx.storage`，而属性代理只认声明过的注入。
* 2026-10-05 实测的失败样子：五个演员动作全返回 `cannot get property "storage" without
* inject`，连带着 `jubensha_player` 的 `spawn`（传了 `actor` 时）也一起挂——而**不传 actor
* 的 spawn 一直正常**，所以这个错看起来像是"演员功能坏了"，实际是插件没有声明它依赖的服务。
*/
const inject = ["tools", "storage"];
/**
* 当前这一局。
*
* **单进程单局**：状态挂在模块上，不是挂在会话上。一个进程同时开两局会互相覆盖——
* 要做多局并存，得把状态挪到会话作用域（`ctx.agents` 那条线），那是下一步的事。
*/
let current;
/** 工具名。 */
const STATE_TOOL = "jubensha_state";
/** 没开局时的统一错误文本。 */
const NO_GAME = "还没有开局——先用 action=\"start\" 给出 caseId / title / seats / humanSeat。";
/** 玩家工具名。 */
const PLAYER_TOOL = "jubensha_player";
/** 本子工具名。 */
const CASE_TOOL = "jubensha_case";
/** 演员工具名。 */
const ACTOR_TOOL = "jubensha_actor";
/**
* 上台说明里带几条跨局印象。
*
* 上限是判据不是省事：印象存在池子里会一直长，而 brief 每局都要重发一遍。三条够它认出
* "上次栽在谁手里"，多出来的只会把角色本挤到后面去。
*/
const NOTES_IN_BRIEF = 3;
/**
* 演员池：跨局的那份名册。
*
* **开一次就够**：`storage.backend.register` 对重名抛 `duplicate-backend`，域也只开一次。
* 存成一个 Promise 而不是已开好的对象，是因为工具的执行是异步的——第一个调用进来时它可能
* 还在开，后来的调用应该等同一个 Promise，而不是各自去开第二份。
*/
let actors;
/**
* 取演员池。
*
* 打开是**懒的**：没用到跨局记忆的局（比如试一本新本子）不该因为 storage 缺失而整个插件
* 报错。缺 storage 时错误在这里抛，只影响真正要用它的那几个动作。
* @param ctx - 插件上下文。
* @returns 打开好的演员池。
*/
function requireActors(ctx) {
	actors ??= openActorPool(ctx);
	return actors;
}
/**
* 把池子里的一条记录整理成工具返回值。
*
* 复制的理由与 `snapshot()` 一样：记录里的字段是 readonly，而工具的输出契约按可变数组声明
* （schema 表达不了 readonly），直接交出去类型不符。
* @param actor - 演员池里的一条记录。
* @returns 可交给工具输出契约的形状。
*/
function toActorOut(actor) {
	return {
		id: actor.id,
		name: actor.name,
		style: actor.style,
		notes: [...actor.notes],
		...actor.avatar === void 0 ? {} : { avatar: actor.avatar }
	};
}
/**
* 写一条性格时该照着什么写。
*
* 这两条来自设计方案 §2.2，是**验收判据**不是修辞建议：写成形容词列表的性格影响不到任何
* 决策（在票型上留不下痕迹），所以那样写等于没写。
*/
const STYLE_GUIDE = [
	"① 写成**决策偏好**，不要写成形容词列表。",
	"   「性格火爆、心直口快」一出手就被识破是表面功夫，也影响不到任何决策；",
	"   写成「抓到一点就往前压，宁可压错」，它才会在票型上留下痕迹。",
	"",
	"② 写到**「他想选什么，但实际做成了什么」**——欲望与能力的缺口。",
	"   原型是那个平时嘴上没把门、愿望偏偏是守口如瓶一次的人：他要的不是守住秘密，",
	"   是体验自己能守。而他漏出去的不是内容，是行为。"
].join("\n");
/** 本子文件名 —— 工具按 `<dir>/case.yml` 找，这份约定写在 `schema/case.schema.yml` 头部。 */
const CASE_FILE = "case.yml";
/**
* 这一局的玩家登记。
*
* 与 `current` 一样挂在模块上（单进程单局）。但它比局面状态短命得多：局面可以拿去复盘，
* 登记表不能——里面的子会话 id 在进程结束后没有任何意义。
*/
const players = createRegistry();
/**
* 封存的角色本：ref → 全文。
*
* **为什么要有它**：角色本是这一局最不该被看见的东西——每位玩家要瞒的事全在里面。而它
* 进玩家手里之前必须经过 DM 的手，于是全文就落在 DM 的上下文里；玩家的界面能看到思考块
* 与工具操作条（`docs/设计/2026-10-04-单机剧本杀-设计方案.md` §3.2 风险一），**展开就看见**。
*
* 所以改成过手不过目：`jubensha_case action="book"` 在复盘之前只返回一个 ref，
* 全文留在这里；`jubensha_player` 收 ref 自己解开。DM 从头到尾没读到过。
* 副作用是好的——它顺带堵死了"DM 自己转述角色本时抄漏一句"（那条路以前只靠描述里的警告）。
*/
const sealedBooks = /* @__PURE__ */ new Map();
/**
* 把 `roleBook` 入参解成正文——它可能是一个封存引用，也可能是全文。
*
* 两种都收，因为两条路都有正当用法：上桌走引用（正文不过 DM 的手），复盘或临时补位时
* 直接给全文更省事。认出引用就按引用走，认不出就当作全文。
*
* **引用要对着座位核一遍**：引用是当场按座位生成的，而 `spawn` 也自带一个座位号。
* 两者不一致就是"把别人的本子发给了这个人"——角色本串位是信息隔离破得最彻底的一种，
* 所以这一条按 `spawn` 的参数能查出来的事实来查，不靠 DM 记得住。
* @param raw - 调用方给的 `roleBook`。
* @param seat - 这次 `spawn` 的座位 id；只有引用用得上它。
* @returns 要发给玩家的角色本正文。
*/
function resolveBook(raw, seat) {
	const ref = pickBookRef(raw, sealedBooks);
	if (ref === void 0) return raw;
	const bound = bookRefSeat(ref);
	if (bound !== void 0 && bound !== seat) throw new Error(`这份角色本是座位 "${bound}" 的，不能发给 "${seat}"——每个座位只能拿到自己那一份。重新取一份 ${seat} 的。`);
	return sealedBooks.get(ref) ?? raw;
}
/**
* 现在还在不在封存期——判据本身在 `state.ts` 的 `isSealed`，这里只是把它接到这一局上。
* @returns 复盘阶段之前一律 `true`。
*/
function sealed() {
	return isSealed(current);
}
/** 复盘之前拒答时给的出路；把「现在该用什么」直接写进去，而不是只说不行。 */
function sealNote(section) {
	if (section === "truth") return "这一局还封着——真相里写着谁是真凶。带局要用的东西不在真相里：流程看 briefing，线索进牌桌走 action=\"clue\"，玩家推得对不对看线索的 supports。";
	if (section === "clues") return "整段 clues 里带着 supports（\"这条能推出什么\"），所以整段封着——它只给 DM 判断用。要把线索送到桌上，用 action=\"clue\"，它只给原文。";
	return "这一段的答案要等复盘（phase 走到 reveal）。";
}
/** 桌上现在有谁，一句人话；错误信息与调用结果都用它。 */
function tableText() {
	const sitting = players.list();
	if (sitting.length === 0) return "桌上还没有 AI 玩家";
	return sitting.map((player) => `${player.seat}=${player.name}`).join("、");
}
/** 取委派服务。没有它就没有人上得了桌，所以这里直接抛，不做降级。 */
function requireSubagents(ctx) {
	const subagents = ctx.get("subagents");
	if (subagents === void 0) throw new Error(`这个部署里没有 subagent 服务，${PLAYER_TOOL} 用不了——需要 @deepseek-ai/dsh-subagent 与 subagent-spawn-in-process。`);
	return subagents;
}
/** 已经收窄过的玩家。`agent/created` 与 spawn 返回后各会调一次，靠它去重。 */
const confined = /* @__PURE__ */ new WeakSet();
/**
* 正在等座位主人的 DM —— DM 的 session id → 那位待上桌玩家的座位与角色名。
*
* **为什么需要它**：收窄必须赶在玩家的第一个请求之前，而 `spawnTeammate` 返回时玩家可能
* 已经跑起来了（2026-10-05 实测：头两个请求带着全套工具，第三个才是收窄后的）。`agent/created`
* 比它早，但那一刻只拿得到一个 Agent、认不出它是不是玩家——这张登记表就是那个判据：
* 以某位 DM 为父、而且这位 DM 正在等人，来者即玩家。
*/
const awaiting = /* @__PURE__ */ new Map();
/** Team 里主持人固定的名字——`spawn_teammate` 给每个成员的初始说明里就写着它。 */
const LEAD_NAME = "lead";
/**
* 座位号后面缀什么才不撞名。
*
* Team 名册**跨进程持久**：一个名字在这个 DM 的会话里用过一次，就永远不能再用
* （`roster.ts:271-273` 对重名抛 `TEAM_MEMBER_NAME_TAKEN`）。2026-10-05 踩了两轮才看清：
* 先是同进程内第二次上桌就撞，改成单调计数；重启后又撞——**计数器是进程级的，名册不是**。
* 所以后缀必须自带唯一性，不能依赖任何进程内状态。人看的是 `description`（label），
* 这个 name 只有机器用，丑一点没关系。
* @param seat - 座位 id。
* @returns 一个不与既往用过的名字相撞的 teammate 名。
*/
function teammateName(seat) {
	return `${seat}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
}
/** 从一次调用的原始入参里取 `target`；取不到就由调用方当作「没有有效对象」。 */
function readTarget(raw) {
	if (typeof raw !== "object" || raw === null) return void 0;
	const target = raw["target"];
	return typeof target === "string" ? target : void 0;
}
/** 从一次 `send_message` 的原始入参里取正文；空串按「没说」处理。 */
function readMessage(raw) {
	if (typeof raw !== "object" || raw === null) return void 0;
	const message = raw["message"];
	return typeof message === "string" && message.trim() !== "" ? message : void 0;
}
/** 按座位取回玩家，取不到就直接抛——每个要用座位的动作都该在这里失败。 */
function requirePlayer(seat) {
	const player = players.get(seat);
	if (player === void 0) throw new Error(`座位 "${seat}" 上没人（${tableText()}）。`);
	return player;
}
/**
* 把一句话送到几位玩家手里。
*
* **一个一个发，不等并发**：`sendMessage` 对忙着的目标按步边界投递，并发发多条并不会更快，
* 只会让"发到一半失败"时说不清谁收到了。发不出去就直接抛——**静默漏掉一个人是这一块最坏的
* 失败**，因为漏掉的那位不会知道自己漏了什么，而桌上其他人以为他听见了。
* @param ctx - 插件上下文，用来取委派服务。
* @param dm - 主持人 agent；消息由他发出。
* @param listeners - 要送到的人。
* @param text - 送出去的正文。
* @param signal - 这次工具调用的取消信号。
*/
async function deliver(ctx, dm, listeners, text, signal) {
	const subagents = requireSubagents(ctx);
	for (const listener of listeners) await subagents.sendMessage(dm, listener.childId, [{
		type: "text",
		text
	}], { signal });
}
/**
* 把一位玩家收窄到「只能说话」—— 两层，各管一段。
*
* **第一层 `restrict`** 管的是可见性：不在白名单里的工具对玩家**根本不存在**，模型不会去试。
* 但它按定义只过滤 scope **继承**到的东西（`view()` 的 JSDoc：`never what its OWN layer
* registers`），而内核的委派工具 `subagent` 正是每个 agent 创建时注册进**它自己那层**的
* （`subagent/tool-subagent/src/index.ts:665-683` 用 `candidate.ctx`）——那一层它管不着。
*
* **第二层 `tools/pre-execute`** 管的是准不准执行：它在工具解析之后、执行之前跑，carrier 是
* `scopeTarget(this, exec.agent)`（`core/tools/src/index.ts:1504-1505`），按**执行者本人**的
* scope 路由，所以它不问那个工具注册在哪一层。第一层漏掉的都归它兜——2026-10-05 实测拦住了
* own 层的 `list_agents`。
*
* 第二层还多管一件事：**说话只说给主持人**。Team 版的 `send_message` 收 teammate 名字，
* 玩家理论上能点名任何一位同伴——那会变成串供。所以这里把对象也收成一个小集合。
*
* **集合里只有 `lead`，没有主持人的 session id。** 那个 id 不是成员名，Team 按名字解析
* （`agent-team/src/mailbox.ts:120`），给了它也发不出去——2026-10-05 实测里那位玩家
* 因此一个字都没说出口。**放行一个走不通的名字，比拒绝它更坏**：拒绝至少会当场报错。
* @param agent - 那位玩家的 agent。
* @param seat - 座位 id，只出现在拒绝理由里，让模型知道是谁被挡了。
*/
function confine(agent, seat) {
	if (confined.has(agent)) return;
	confined.add(agent);
	const allowed = new Set(PLAYER_TOOLS);
	const audience = /* @__PURE__ */ new Set([LEAD_NAME]);
	agent.ctx.tools.restrict({ allow: [...PLAYER_TOOLS] });
	agent.ctx.on("tools/pre-execute", (exec, next) => {
		if (!allowed.has(exec.name)) return Promise.resolve({
			kind: "deny",
			reason: `座位 ${seat} 上只做一件事：说话。${exec.name} 用不了。`
		});
		if (exec.name === "send_message") {
			const target = readTarget(exec.arguments);
			if (target === void 0 || !audience.has(target)) return Promise.resolve({
				kind: "deny",
				reason: `座位 ${seat} 只能对主持人说话${target === void 0 ? "" : `，"${target}" 不是主持人`}。`
			});
		}
		return next();
	});
	agent.ctx.on("tools/result", (exec, result) => {
		if (exec.name !== "send_message" || result.isError) return;
		const said = readMessage(exec.arguments);
		if (said !== void 0) players.recordSaid(seat, said);
	});
}
/**
* 从名册行取回 agent 再收窄。拿不到就抛——静默放过等于让一位不受限的玩家坐上了桌。
* @param ctx - 插件上下文，用来取 agent 注册表。
* @param member - `spawnTeammate` 返回的名册行。
* @param seat - 座位 id。
*/
function confineMember(ctx, member, seat) {
	const agents = ctx.get("agents");
	if (agents === void 0) throw new Error(`这个部署里没有 agent 注册表，${PLAYER_TOOL} 收不了口。`);
	const agent = agents.get(member.id);
	if (agent === void 0) throw new Error(`玩家 agent（${member.name}）不在注册表里，收窄没做成——先别让它上桌。`);
	confine(agent, seat);
}
/** 组装工具描述：把「什么时候该调它」写在最前面，模型据此判断而非猜。 */
function describeTool() {
	return "Read or advance the current 剧本杀 (murder-mystery) game state: which phase the table is in, who is seated, and which clues have been dealt. Call it at every phase change so the flow lives in the log instead of in your memory — the debrief afterwards is a read of that log. 剧本杀局面工具：开一局 / 推进阶段 / 公布线索 / 查看当前局面。每一个阶段切换都调一次——流程记在日志里，复盘直接读它，不靠回忆。";
}
/** 组装玩家工具的描述：同样把「什么时候该调它」写在最前面。 */
function describePlayerTool() {
	return "Seat AI players at a 剧本杀 table and talk to them. A player is a continuable subagent restricted to one tool — send_message, addressed to \"lead\" — so it can speak to you and read nothing else: not the case files, not another player's 角色本. Its 角色本 arrives as its first message, and every line it says reaches you as a send_message from it. action=\"say\" only delivers your line; the player answers on its own turn, so never wait for a reply inside this call. Use action=\"say\" with seat=\"*\" to speak to the whole table in one call. A player hears only what you send it, so when one player says something the others should have heard, pass it on with action=\"relay\" — that replays his own words from the record, so his line reaches the table as he said it rather than as you retold it. 剧本杀玩家工具：让 AI 玩家上桌 / 对某位玩家说话 / 把某位玩家的话转达给其他人 / 请他下桌 / 看桌上都有谁。spawn 之后玩家只拿到自己的角色本，且只能说话——他读不到本子文件，也读不到别人的角色本。say 带 seat=\"*\" 是一次说给全桌听；玩家只听得见你发给他的东西，所以某人说了该让全桌听见的话时，用 relay 转达——它把那位玩家的原话放回桌上，不经过你的复述。say 只负责把话送到；玩家的回答在他自己的回合里发回来，不在这次调用里等。";
}
/** 组装演员工具的描述：同样把「什么时候该调它」写在最前面。 */
function describeActorTool() {
	return "Keep the cast of 剧本杀 players — the people who sit down, as opposed to the roles they play this time. A character comes from the case; who the player is comes from here, and it survives the session: the same actor can take a different seat with a different 角色本 next game and still remember what happened before. Use action=\"add\" to bring someone in, action=\"note\" after a game to record what he carries into the next one, and hand the actor id to jubensha_player when seating him. 剧本杀演员工具：管「这桌由谁来玩」——它跟这一局演什么角色是两回事。角色来自本子，人来自这里，而且**跨局活着**：同一个演员下一局可以换座位、换角色本，但他记得前面几局发生过什么。add 是招人，note 是一局结束后记下他该带走的东西，上桌时把 actor id 交给 jubensha_player。";
}
/** 组装本子工具的描述：同样把「什么时候该调它」写在最前面。 */ function describeCaseTool() {
	return "Read a 剧本杀 case file kept as data: which seats it has, one role's own brief, the clues as the table sees them, or one whole section (the scene, the briefing script, the review questions). Call action=\"load\" first — it also reports the format problems it finds, and that check is the reason cases are data instead of prose. Use action=\"book\" to get one role's brief: before the review it returns a sealed ref instead of the text, so hand that ref to jubensha_player as its roleBook verbatim — the brief never passes through your context, and a player can never be handed another seat's brief by mistake. Use action=\"clue\" to put clues on the table: it returns only what the players get to read, never the \"what it means\" part. Sections holding the answer stay sealed until the review. 剧本杀本子工具：看这本有哪几个座位 / 取某个角色的角色本 / 取线索的牌桌原文 / 取本子的某一段（场景、带局脚本、复盘脚本…）。先调 load，它会顺带报出格式问题——把本子做成数据就是为了这一步。上桌时用 book 取角色本、把返回值（复盘前是一个封存 ref）**原样**填进 jubensha_player 的 roleBook，不要自己转述，更不要把别的座位的发给他。线索送到桌上用 clue，它只给玩家要读的原文。带答案的段（真相、整段线索）封到复盘，取不到是设计如此，报错里会说你该用什么。";
}
/**
* 把一次调用的结果整理成工具返回值。
*
* 数组要复制成可变副本：`GameState` 的字段都是 `readonly`，而工具的输出契约按可变数组
* 声明（schema 表达不了 readonly），直接把状态里的数组交出去会类型不符。复制顺带也避免了
* 调用方改到状态内部。
*/
function snapshot(state) {
	return {
		...state,
		seats: [...state.seats],
		revealedClues: [...state.revealedClues],
		log: [...state.log],
		finished: isFinished(state)
	};
}
/**
* 注册局面工具；监听器与注册项随 `ctx` 生命周期销毁。
* @param ctx - 插件上下文。
*/
function apply(ctx) {
	console.info(`[${name}] loaded · registers ${STATE_TOOL}, ${PLAYER_TOOL}, ${CASE_TOOL}, ${ACTOR_TOOL}`);
	ctx.tools.register(defineTool({
		name: STATE_TOOL,
		description: describeTool(),
		parameters: {
			action: {
				type: "string",
				enum: [
					"show",
					"start",
					"advance",
					"reveal"
				],
				description: "show = 查看当前局面（默认）；start = 开一局；advance = 推进到下一阶段；reveal = 公布线索到桌上。"
			},
			caseId: {
				type: "string",
				description: "start 用：本子编号，如 \"01\"。"
			},
			title: {
				type: "string",
				description: "start 用：本子名，如「拾光照相馆」。"
			},
			seats: {
				type: "array",
				items: { type: "string" },
				description: "start 用：桌上的位子（角色 id），按发言顺序。"
			},
			humanSeat: {
				type: "string",
				description: "start 用：真人占的角色 id。"
			},
			clues: {
				type: "array",
				items: { type: "string" },
				description: "reveal 用：本次公布到桌上的线索 id（只给 id，线索正文由本子决定，不进这里）。"
			}
		},
		output: {
			schema: {
				type: "object",
				additionalProperties: false,
				properties: {
					caseId: { type: "string" },
					title: { type: "string" },
					seats: {
						type: "array",
						items: { type: "string" }
					},
					humanSeat: { type: "string" },
					phase: { type: "string" },
					round: { type: "integer" },
					revealedClues: {
						type: "array",
						items: { type: "string" }
					},
					log: {
						type: "array",
						items: {
							type: "object",
							additionalProperties: false,
							properties: {
								at: { type: "integer" },
								phase: { type: "string" },
								kind: { type: "string" },
								detail: { type: "string" }
							}
						}
					},
					finished: { type: "boolean" }
				}
			},
			render: (_args, value) => [{
				type: "text",
				text: JSON.stringify(value, null, 2)
			}]
		},
		execute(args) {
			switch (args.action ?? "show") {
				case "start": {
					const { caseId, title, seats, humanSeat } = args;
					if (caseId === void 0 || title === void 0 || seats === void 0 || humanSeat === void 0) throw new Error("开局需要 caseId / title / seats / humanSeat 四项都给。");
					current = createGame({
						caseId,
						title,
						seats,
						humanSeat
					});
					break;
				}
				case "advance":
					if (current === void 0) throw new Error(NO_GAME);
					current = advance(current);
					break;
				case "reveal":
					if (current === void 0) throw new Error(NO_GAME);
					current = revealClues(current, args.clues ?? []);
			}
			if (current === void 0) throw new Error(NO_GAME);
			return Promise.resolve(snapshot(current));
		}
	}));
	ctx.on("agent/created", ({ agent }) => {
		const sitting = players.find(agent.session.header.id);
		if (sitting !== void 0) {
			confine(agent, sitting.seat);
			return;
		}
		const parent = agent.session.header.parentSession;
		if (parent === void 0) return void 0;
		const pending = awaiting.get(parent);
		if (pending === void 0) return void 0;
		awaiting.delete(parent);
		confine(agent, pending.seat);
	});
	ctx.tools.register(defineTool({
		name: CASE_TOOL,
		description: describeCaseTool(),
		parameters: {
			action: {
				type: "string",
				enum: [
					"load",
					"section",
					"book",
					"clue"
				],
				description: "load = 加载并校验（默认）；section = 取某一段原文；book = 取某个角色的角色本；clue = 取线索的牌桌原文。"
			},
			dir: {
				type: "string",
				description: "本子目录（读其中的 case.yml），或者直接给那份文件的路径。"
			},
			section: {
				type: "string",
				description: "section 用：段名，如 scene / truth / clues / emotional / briefing / style / audit / reveal。复盘之前带答案的段取不到，报错里会说该用什么代替。"
			},
			role: {
				type: "string",
				description: "book 用：座位 id，如 \"p1\"。"
			},
			clues: {
				type: "array",
				items: { type: "string" },
				description: "clue 用：要取哪几条线索（id）；不填表示全部。"
			}
		},
		output: {
			schema: {
				type: "object",
				additionalProperties: false,
				properties: {
					caseId: { type: "string" },
					title: { type: "string" },
					genre: { type: "string" },
					seats: {
						type: "array",
						items: {
							type: "object",
							additionalProperties: false,
							properties: {
								id: { type: "string" },
								name: { type: "string" },
								player: { type: "string" }
							}
						}
					},
					sections: {
						type: "array",
						items: { type: "string" }
					},
					text: { type: "string" },
					ref: { type: "string" },
					sealed: { type: "boolean" },
					missing: {
						type: "array",
						items: { type: "string" }
					},
					issues: {
						type: "array",
						items: {
							type: "object",
							additionalProperties: false,
							properties: {
								level: { type: "string" },
								message: { type: "string" }
							}
						}
					}
				}
			},
			render: (args, value) => {
				if (value.sealed === true) return [{
					type: "text",
					text: `${value.text ?? ""}\n\n角色本全文已封存，不经过你的上下文。上桌时 ${PLAYER_TOOL} 的 roleBook 只填下面这一串——只填这一串：\n${value.ref ?? ""}`
				}];
				if ((args.action ?? "load") !== "load") {
					const missing = value.missing ?? [];
					const note = missing.length > 0 ? `\n\n（这本里没有这些线索：${missing.join("、")}）` : "";
					return [{
						type: "text",
						text: `${value.text ?? ""}${note}`
					}];
				}
				const lines = [`《${value.title ?? ""}》（case ${value.caseId ?? ""}｜${value.genre ?? ""}）`];
				for (const seat of value.seats ?? []) lines.push(`  ${seat.id}  ${seat.name}（${seat.player}）`);
				lines.push(`  可取的段：${(value.sections ?? []).join("、")}`);
				for (const issue of value.issues ?? []) lines.push(`  [${issue.level}] ${issue.message}`);
				if ((value.issues ?? []).length === 0) lines.push("  校验：没有问题");
				return [{
					type: "text",
					text: lines.join("\n")
				}];
			}
		},
		execute(args) {
			const { dir } = args;
			if (dir === void 0) throw new Error("要给 dir——本子目录，或那份 case.yml 的路径。");
			const file = /\.ya?ml$/.test(dir) ? dir : join(dir, CASE_FILE);
			let source;
			try {
				source = readFileSync(file, "utf8");
			} catch (error) {
				throw new Error(`读不到本子：${file}（${error instanceof Error ? error.message : String(error)}）`);
			}
			const loaded = loadCase(source);
			const issues = loaded.issues.map((issue) => ({
				level: issue.level,
				message: issue.message
			}));
			const action = args.action ?? "load";
			if (action === "load") return Promise.resolve({
				caseId: loaded.id,
				title: loaded.title,
				genre: loaded.genre,
				seats: loaded.roles.map((role) => ({
					id: role.id,
					name: role.name,
					player: role.player
				})),
				sections: Object.keys(loaded.sections),
				issues
			});
			if (action === "section") {
				const name = args.section;
				if (name === void 0) throw new Error("section 要给段名。");
				const value = loaded.sections[name];
				if (value === void 0) throw new Error(`这本里没有 "${name}" 这一段。有这些：${Object.keys(loaded.sections).join("、")}`);
				if (sealed() && !openBeforeReveal(name)) throw new Error(`"${name}" 取不到。${sealNote(name)}`);
				const text = typeof value === "string" ? value : JSON.stringify(value, null, 2);
				return Promise.resolve({
					caseId: loaded.id,
					text,
					issues
				});
			}
			if (action === "clue") {
				const raw = loaded.sections["clues"];
				if (!Array.isArray(raw) || raw.length === 0) throw new Error(`这本（${loaded.genre}）没有搜证段——它不是靠线索推进的。带局要看的是 briefing 段。`);
				const { clues, missing } = tableClues(loaded, args.clues ?? []);
				const text = clues.map((clue) => `【线索 ${clue.id}${clue.title === "" ? "" : ` · ${clue.title}`}】\n${clue.text}`).join("\n\n");
				return Promise.resolve({
					caseId: loaded.id,
					text,
					missing,
					issues
				});
			}
			const seat = args.role;
			if (seat === void 0) throw new Error("book 要给座位 id。");
			const role = loaded.roles.find((candidate) => candidate.id === seat);
			if (role === void 0) throw new Error(`这本里没有座位 "${seat}"。有这些：${loaded.roles.map((item) => item.id).join("、")}`);
			const full = roleBook(role);
			if (sealed()) {
				const ref = bookRef(loaded.id, seat);
				sealedBooks.set(ref, full);
				return Promise.resolve({
					caseId: loaded.id,
					text: bookPreview(role),
					ref,
					sealed: true,
					issues
				});
			}
			return Promise.resolve({
				caseId: loaded.id,
				text: full,
				issues
			});
		}
	}));
	ctx.tools.register(defineTool({
		name: ACTOR_TOOL,
		description: describeActorTool(),
		parameters: {
			action: {
				type: "string",
				enum: [
					"list",
					"add",
					"draft",
					"style",
					"avatar",
					"note",
					"show"
				],
				description: "list = 池子里都有谁（默认）；add = 招一个演员进来；draft = 取一份「怎么写性格」的骨架（给用户看，不落库）；style = 改他怎么玩；avatar = 给他换张头像图；note = 记一条跨局印象；show = 看某一个人的档案。"
			},
			actor: {
				type: "string",
				description: "note / show / draft / style / avatar 用：演员 id。add 用：新演员的 id（小写字母开头，只用小写字母、数字、下划线——它同时是存储里的记录键，也是头像生成用的种子）。"
			},
			name: {
				type: "string",
				description: "add 用：人看的名字，比如「老周」。"
			},
			style: {
				type: "string",
				description: "add / style 用：这个人怎么玩游戏——不是他这一次演的角色是什么样。先 action=\"draft\" 看看该往哪儿写。"
			},
			image: {
				type: "string",
				description: "avatar 用：头像图片的路径；传空串表示换回按 id 生成的那个。"
			},
			note: {
				type: "string",
				description: "note 用：这一局结束后他该带走的事，一两句话。"
			}
		},
		output: {
			schema: {
				type: "object",
				additionalProperties: false,
				properties: {
					actors: {
						type: "array",
						items: {
							type: "object",
							additionalProperties: false,
							properties: {
								id: { type: "string" },
								name: { type: "string" },
								style: { type: "string" },
								notes: {
									type: "array",
									items: { type: "string" }
								},
								avatar: { type: "string" }
							}
						}
					},
					text: { type: "string" }
				}
			},
			render: (args, value) => {
				if ((args.action ?? "list") === "draft") return [{
					type: "text",
					text: value.text ?? ""
				}];
				const list = value.actors ?? [];
				if (list.length === 0) return [{
					type: "text",
					text: "演员池是空的——用 action=\"add\" 招一个进来。"
				}];
				if ((args.action ?? "list") === "list") return [{
					type: "text",
					text: list.map((actor) => `${actor.id}  ${actor.name ?? ""}｜印象 ${(actor.notes ?? []).length} 条`).join("\n")
				}];
				const actor = list[0];
				const notes = actor.notes ?? [];
				const lines = [`${actor.name ?? actor.id}（${actor.id}）`, actor.style ?? ""];
				lines.push(actor.avatar === void 0 || actor.avatar === "" ? "头像：按 id 生成的那个" : `头像：${actor.avatar}`);
				lines.push(notes.length === 0 ? "印象：还没有——一局结束后用 action=\"note\" 记一条。" : `印象：\n${notes.map((one) => `  · ${one}`).join("\n")}`);
				return [{
					type: "text",
					text: lines.join("\n")
				}];
			}
		},
		async execute(args) {
			const pool = await requireActors(ctx);
			switch (args.action ?? "list") {
				case "add": {
					const { actor, name, style } = args;
					if (actor === void 0 || name === void 0 || style === void 0) throw new Error("add 需要 actor（id）/ name / style 三项都给。");
					return { actors: [toActorOut(await pool.add({
						id: actor,
						name,
						style
					}))] };
				}
				case "draft": {
					const { actor } = args;
					const existing = actor === void 0 ? void 0 : await pool.get(actor);
					if (actor !== void 0 && existing === void 0) throw new Error(`演员池里没有 "${actor}"——先 action="list" 看看都有谁。`);
					const known = existing === void 0 || existing.notes.length === 0 ? "（这个演员还没有印象——这是他的第一条性格，随你写。）" : `已有的印象（新写的性格要与它相容，别打架）：\n${existing.notes.map((one) => `  · ${one}`).join("\n")}`;
					return { text: `${STYLE_GUIDE}\n\n${known}\n\n写完先给用户过目，再调 action="add"（新演员）或 action="style"（改现有的）。
**不要自己直接落库**——它落进去就是跨局的，这个演员以后每一局都这么玩。` };
				}
				case "style": {
					const { actor, style } = args;
					if (actor === void 0 || style === void 0) throw new Error("style 需要 actor 与 style 两项都给。");
					return { actors: [toActorOut(await pool.setStyle(actor, style))] };
				}
				case "avatar": {
					const { actor, image } = args;
					if (actor === void 0 || image === void 0) throw new Error("avatar 需要 actor 与 image 两项都给——image 传空串表示换回生成的那个。");
					return { actors: [toActorOut(await pool.setAvatar(actor, image))] };
				}
				case "note": {
					const { actor, note } = args;
					if (actor === void 0 || note === void 0) throw new Error("note 需要 actor 与 note 两项都给。");
					return { actors: [toActorOut(await pool.note(actor, note))] };
				}
				case "show": {
					const { actor } = args;
					if (actor === void 0) throw new Error("show 需要 actor。");
					const found = await pool.get(actor);
					if (found === void 0) throw new Error(`演员池里没有 "${actor}"——先 action="list" 看看都有谁。`);
					return { actors: [toActorOut(found)] };
				}
				default: return { actors: (await pool.list()).map(toActorOut) };
			}
		}
	}));
	ctx.tools.register(defineTool({
		name: PLAYER_TOOL,
		description: describePlayerTool(),
		parameters: {
			action: {
				type: "string",
				enum: [
					"list",
					"spawn",
					"say",
					"relay",
					"unseat"
				],
				description: "list = 看桌上都有谁（默认）；spawn = 让一位 AI 玩家上桌；say = 把一句话说给某位玩家或全桌；relay = 把某位玩家刚说的话转达给桌上其余人；unseat = 从座位上撤掉这位玩家。"
			},
			seat: {
				type: "string",
				description: "spawn / say / relay / unseat 用：座位 id，要与局面里的 seats 用同一套命名。say 也可以用 \"*\" 表示说给全桌听。"
			},
			name: {
				type: "string",
				description: "spawn 用：角色名。"
			},
			roleBook: {
				type: "string",
				description: "spawn 用：这个角色的角色本。复盘前 jubensha_case action=\"book\" 给的是一个引用，把它（单独那一串）填进来即可——程序自己解开，正文不经过你的上下文；复盘后也可以直接给全文。只发给这一个玩家，绝不转述、绝不换座位。"
			},
			message: {
				type: "string",
				description: "say 用：要对这位玩家说的话——提问、转述，或阶段提示。"
			},
			actor: {
				type: "string",
				description: "spawn 用：由池子里的哪个演员来演这一局（jubensha_actor 的 id）。不填就是个新面孔——那样他不会记得这一局，下一局也没人记得他。"
			}
		},
		output: {
			schema: {
				type: "object",
				additionalProperties: false,
				properties: {
					players: {
						type: "array",
						items: {
							type: "object",
							additionalProperties: false,
							properties: {
								seat: { type: "string" },
								name: { type: "string" }
							}
						}
					},
					delivered: { type: "string" }
				}
			},
			render: (_args, value) => [{
				type: "text",
				text: JSON.stringify(value, null, 2)
			}]
		},
		async execute(args, exec) {
			let delivered;
			switch (args.action ?? "list") {
				case "spawn": {
					const { seat, roleBook } = args;
					const playerName = args.name;
					if (seat === void 0 || playerName === void 0 || roleBook === void 0) throw new Error("spawn 需要 seat / name / roleBook 三项都给。");
					const book = resolveBook(roleBook, seat);
					const actorId = args.actor;
					const actor = actorId === void 0 ? void 0 : await requireActors(ctx).then((pool) => pool.get(actorId));
					if (actorId !== void 0 && actor === void 0) throw new Error(`演员池里没有 "${actorId}"——先 ${ACTOR_TOOL} action="list" 看看都有谁，或者用 action="add" 招一个进来。`);
					const sitting = players.get(seat);
					if (sitting !== void 0) throw new Error(`座位 "${seat}" 上已经有人了（${sitting.name}）；先 unseat 再 spawn。`);
					const dm = exec.agent;
					if (dm === void 0) throw new Error(`${PLAYER_TOOL} 需要一个调用它的 agent。`);
					const teams = ctx.get("agentTeams");
					if (teams === void 0) throw new Error(`这个部署里没有 agent-team 服务，${PLAYER_TOOL} 用不了——需要 @deepseek-ai/dsh-experimental-agent-team 与 agent-team-profile。`);
					awaiting.set(dm.id, {
						seat,
						name: playerName
					});
					try {
						const spawned = await teams.spawnTeammate(dm, {
							name: teammateName(seat),
							description: `玩家 ${playerName}（${seat}）`,
							prompt: [{
								type: "text",
								text: playerBrief({
									seat,
									name: playerName,
									roleBook: book,
									...actor === void 0 ? {} : { actor: {
										name: actor.name,
										style: actor.style,
										notes: actor.notes.slice(0, NOTES_IN_BRIEF)
									} }
								})
							}],
							context: "fresh",
							provider: "spawn",
							signal: exec.signal
						});
						confineMember(ctx, spawned.member, seat);
						players.seat({
							seat,
							name: playerName,
							childId: spawned.member.id,
							dmId: dm.id
						});
					} finally {
						awaiting.delete(dm.id);
					}
					break;
				}
				case "say": {
					const { seat, message } = args;
					if (seat === void 0 || message === void 0) throw new Error("say 需要 seat 与 message 两项都给。");
					const dm = exec.agent;
					if (dm === void 0) throw new Error(`${PLAYER_TOOL} 需要一个调用它的 agent。`);
					const listeners = seat === "*" ? players.list() : [requirePlayer(seat)];
					if (listeners.length === 0) throw new Error("桌上还没有 AI 玩家。");
					await deliver(ctx, dm, listeners, message, exec.signal);
					delivered = listeners.map((listener) => listener.name).join("、");
					break;
				}
				case "relay": {
					const { seat } = args;
					if (seat === void 0) throw new Error("relay 需要 seat——要转达哪一位玩家刚说的话。");
					const speaker = requirePlayer(seat);
					const said = players.lastSaid(seat);
					if (said === void 0) throw new Error(`${speaker.name} 还没开过口——没有可转达的话。`);
					const dm = exec.agent;
					if (dm === void 0) throw new Error(`${PLAYER_TOOL} 需要一个调用它的 agent。`);
					const others = players.list().filter((player) => player.seat !== seat);
					if (others.length === 0) throw new Error(`桌上只有 ${speaker.name} 一个人，没有人可转达。`);
					await deliver(ctx, dm, others, `（${speaker.name}）${said}`, exec.signal);
					delivered = others.map((other) => other.name).join("、");
					break;
				}
				case "unseat": {
					const { seat } = args;
					if (seat === void 0) throw new Error("unseat 需要 seat。");
					if (!players.unseat(seat)) throw new Error(`座位 "${seat}" 上本来就没有人（${tableText()}）。`);
					break;
				}
			}
			return {
				players: players.list().map((player) => ({
					seat: player.seat,
					name: player.name
				})),
				...delivered !== void 0 ? { delivered } : {}
			};
		}
	}));
}
//#endregion
export { apply, inject, name };
