/**
 * What a five IS, read off the champions it drafts — and what that does to
 * the sliders and to the opponent.
 *
 * In the shooter this engine came from, a five's shape was which jobs it
 * doubled up on. Here a five is always one of each position, and its shape is
 * WHEN it wants to win the game:
 *
 *   前期滚雪球  strong in lane and in the first fights, thin once the map opens
 *              up — it has to be ahead at fifteen, and it has to end the game
 *   正面团战    built to group and fight over objectives; even early and late,
 *              best in the middle of the game
 *   运营后期    gives up the early game to scale, side-lane and out-rotate
 *   均衡        leans nowhere in particular; no shape to play into or against
 *
 * Which of these a draft is comes from the champions themselves, and what a
 * champion leans towards is measured, not authored: how much longer its wins
 * run than its losses and how far ahead it is at fifteen (`lean`), and how
 * much of its team's fighting it takes part in (`fight`) — twelve years of
 * professional games, scripts/lol/build_champions.py.
 *
 * The engine reads the shape and scales the dials by it: 节奏 and 侵略性 pay
 * roughly double on a snowball draft and cost double on a scaling one, 视野 is
 * what a team-fighting draft is built on. And the OPPONENT's shape decides
 * what your dials run into.
 *
 * Nothing here is a number the manager cannot act on: every term is a slider,
 * a champion pick, or the opponent's sheet.
 */
import { championOf } from './content'
import type { GameState, Tactics } from './types'

/** internal keys kept from the engine's origin: rush = 前期, control = 团战, hold = 运营 */
export type CompStyle = 'rush' | 'hold' | 'control' | 'standard'

/** The draft's shape: whichever corner of the triangle it leans into, if it leans at all. */
export function compStyle(agents: Iterable<string>): CompStyle {
  const m = styleMix(agents)
  if (Math.max(...m) - Math.min(...m) < STYLE_LEAN_MIN) return 'standard'
  return (['rush', 'control', 'hold'] as const)[m.indexOf(Math.max(...m))]
}

export const COMP_STYLE_CN: Record<CompStyle, {
  label: string
  blurb: string
  /** how to set the dials when this is OUR shape */
  advice: string
  /** how to set the dials when this is THEIR shape */
  counter: string
}> = {
  rush: {
    label: '前期滚雪球',
    blurb: '对线和前几波小团强，地图打开之后变薄：十五分钟必须领先，而且要尽快结束。',
    advice: '节奏和侵略性往右拉，拉在左边等于白选一套前期阵容。',
    counter: '侵略性别拉高，前期和他们硬碰是送；中局应变拉高，拖过他们的强势期。',
  },
  hold: {
    label: '运营后期',
    blurb: '前期让资源换发育，靠分带和转线拉扯，越往后越强。',
    advice: '节奏和侵略性往左拉，拉快了就是拿一套后期阵容去打前期。',
    counter: '节奏拉快，别等他们发育起来；视野拉高，抓他们分带的人。',
  },
  control: {
    label: '正面团战',
    blurb: '抱团围绕小龙和大龙打正面，前后期都不差，中期最强。',
    advice: '视野拉高，节奏和侵略性放中间。',
    counter: '视野拉高，节奏别太慢，别在他们选好的地方接团。',
  },
  standard: {
    label: '均衡',
    blurb: '哪个时间段都能打，没有特别强的时候，也没有特别怕的对手。',
    advice: '滑杆按对手来调：对运营阵容加快节奏，对前期阵容别把侵略性拉满。',
    counter: '没有特别要针对的，按自己阵容的打法来。',
  },
}

/**
 * How much each dial is worth, per style. 1 = the plain rate.
 *
 * Measured on equal clubs, 1500 maps a setting: at 1.9 the gap between
 * sliders set with the shape and against it was 18 points of map win rate
 * for 双决斗 and 20 for 双控场, which turns the dial into the match. At these
 * values it is about ten — the same order as map comfort, which is where a
 * decision the manager makes every match should sit.
 */
const DIAL: Record<CompStyle, { paceAtk: number; paceDef: number; aggAtk: number; aggDef: number; util: number }> = {
  rush:     { paceAtk: 1.35, paceDef: 0.8, aggAtk: 1.35, aggDef: 0.8, util: 0.9 },
  // the plain rates lean attack (0.035 v 0.022), so a defensive shape needs
  // more weight on its defence side than a tempo shape needs on attack, or
  // sliding left on two sentinels nets out to nothing
  hold:     { paceAtk: 0.5, paceDef: 2.2, aggAtk: 0.5, aggDef: 2.2, util: 1.0 },
  control:  { paceAtk: 1.0, paceDef: 1.0, aggAtk: 1.0, aggDef: 1.0, util: 1.2 },
  standard: { paceAtk: 1.0, paceDef: 1.0, aggAtk: 1.0, aggDef: 1.0, util: 1.0 },
}

/** The shape's own worth before any dial is touched. */
const BASE: Record<CompStyle, { atk: number; def: number; mid: number }> = {
  rush:     { atk: 1.3, def: -0.9, mid: 0 },
  hold:     { atk: -0.8, def: 1.4, mid: 0 },
  control:  { atk: 0.5, def: 0.5, mid: 0.9 },
  standard: { atk: 0, def: 0, mid: 0 },
}

export interface TacticEdge {
  /** the shape itself, before dials */
  styleAtk: number
  styleDef: number
  styleMid: number
  /** 节奏 + 侵略性, scaled by the shape */
  tacticsAtk: number
  tacticsDef: number
  /** 道具, scaled by the shape and by how good the five is at it */
  utility: number
  /** what our dials do against THEIR shape */
  matchupAtk: number
  matchupDef: number
  matchupMid: number
}

/**
 * Everything the sliders and the two shapes are worth on this map.
 *
 * `avgUtility` is the five's mean 道具 attribute — a full utility budget in
 * the hands of people who cannot use it is smoke on the wrong side.
 */
/**
 * What a dial is worth was set against a round curve of 17 strength points
 * per step; the curve is 30 now (ROUND_SENS in match.ts — a rating gap
 * decides a map less completely), and the same edge in points moves a round
 * by that much less. The dials are scaled back up so that what the sliders
 * are worth in map points did not quietly halve with it: 顺着打 against
 * 逆着打 on the same five had fallen from over six map points to three or
 * four, which is the bar check_tactics holds. Only the dials — the shape's
 * own worth and the matchups at neutral dials stay as they were, so an AI
 * club, whose dials are always neutral, plays exactly as before.
 */
export const DIAL_SCALE = 30 / 17

export function tacticEdge(
  t: Tactics, style: CompStyle, oppStyle: CompStyle, avgUtility: number,
): TacticEdge {
  const d = DIAL[style]
  const b = BASE[style]
  const pace = (t.pace - 50) * DIAL_SCALE
  const agg = (t.aggression - 50) * DIAL_SCALE
  const util = (t.utility - 50) * DIAL_SCALE

  const tacticsAtk = pace * 0.035 * d.paceAtk + agg * 0.028 * d.aggAtk
  const tacticsDef = -pace * 0.022 * d.paceDef - agg * 0.015 * d.aggDef
  const utility = util * 0.02 * d.util * (0.5 + avgUtility / 130)

  // Their shape decides what ours runs into. Each of these is about one map
  // comfort point at the extreme — enough that the right dial against the
  // right opponent is worth a week of 跑图, not enough to beat a better five.
  let matchupAtk = 0
  let matchupDef = 0
  let matchupMid = 0
  switch (oppStyle) {
    case 'hold':
      // running fast into setups is how you lose the pistol
      matchupAtk = -pace * 0.03 + util * 0.015
      break
    case 'rush':
      // an aggressive defence against two duelists gets run over; a reader
      // of the game gets the trades back
      matchupDef = -agg * 0.03
      matchupMid = (t.adaptability - 50) * DIAL_SCALE * 0.02
      break
    case 'control':
      // a smoke war: the side with more utility, and the side that does not
      // wait for the smokes to bloom
      matchupAtk = util * 0.02 + pace * 0.015
      matchupDef = util * 0.01
      break
    default:
      break
  }
  return {
    styleAtk: b.atk, styleDef: b.def, styleMid: b.mid,
    tacticsAtk, tacticsDef, utility,
    matchupAtk, matchupDef, matchupMid,
  }
}

/**
 * A timeout call lands harder on the five built for it.
 *
 * 强攻 on a double-duelist five is the comp doing what it is for; on a
 * double-sentinel five it is two people who cannot rush being told to. The
 * multiplier is the same in both directions, so the manager who picked the
 * shape and then calls against it feels it.
 */
export function callBoost(kind: 'rush' | 'steady', style: CompStyle): number {
  if (kind === 'rush') return style === 'rush' ? 1.4 : style === 'hold' ? 0.7 : 1
  return style === 'hold' ? 1.4 : style === 'rush' ? 0.7 : 1
}

// ---------------------------------------------------------------- familiarity

/**
 * How well the club knows the five agents it is taking onto a map.
 *
 * Map comfort says how well the squad knows Ascent; this says how well they
 * know THIS Ascent — the five characters and the executes that go with them.
 * It grows every time the same sheet is played on the map, in a scrim, a
 * fixture or a week of 跑图, and it is lost in proportion when the sheet
 * changes: swap one agent and four fifths carries over, rebuild the five and
 * you start from nothing.
 *
 * Only the managed club is tracked. Every other club runs its map default
 * every week, which is what a practised comp is, so they sit at the neutral
 * point: a fresh comp of ours is behind them, a drilled one is ahead.
 */
export const FAM_BASE = 50
export const FAM_MAX = 100

/** What one settled week of 跑图, one fixture map and one scrim map teach. */
export const FAM_DRILL = 12
export const FAM_MATCH = 8
export const FAM_SCRIM = 6

/**
 * What the club's practice is banked under: the KIND of draft, not the five
 * champions in it. In a game with a ban phase no two games are played on the
 * same five, so knowing "this exact sheet" would be a number that resets
 * every game. What a squad really learns is how to play a snowball draft, or
 * a scaling one — and that carries from one set of champions to the next.
 */
export const compKey = (agents: Record<string, string>): string => compStyle(Object.values(agents))

export function familiarity(
  state: GameState, teamId: string, _map: string, agents: Record<string, string>,
): number {
  if (teamId !== state.myTeam) return FAM_BASE
  return state.compPro?.[compKey(agents)]?.value ?? FAM_BASE
}

/** The strength a familiarity value is worth, either way from neutral. */
export const famBonus = (fam: number): number => (fam - FAM_BASE) * 0.06

/** Bank practice on a sheet. Returns the value after, for the digest. */
export function learnComp(
  state: GameState, map: string, agents: Record<string, string>, amount: number,
): number {
  const key = compKey(agents)
  const from = familiarity(state, state.myTeam, map, agents)
  const value = Math.min(FAM_MAX, from + amount)
  state.compPro = { ...(state.compPro ?? {}), [key]: { key, value } }
  return value
}

// ============================================================ 打法三角

/**
 * 阵容在三角上的位置，和三个角之间的克制。
 *
 *   前期  对线压制、入侵、小规模冲突，趁对面没发育起来打死
 *   团战  抱团围绕资源打正面
 *   运营  让前期换发育，分带、转线，不接正面
 *
 * 前期克运营（在他们发育起来之前结束），团战克前期（抱团打得过小规模冲突），
 * 运营克团战（拉扯着不接团，把他们的阵容优势耗掉）。
 *
 * 归一化常数由 scripts/check_comp.ts 对抽样的合法五人阵容标定。
 */
export type StyleAxis = 0 | 1 | 2
export const STYLE_CN = ['前期', '团战', '运营'] as const
export type StyleMix = [number, number, number]

/** a draft leans somewhere only when its strongest corner clears its weakest by this much */
export const STYLE_LEAN_MIN = 0.11

/**
 * 每个英雄在三角上的点数，总分 3，由数据换算（content.ts 的 lean / fight）。
 *
 * (lean, fight) 是平面上的一个点：lean −1 纯前期 … +1 纯后期，fight 是参团率相对同位置
 * 的偏移。三个角在这个平面上相隔 120°：
 *
 *   团战  参团率高，不管早晚
 *   前期  参团率低、偏前期——抓单、入侵、单线压制
 *   运营  参团率低、偏后期——分带、发育、拉扯
 *
 * 对称地投影，所以三个角谁也不占便宜（上一版把前期 / 后期当成一条轴的两端，
 * 总有一端大于 1，团战只有 fight 为正时才加分，结果六百套阵容里只有八套读成团战）。
 * 两个量都先除以各自的离散度（按选禁率加权约 0.4），lean 再减掉全体英雄的均值。
 * 一个哪边都不靠的英雄是 [1, 1, 1]。
 */
const STYLE_SPREAD = 0.4
const LEAN_MEAN = -0.09
const STYLE_GAIN = 0.62
const SIN60 = Math.sqrt(3) / 2

export function agentStyle(agent: string): StyleMix | undefined {
  const c = championOf(agent)
  if (!c) return undefined
  const x = (c.lean - LEAN_MEAN) / STYLE_SPREAD
  const y = c.fight / STYLE_SPREAD
  const raw: StyleMix = [
    Math.max(0, 1 + STYLE_GAIN * (-SIN60 * x - 0.5 * y)),
    Math.max(0, 1 + STYLE_GAIN * y),
    Math.max(0, 1 + STYLE_GAIN * (SIN60 * x - 0.5 * y)),
  ]
  const t = raw[0] + raw[1] + raw[2]
  return t ? [(3 * raw[0]) / t, (3 * raw[1]) / t, (3 * raw[2]) / t] : [1, 1, 1]
}

/**
 * 只有一张图，图对打法没有偏好：契合度这一项恒为零。保留这张表是因为读它的代码
 * 还在；版本和克制两项才是这个游戏里阵容的意义。
 */
export const MAP_WANT: Record<string, StyleMix> = {}

const CENTRE: StyleMix = [1 / 3, 1 / 3, 1 / 3]

/** 五个人的点数加总归一化，得到阵容在三角上的坐标。 */
export function styleMix(agents: Iterable<string>): StyleMix {
  const s: StyleMix = [0, 0, 0]
  for (const a of agents) {
    const v = agentStyle(a)
    if (!v) continue
    s[0] += v[0]; s[1] += v[1]; s[2] += v[2]
  }
  const t = s[0] + s[1] + s[2]
  return t ? [s[0] / t, s[1] / t, s[2] / t] : CENTRE
}

/** 0 = 三边平衡（万金油），1 = 押死一个角。 */
export const stylePurity = (m: StyleMix): number => (Math.max(...m) - 1 / 3) / (2 / 3)

/** 主轴。三边差不到五个点就是没有主轴，不能随便挑一个。 */
export const styleName = (m: StyleMix): string =>
  Math.max(...m) - Math.min(...m) < 0.05 ? '均衡' : STYLE_CN[m.indexOf(Math.max(...m)) as StyleAxis]

/**
 * 克制项，双线性型。反对称，所以镜像自动归零、两边都平衡也自动归零——指南说
 * 亚海默认阵容「永远不被克也吃不到红利」，这个式子直接就是那句话。
 */
const RPS = [[0, -1, 1], [1, 0, -1], [-1, 1, 0]]
export function styleCounter(u: StyleMix, v: StyleMix): number {
  let e = 0
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) e += u[i] * RPS[i][j] * v[j]
  return e
}

/**
 * 阵容跟这张图的契合度，用点积而不是距离。
 *
 * 用 L1 距离的那一版让万金油阵容在十三张图上全部排第一——单纯形的质心离谁都
 * 近，那是距离的性质不是设计。点积奖励的是「往这张图要的方向压」。
 */
export const styleAlign = (m: StyleMix, map: string): number => {
  const d = MAP_WANT[map] ?? CENTRE
  return m[0] * d[0] + m[1] * d[1] + m[2] * d[2]
}

/**
 * 归一化用的常数，由 scripts/style_dynamics.ts 对八千套合法五人阵容抽样得出。
 * 契合度用全局尺度而不是按图各自拉满：需求越平的图（亚海 36/31/33），阵容
 * 选择就越不重要，这是这张表该有的性质。
 */
const ALIGN_MID = 1 / 3
const ALIGN_SPAN = 0.075
// the 95th percentile of |克制| over sampled legal drafts (scripts/lol_comp_probe.ts)
const COUNTER_HALF = 0.075
const clamp1 = (x: number) => Math.max(-1, Math.min(1, x))

export const alignN = (m: StyleMix, map: string): number =>
  clamp1((2 * (styleAlign(m, map) - ALIGN_MID)) / ALIGN_SPAN)
export const counterN = (u: StyleMix, v: StyleMix): number =>
  clamp1(styleCounter(u, v) / COUNTER_HALF)

/**
 * 三项各值多少回合强度点。
 *
 * 教练给的优先级是 版本之子 > 阵容合适 > 阵容强，所以三项的极差按这个顺序
 * 递减：全员版本之子打全员逆版本 64%、这张图最合适打最不合适 60%、克制方打
 * 被克方 57%（一张图的胜率）。参照物是 comp.ts 的滑杆——顺着打对逆着打约十个
 * 地图胜率点，跟地图熟悉度同量级。
 *
 * 克制项定得最小是有依据的：指南里 FNATIC 靠它打赢了当时所有主流阵容，但它
 * 没救下对 LOUD 那场。它是加成，不是胜负手。
 */
export const STYLE_K = { version: 2.05, map: 1.45, counter: 1.01 }

// ---------------------------------------------------------------- 版本

/**
 * 一个版本。
 *
 * 教练给的节奏：一年一次大型更新（系统性，休赛期），中间以国际赛为分界线做
 * 中小型更新。所以这里的「换版本」挂在赛事结束上，不挂在日期上。
 *
 * `coef` 是每个英雄的版本系数，−1 到 +1。它不改英雄的三角坐标——改的是他现在
 * 值不值得上。版本之子定义为 +0.8，五个人全是版本之子就把归一化项打满。
 */
export interface Patch {
  /** 生效那天 */
  since: number
  name: string
  /** 生效那年（老存档没有：按当前年份读） */
  year?: number
  /** 唯一标识，`年-赛段-天`，两次「赛中调整」靠它分开 */
  id?: string
  /** 从哪个阶段起影响比赛——刚打完的那个赛事用的还是上一版 */
  after?: string
  /** 英雄 → 版本系数 [-1, 1]，没有的就是 0 */
  coef: Record<string, number>
  /** 加强了谁、削弱了谁，给收件箱用 */
  buffed: string[]
  nerfed: string[]
  big: boolean
}

/** 版本之子的门槛。也是归一化的分母：五个人全是版本之子刚好打满。 */
export const DARLING = 0.8

/** 一套五人相对这个版本站在哪。−1 全逆版本，+1 全版本之子。 */
export function versionN(agents: Iterable<string>, patch: Patch | undefined): number {
  if (!patch) return 0
  let sum = 0, n = 0
  for (const a of agents) { sum += patch.coef[a] ?? 0; n++ }
  return n ? clamp1(sum / n / DARLING) : 0
}

/** 这个版本里最强势的几个英雄。 */
export const darlings = (patch: Patch | undefined, n = 3): string[] =>
  Object.entries(patch?.coef ?? {})
    .filter(([, v]) => v >= DARLING * 0.55)
    .sort((a, b) => b[1] - a[1]).slice(0, n).map(([a]) => a)

/**
 * 滚一个新版本。
 *
 * 旧系数先往回衰减——没有英雄永远是版本之子，这也是逆版本会自己解除的原因。
 * 大改动的英雄多、幅度大；国际赛之间的小改只动三四个。
 *
 * `pick` 传的是当前可选的英雄池，所以还没进游戏的英雄不会被改动。
 */
export function rollPatch(
  prev: Patch | undefined, pool: readonly string[], day: number, name: string,
  big: boolean, rng: { norm(m: number, sd: number): number; int(a: number, b: number): number },
): Patch {
  const coef: Record<string, number> = {}
  for (const [a, v] of Object.entries(prev?.coef ?? {})) {
    const decayed = v * (big ? 0.6 : 0.82)
    if (Math.abs(decayed) > 0.05) coef[a] = decayed
  }
  const buffed: string[] = []
  const nerfed: string[] = []
  const touched = new Set<string>()
  for (let i = 0; i < (big ? 9 : 3); i++) {
    const a = pool[rng.int(0, pool.length - 1)]
    if (!a || touched.has(a)) continue
    touched.add(a)
    const before = coef[a] ?? 0
    const after = clamp1(before + rng.norm(0, big ? 0.6 : 0.35))
    coef[a] = after
    if (after - before > 0.15) buffed.push(a)
    else if (before - after > 0.15) nerfed.push(a)
  }
  return { since: day, name, coef, buffed, nerfed, big }
}

/**
 * 打法风格给这场比赛的全部加成，我方视角的回合强度差。
 *
 * 三项都归一化到 [-1,1] 之后乘各自的系数，所以它们可以直接比大小，也就守得住
 * 「版本之子 > 阵容合适 > 阵容强」这个优先级。
 */
export function styleEdge(
  mine: Iterable<string>, theirs: Iterable<string>, map: string, patch: Patch | undefined,
): { total: number; version: number; map: number; counter: number; mix: StyleMix; foe: StyleMix } {
  const a = Array.from(mine)
  const b = Array.from(theirs)
  const u = styleMix(a)
  const v = styleMix(b)
  const version = STYLE_K.version * (versionN(a, patch) - versionN(b, patch))
  const mapFit = STYLE_K.map * (alignN(u, map) - alignN(v, map))
  const counter = 2 * STYLE_K.counter * counterN(u, v)
  return { total: version + mapFit + counter, version, map: mapFit, counter, mix: u, foe: v }
}
