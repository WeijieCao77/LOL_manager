import { Rng, clamp } from './rng'
import { MAPS, HIGHLIGHT_TEMPLATES as HL, mapCn } from './content'
import { realPool } from './eras'
import { agentMod, autoAgents, normalizeAgents } from './agents'
import { isArena } from './types'
import {
  DIAL_SCALE, callBoost, compStyle, famBonus, familiarity, styleEdge, styleName, stylePurity, tacticEdge,
} from './comp'
import { ROLES } from './types'
import type { StyleMix } from './comp'
import type { CompStyle } from './comp'
import { callerOf, coachOr } from './roster'
import { NEUTRAL, squadHarmony } from './bonds'
import { isCoolingOff } from './clock'
import { analystEdge } from './staff'
import { skillMod } from './manager'
import type {
  EdgeBreakdown, GameState, MapLine, MapScore, MatchResult, Player, Role, RoundLog, StageKey, Team,
} from './types'

/**
 * How differently a side can turn up from one map to the next.
 *
 * Rounds were independent draws around a fixed strength, and twenty-four
 * independent draws hide nothing: the higher-rated side won 77% of series
 * against a club 3-5 rating points below it, 86% against one 6-9 below,
 * and a club that assembled a strong five never lost again — 「一旦组成一个
 * 强队就根本没有输的可能性」. Two dials moved. Each side's strength on a map
 * carries a draw of this spread for the whole map, so a weaker side's good
 * day is a whole map rather than a round; and the round curve (ROUND_SENS
 * below) is flatter, so a strength gap decides a map less completely. Just
 * widening the swing made maps lopsided — 46% of them 13-5 or worse — which
 * is why most of the change is in the curve: 3-5 below now wins 30% of
 * series, 6-9 below 20%, and one map in four is a 13-5, as in the real
 * thing. Measured with scratch scripts over three seasons; the smoke test
 * still holds the K/D calibration.
 */
/** the strength gap, in rating points, that moves a round from 50% to 73% */

/** How much each role tends to take kills / take deaths. */
// 决斗者 was 1.15 while every real duelist in a fifth slot sat on a default
// initiator with the off-role penalty; with real agent pools he plays his own
// agent at full strength, and 1.15 put the season's top K/D at 1.62 against
// a real ceiling near 1.5. 1.08 lands it back there — see scripts/smoke.ts.
/** how the five share 运营: the most of it counts for most (see buildLineup) */
const MACRO_SHARE = [0.4, 0.25, 0.15, 0.1, 0.1]
/** strength points, in the second half of the game only, per point of team 运营 above 62 */
const MACRO_LATE = 0.3

const KILL_WEIGHT: Record<Role, number> = {
  下路: 1.2, 中单: 1.12, 上单: 0.98, 打野: 0.95, 辅助: 0.62,
}
// and an entry player dies for it: 1.28, from 1.25, for the same reason
const DEATH_WEIGHT: Record<Role, number> = {
  辅助: 1.18, 打野: 1.08, 上单: 1.05, 中单: 0.92, 下路: 0.88,
}

export interface Lineup {
  team: Team
  players: Player[]
  /** who played which agent on this map, keyed by player id */
  agents: Record<string, string>
  /** the shape those agents make — see engine/comp.ts */
  style: CompStyle
  /** 打法风格三角上的坐标：快攻 / 消耗 / 控制，见 engine/comp.ts */
  mix: StyleMix
  /** 主轴的名字，暂停面板直接显示 */
  mixName: string
  /** 押注得多深：0 是万金油，1 是押死一个角 */
  purity: number
  atk: number
  def: number
  chem: number
  /** mid-round adaptation, drives comeback / clutch behaviour */
  midRound: number
  /** why this side is as strong as it is, kept for the post-match report */
  edge: EdgeBreakdown
}

/**
 * A player's effective rating right now (form / morale / fatigue applied).
 *
 * `day` is optional so callers that only rank fit players can omit it. Pass it
 * and a man playing through an injury is priced accordingly: selectLineup will
 * field an injured player when a club has nobody else, and 52 of the world's
 * 78 clubs carry exactly five, so without this an injury cost two thirds of
 * the league absolutely nothing. At -0.22 a club with no bench loses more to
 * an injury (-3.45 rating) than a club that can bring a substitute on
 * (-2.98) — which is the whole point of carrying one.
 */
export function effectiveRating(p: Player, day?: number): number {
  const form = (p.form - 70) * 0.0028
  const morale = (p.morale - 70) * 0.0016
  const fatigue = -p.fatigue * 0.0016
  const hurt = day != null && p.injuredUntil > day ? -0.22 : 0
  return p.overall * (1 + form + morale + fatigue + hurt)
}

/**
 * The kill share a player's ability alone predicts.
 *
 * The gun carries most of it and the role a little (see allocateRound). Kept
 * as its own function because the season reads it back: form moves by how a
 * man's night compared with this, not with the team mean — the star out-frags
 * the mean every night because he is the star, and reading that as form would
 * count his ability twice, the exact thing FORM_BASE was introduced to stop.
 */
export const expectedShare = (p: Player): number =>
  (42 + (p.attrs.mechanics * 0.55 + p.attrs.teamfight * 0.3 + p.attrs.clutch * 0.15) * 0.78) * KILL_WEIGHT[p.role]

/**
 * How much of the scoreboard a player's day takes.
 *
 * Form used to be worth 4% of kill share across its whole range and morale
 * nothing at all, so a man at 45 morale fragged exactly like the same man at
 * 85 and the group read 状态 and 士气 as decoration. The ratio that already
 * scales his strength scales his share of the kills, squared: hot (form 90,
 * morale 90) is about +18% kills, cold (55/45) about −16%. Kills are shared
 * within the side, so the team's total is untouched — this is who gets them.
 */
export const stateFactor = (p: Player): number => {
  const r = effectiveRating(p) / Math.max(1, p.overall)
  return r * r
}

/** Pick the 5 who actually play: honour the chosen starters, fill gaps with the best fit. */
export function selectLineup(state: GameState, teamId: string): Player[] {
  const team = state.teams[teamId]
  const all = team.roster
    .map((id) => state.players[id])
    .filter((p): p is Player => !!p && p.injuredUntil <= state.day && !isCoolingOff(state, p))

  const chosen: Player[] = []
  for (const id of team.starters) {
    const p = all.find((x) => x.id === id)
    if (p && chosen.length < 5) chosen.push(p)
  }
  if (chosen.length < 5) {
    // Fill on merit, and let an injured man compete for the place. His rating
    // already carries the injury (−22%), so a star who can barely walk beats a
    // reserve who is 30 points worse, and a real backup beats him — which is
    // what carrying a bench is supposed to buy. Excluding the injured outright
    // forced a weak substitute on and made depth cost MORE than an injury.
    // a man sent to cool off is not in the pool either; the emergency pass
    // below still finds him if the club cannot otherwise field five
    const pool = team.roster
      .map((id) => state.players[id])
      .filter((p): p is Player => !!p && !chosen.includes(p) && !isCoolingOff(state, p))
    // Filled one at a time, and a man who plugs a job the five is missing is
    // worth more than his rating says — the same judgement compositionScore
    // makes about the finished lineup. Ranking on rating alone benched an
    // injured specialist for a fitter reserve of the wrong job and left the
    // side worse off, which made carrying a bench a liability.
    // Judged on the same scale the lineup itself is scored on. A composition
    // gap costs `atk` directly, while one man's rating reaches it through a
    // weighted mean — roughly a sixth of his number — so comparing the two raw
    // numbers made a 20-point rating gap look six times more important than a
    // missing role. It is not: the engine's own compositionScore says what the
    // hole is worth, so use it.
    const SLOT = 0.15
    while (chosen.length < 5 && pool.length) {
      const value = (p: Player) =>
        effectiveRating(p, state.day) * SLOT + compositionScore([...chosen, p])
      const best = pool.reduce((x, y) => (value(y) > value(x) ? y : x))
      chosen.push(best)
      pool.splice(pool.indexOf(best), 1)
    }
  }
  // a club with fewer than 5 fit players fields whoever is left, injured included
  if (chosen.length < 5) {
    const emergency = team.roster
      .map((id) => state.players[id])
      .filter((p): p is Player => !!p && !chosen.includes(p))
      .sort((a, b) => b.overall - a.overall)
    for (const p of emergency) {
      if (chosen.length >= 5) break
      chosen.push(p)
    }
  }
  return chosen
}

const CORE_ROLES: Role[] = ROLES
// a five is one of each position; a hole in it is somebody playing out of his seat
const GAP_COST: Record<string, number> = { 上单: 6, 打野: 7, 中单: 6, 下路: 7, 辅助: 6 }

/**
 * How well a five covers the map between them.
 *
 * The requirement is four roles — duelist, initiator, controller, sentinel —
 * and nothing else. 自由人 is not a fifth one: in the data it means vlr never
 * recorded a role for the player, and for the single hand-verified genuine
 * floater it sits alongside the real roles he plays. Counting it as covered
 * ground made a lineup score 1.2 better for carrying a floater than for any
 * other fifth man, so the game quietly asked for one that it never required.
 *
 * The old redundancy term charged a player for every role he could play, so a
 * duelist who also initiates scored worse than a second plain duelist —
 * versatility priced as a liability. With five players and four roles one
 * doubling is unavoidable anyway, so there is nothing there to charge for.
 */
function compositionScore(players: Player[]): number {
  const coreOf = (p: Player) => (p.roles ?? [p.role]).filter((r) => CORE_ROLES.includes(r))
  const have = new Set(players.flatMap(coreOf))
  const floaters = players.filter((p) => coreOf(p).length === 0).length

  let score = 0
  // a player with no fixed role plugs a hole: worse than a specialist there,
  // far better than leaving it open
  let spare = floaters
  for (const r of CORE_ROLES) {
    if (have.has(r)) continue
    if (spare > 0) {
      spare -= 1
      score -= GAP_COST[r] * 0.5
    } else {
      score -= GAP_COST[r]
    }
  }
  // covering a second role is option value across a veto, not a cost
  score += Math.min(players.filter((p) => coreOf(p).length > 1).length, 3) * 0.6
  // but a five where nobody has a defined job is a coordination problem
  if (floaters > 2) score -= (floaters - 2) * 1.5
  return score
}

/**
 * The agents a side takes onto a map, and the shape they make.
 *
 * Split out of buildLineup because the OTHER side's shape is an input to
 * ours: what your dials run into depends on whether they brought two
 * sentinels or two duelists. Cheap, and deterministic in the state.
 */
export function sheetFor(
  state: GameState, teamId: string, map: string, players = selectLineup(state, teamId),
): { agents: Record<string, string>; style: CompStyle } {
  const agents = normalizeAgents(
    state, teamId, players, map,
    // this match's sheet, then the club's remembered default for this map,
    // then the composition the map is usually played with
    (teamId === state.myTeam ? state.agentPicks?.[map] ?? state.mapAgents?.[map] : undefined)
    ?? autoAgents(state, teamId, players, map))
  return { agents, style: compStyle(Object.values(agents)) }
}

/** The dials a club plays a map on: its own for that map if set, else the general ones. */
export const tacticsFor = (state: GameState, teamId: string, map: string) =>
  (teamId === state.myTeam ? state.mapTactics?.[map] : undefined) ?? state.teams[teamId].tactics

export function buildLineup(
  state: GameState, teamId: string, map: string,
  /** who we are up against on this map, for the matchup term; absent = a neutral five */
  oppId?: string,
): Lineup {
  const team = state.teams[teamId]
  const players = selectLineup(state, teamId)
  // Who is on which agent. The manager's own picks for this map if he made
  // any; otherwise the map's usual composition, handed to whoever can play it.
  // Agents used to be decoration — this is where a pick starts to cost or pay.
  const { agents: picks, style } = sheetFor(state, teamId, map, players)
  const oppSheet = oppId && state.teams[oppId] ? sheetFor(state, oppId, map) : undefined
  const oppStyle: CompStyle = oppSheet?.style ?? 'standard'
  const cardStrength = isArena(state) ? state.cardMatchStrength?.[teamId] : undefined
  if (cardStrength !== undefined) {
    // Card scores already price roles, chemistry, coaching, levels and calling.
    // Keep the round/economy/map-form simulation, without career-only bonuses
    // silently changing the meaning of equal displayed scores.
    const atk = cardStrength, def = cardStrength + 1.6
    const mix: StyleMix = [1 / 3, 1 / 3, 1 / 3]
    return {
      team, players, agents: picks, style, atk, def, chem: 65, midRound: 0,
      edge: { base: cardStrength, igl: 0, chem: 0, coach: 0, comp: 0,
        map: 0, utility: 0, tacticsAtk: 0, tacticsDef: 1.6, atk, def },
      mix, mixName: styleName(mix), purity: stylePurity(mix),
    }
  }
  // 打法风格三角：版本之子 > 阵容合适 > 阵容克制，三项都是回合强度点。
  // 同样只做在经理模式里 —— 开瓦包的对战结构不动。
  const se = isArena(state)
    ? { total: 0, version: 0, map: 0, counter: 0, mix: [1 / 3, 1 / 3, 1 / 3] as StyleMix, foe: [1 / 3, 1 / 3, 1 / 3] as StyleMix }
    : styleEdge(Object.values(picks), Object.values(oppSheet?.agents ?? {}), map, state.patch)
  // 英雄熟练度只做在经理模式里：开瓦包的卡按槽位排，不该因为「这张卡没练过
  // 这个英雄」而变弱
  const effs = players.map((x) =>
    effectiveRating(x, state.day) * (isArena(state) ? 1 : agentMod(x, picks[x.id])))

  // the top performers carry slightly more than a flat mean
  const sorted = effs.slice().sort((a, b) => b - a)
  const weights = [1.24, 1.1, 1.0, 0.9, 0.76]
  let base = 0
  let wsum = 0
  sorted.forEach((v, i) => {
    const w = weights[i] ?? 0.8
    base += v * w
    wsum += w
  })
  base = wsum > 0 ? base / wsum : 55

  const avg = (k: keyof Player['attrs']) =>
    players.length ? players.reduce((s, p) => s + p.attrs[k], 0) / players.length : 55

  // A squad can carry several players who are IGLs by trade — buy another
  // club's caller and his flag comes with him. One voice calls the game: the
  // club's named main caller if he is on the server, else the best deputy
  // who is (callerOf). The others neither stack nor clash.
  // 运营 is carried by the five between them, not by one voice: the man with
  // the most of it counts for most (40%, then 25/15/10/10), and the captain
  // takes the top share whatever his number is — so who wears the armband is
  // a decision with a price. It is paid out after the lanes break up, which
  // is what it was measured as: winning more than the fifteen-minute state
  // predicts (docs/调研-选手数值与年龄曲线.md §3–4).
  const captain = callerOf(state, team.id, players)
  const macroOrder = players.slice().sort((x, y) =>
    Number(y.id === captain?.id) - Number(x.id === captain?.id) || y.attrs.macro - x.attrs.macro)
  const teamMacro = macroOrder.length
    ? macroOrder.reduce((sum, pl, i) => sum + pl.attrs.macro * (MACRO_SHARE[i] ?? 0.1), 0) /
      macroOrder.reduce((sum, _pl, i) => sum + (MACRO_SHARE[i] ?? 0.1), 0)
    : 55
  const iglBonus = (teamMacro - 62) * MACRO_LATE
  // attributes say how well they can play together; bonds say whether they are
  const rapport = squadHarmony(state, team.id)
  const chem = clamp((avg('teamwork') + avg('teamfight')) / 2 + (rapport - NEUTRAL) * 0.18, 20, 99)
  const chemBonus = (chem - 65) * 0.07
  // 战术: the manager's own read of the game, on top of the coach's
  const mine = team.id === state.myTeam
  const coachBonus = (coachOr(team, 'tactics') - 60) * 0.05 +
    (mine ? (skillMod(state.manager, 'tactics', 0.06) - 1) : 0) +
    // 对手研究: knowing what they run is worth about half a head coach
    (mine ? analystEdge(state, 'opponent') * 2.4 : 0)
  const comp = compositionScore(players)
  const mapPref = ((team.mapPrefs[map] ?? 50) - 50) * 0.07

  // The dials, read through the shape of the five and the shape of theirs —
  // see engine/comp.ts for why the same slider is worth different things to
  // a double-duelist five and a double-sentinel one.
  const t = tacticsFor(state, teamId, map)
  const te = tacticEdge(t, style, oppStyle, avg('awareness'))
  // 经济分析: better buys and better utility timing, all game
  const utilBonus = te.utility + (avg('awareness') - 65) * 0.05 +
    (mine ? analystEdge(state, 'economy') * 1.8 : 0)
  // how well the club knows these five agents on this map — a drilled sheet
  // plays above neutral, a sheet built last night plays below it
  const fam = familiarity(state, teamId, map, picks)
  const famEdge = famBonus(fam)
  const styleAtk = te.styleAtk + te.matchupAtk
  const styleDef = te.styleDef + te.matchupDef

  // Playing short-handed had no cost at all. Strength is a weighted mean of who
  // is on the server, so losing your weakest man RAISED it: a two-man side
  // rated 92.56 against its own full five's 93.74, and three rated above four.
  // A club that had been stripped to four kept winning, which is what a player
  // meant by "四个人也能打，而且还打赢了对面".
  //
  // Round odds run through 1/(1+e^(-diff/30)), so ~18 a head puts a four-man
  // side near 35% a round and a two-man side near 23% — losing 13-3, which
  // is what being two men down actually looks like.
  const missing = Math.max(0, 5 - players.length)
  const shortHanded = -missing * 18

  const common = base + chemBonus + coachBonus + comp + mapPref + utilBonus + shortHanded +
    famEdge + se.total
  const atk = common + te.tacticsAtk + styleAtk + (avg('laning') - 65) * 0.05
  const def = common + te.tacticsDef + styleDef + (avg('awareness') - 65) * 0.05 + iglBonus

  const midRound =
    (t.adaptability - 50) * DIAL_SCALE * 0.05 + (teamMacro - 60) * 0.06 + (avg('clutch') - 65) * 0.05 +
    te.styleMid + te.matchupMid

  const edge: EdgeBreakdown = {
    base, igl: iglBonus, chem: chemBonus, coach: coachBonus, comp, shortHanded,
    map: mapPref, utility: utilBonus,
    tacticsAtk: te.tacticsAtk, tacticsDef: te.tacticsDef,
    // the shape is one number across both sides for the report, which is how
    // a manager reads it: "double duelist was worth +0.2 here"
    style: (te.styleAtk + te.styleDef) / 2,
    matchup: (te.matchupAtk + te.matchupDef) / 2,
    familiarity: famEdge,
    version: se.version, mapFit: se.map, counter: se.counter,
    atk, def,
  }
  return {
    team, players, agents: picks, style, atk, def, chem, midRound, edge,
    mix: se.mix, mixName: styleName(se.mix), purity: stylePurity(se.mix),
  }
}

// ---------------------------------------------------------------- map veto

/**
 * The year has three pool windows, the way Riot actually runs it: the pool
 * that opens the season, a rotation when Stage 1 begins, and another when
 * Stage 2 begins. Challengers events follow the same calendar days, so one
 * phase covers everybody.
 */
export type PoolPhase = 0 | 1 | 2

export const poolPhaseOf = (stage: StageKey): PoolPhase =>
  stage === 'stage1' || stage === 'masters2' ? 1
    : stage === 'stage2' || stage === 'champions' || stage === 'offseason' ? 2
    : 0

/**
 * The 7 maps in the active competitive pool, for a given window of the year.
 *
 * Phase 0 deals seven of the thirteen; each later phase swaps one or two of
 * them for benched maps, cumulatively — the Stage 2 pool is the Stage 1 pool
 * with its own swap on top, not a fresh deal. Deterministic in (seed, phase),
 * so every screen and both veto paths agree on what is legal today.
 */
export function activePool(seed: number, phase: PoolPhase = 0): string[] {
  const rng = new Rng(seed ^ 0x5eed)
  const order = rng.shuffle(MAPS.slice() as string[])
  const pool = order.slice(0, 7)
  const bench = order.slice(7)
  for (let ph = 1; ph <= phase; ph++) {
    const swaps = 1 + rng.int(0, 1)
    for (let i = 0; i < swaps; i++) {
      const out = rng.int(0, pool.length - 1)
      const inn = rng.int(0, bench.length - 1)
      const dropped = pool[out]
      pool[out] = bench[inn]
      bench[inn] = dropped
    }
  }
  return pool.sort()
}

/**
 * Today's pool for this save — the one every veto and every screen must use.
 * 2023–2025 play the pool Riot actually ran on that date (eras.REAL_POOLS).
 */
export const poolFor = (state: Pick<GameState, 'seed' | 'year' | 'stage' | 'day'>): string[] =>
  realPool(state) ?? activePool(state.seed + state.year, poolPhaseOf(state.stage))

export function vetoOrder(bo: 1 | 3 | 5): ('ban' | 'pick')[] {
  // 7-map pool
  if (bo === 1) return ['ban', 'ban', 'ban', 'ban', 'ban', 'ban']
  if (bo === 3) return ['ban', 'ban', 'pick', 'pick', 'ban', 'ban']
  return ['ban', 'ban', 'pick', 'pick', 'pick', 'pick']
}

/**
 * 只有总决赛给优先权，而总决赛的 A 方在赛程模板里就是胜者组决赛的胜者
 * （bracket.ts: `GF: { a: W(UBF, 0), b: W(LBF, 0) }`），所以拿到优先权的
 * 永远是 A 方，不用另外记谁从哪条路上来的。
 */
export const vetoEdge = (label?: string): boolean => !!label && label.includes('总决赛')

/**
 * 谁在第几步动手。0 = A 方，1 = B 方。
 *
 * 平时严格轮流。带优先权时（2ban1）A 方连 ban 两张、再选下第一张图，之后从
 * B 方开始轮流——也就是前三步都归 A，剩下的按 B 先。图池是七张，各种 bo 下
 * 最后剩一张当决胜图，跟原来一样。
 */
export function vetoSteps(bo: 1 | 3 | 5, edge = false): { action: 'ban' | 'pick'; actor: 0 | 1 }[] {
  return vetoOrder(bo).map((action, i) => ({
    action,
    actor: (edge ? (i < 3 ? 0 : (i - 3) % 2 === 0 ? 1 : 0) : (i % 2)) as 0 | 1,
  }))
}

/**
 * What the AI would do with this board, right now.
 *
 * The same judgement runVeto makes, exposed one step at a time so the
 * interactive veto on the pre-match screen can hand the board back and forth
 * instead of running the whole thing in one go.
 */
export function vetoChoice(
  state: GameState, actorId: string, otherId: string,
  action: 'ban' | 'pick', remaining: string[], rng: Rng,
): string {
  const actor = state.teams[actorId]
  const other = state.teams[otherId]
  const prefOf = (t: Team, m: string) => (t.mapPrefs[m] ?? 50) + rng.range(-6, 6)
  if (action === 'ban') {
    return remaining.reduce((best, m) =>
      prefOf(other, m) - prefOf(actor, m) > prefOf(other, best) - prefOf(actor, best) ? m : best)
  }
  return remaining.reduce((best, m) => (prefOf(actor, m) > prefOf(actor, best) ? m : best))
}

export function runVeto(
  state: GameState,
  aId: string,
  bId: string,
  bo: 1 | 3 | 5,
  pool: string[],
  rng: Rng,
  edge = false,
): { maps: string[]; log: string[] } {
  const a = state.teams[aId]
  const b = state.teams[bId]
  // One map: there is nothing to veto, and a series is that map as many times
  // as it takes. What the two sides choose between games is the draft.
  if (pool.length <= 1) {
    const only = pool[0] ?? MAPS[0]
    return { maps: Array.from({ length: bo }, () => only), log: [] }
  }
  let remaining = pool.slice()
  const picked: string[] = []
  const log: string[] = []
  const steps = vetoSteps(bo, edge)
  if (edge) log.push(`${a.name} 从胜者组决赛上来，拿 2 ban 1 选的优先权`)

  const prefOf = (t: Team, m: string) => (t.mapPrefs[m] ?? 50) + rng.range(-6, 6)

  for (let i = 0; i < steps.length && remaining.length > 1; i++) {
    const actor = steps[i].actor === 0 ? a : b
    const other = steps[i].actor === 0 ? b : a
    const action = steps[i].action
    let target: string
    if (action === 'ban') {
      // ban whatever the opponent likes most and we like least
      target = remaining.reduce((best, m) =>
        prefOf(other, m) - prefOf(actor, m) > prefOf(other, best) - prefOf(actor, best) ? m : best,
      )
      log.push(`${actor.name} ban 掉 ${target}`)
    } else {
      target = remaining.reduce((best, m) => (prefOf(actor, m) > prefOf(actor, best) ? m : best))
      picked.push(target)
      log.push(`${actor.name} 选下 ${target}`)
    }
    remaining = remaining.filter((m) => m !== target)
  }

  const need = bo
  while (picked.length < need && remaining.length) {
    const decider = remaining[rng.int(0, remaining.length - 1)]
    picked.push(decider)
    remaining = remaining.filter((m) => m !== decider)
    log.push(`决胜图：${decider}`)
  }
  return { maps: picked.slice(0, bo), log }
}

// ---------------------------------------------------------------- one game on the Rift

/**
 * A game is a string of beats of about two minutes — a skirmish, a dragon, a
 * tower, a Baron — and each is a contest between what the two fives bring to
 * that part of the game.
 *
 * The engine this was built from split a map into an attacking half and a
 * defending half, and a five's shape decided which it was good at. This game
 * splits in time instead, and the same two numbers carry it: `atk` is what a
 * five is worth in lane and in the first fights, `def` is what it is worth
 * once the map has opened up. A snowball draft is strong early and thin late;
 * a scaling draft is the reverse; the beats slide from one to the other
 * between eight and twenty-two minutes.
 *
 * What the early game buys is gold, and gold is what makes the later beats
 * easier — capped, so a lead is an advantage and not a verdict: the side that
 * is better late comes back from a few thousand down, which is exactly what
 * 运营 is measured as (docs/调研-选手数值与年龄曲线.md §3). After twenty minutes
 * a beat won with a real lead can end the game.
 *
 * Held against the real numbers by scripts/check_match_shape.ts: game length,
 * kills a game, how often the side ahead at fifteen wins, how often the blue
 * side does.
 */

/** one standard deviation of how a five turns up for THIS game */
const GAME_SWING = 3.2
/** strength points per step of the beat's logistic */
const BEAT_SENS = 15
/** what a gold lead is worth in a beat, at most, and the lead that buys half of it */
const GOLD_PULL = 10
const GOLD_SCALE = 5500
/** the blue side picks first and wins 53.5% of real games; this much strength buys that */
const BLUE_EDGE = 1.4

type BeatKind = RoundLog['event']

interface MapCtx {
  lines: Record<string, MapLine>
  highlights: string[]
  rounds: RoundLog[]
}

function blankLine(): MapLine {
  return {
    kills: 0, deaths: 0, assists: 0, damage: 0, firstKills: 0, firstDeaths: 0,
    clutches: 0, rounds: 0, acs: 0, cs: 0, gold: 0,
  }
}

/** what each position takes of its side's kills, deaths and assists, before ability */
const ASSIST_WEIGHT: Record<Role, number> = { 辅助: 1.7, 打野: 1.35, 中单: 1.0, 上单: 0.85, 下路: 0.95 }
const CSPM: Record<Role, number> = { 上单: 8.1, 打野: 5.9, 中单: 8.7, 下路: 9.3, 辅助: 1.2 }
const DPM: Record<Role, number> = { 上单: 520, 打野: 390, 中单: 610, 下路: 690, 辅助: 190 }
const GOLD_SHARE: Record<Role, number> = { 上单: 0.215, 打野: 0.19, 中单: 0.225, 下路: 0.25, 辅助: 0.12 }

/** Hand one beat's kills out to the people who would have got them. */
function allocateBeat(
  winners: Player[], losers: Player[], winnersKills: number, losersKills: number,
  ctx: MapCtx, rng: Rng, firstBlood: boolean, focusId?: string,
): string | null {
  let multi: string | null = null
  const deal = (killers: Player[], victims: Player[], n: number, first: boolean) => {
    if (!killers.length || !victims.length) return
    const got: Record<string, number> = {}
    for (let i = 0; i < n; i++) {
      const k = rng.weighted(killers, killers.map((p) => killShare(p) * (p.id === focusId ? 1.35 : 1)))
      const v = rng.weighted(victims, victims.map((p) => DEATH_WEIGHT[p.role] * (1.25 - p.attrs.awareness / 200)))
      ctx.lines[k.id].kills++
      ctx.lines[v.id].deaths++
      got[k.id] = (got[k.id] ?? 0) + 1
      if (first && i === 0) { ctx.lines[k.id].firstKills++; ctx.lines[v.id].firstDeaths++ }
      // one to three team-mates were in on it
      const mates = killers.filter((p) => p.id !== k.id)
      const helpers = Math.min(mates.length, rng.int(1, 3))
      const pool = mates.slice()
      for (let h = 0; h < helpers && pool.length; h++) {
        const m = rng.weighted(pool, pool.map((p) => ASSIST_WEIGHT[p.role] * (0.6 + p.attrs.teamwork / 160)))
        ctx.lines[m.id].assists++
        pool.splice(pool.indexOf(m), 1)
      }
    }
    for (const [id, c] of Object.entries(got)) {
      if (c >= 3) { ctx.lines[id].clutches++; if (c >= 4) multi = id }
    }
  }
  deal(winners, losers, winnersKills, firstBlood)
  deal(losers, winners, losersKills, firstBlood && winnersKills === 0)
  return multi
}

/** Everyone's share of a side's kills: mostly the hands, a little the position. */
const killShare = (p: Player): number =>
  (42 + (p.attrs.mechanics * 0.55 + p.attrs.teamfight * 0.3 + p.attrs.clutch * 0.15) * 0.78) * KILL_WEIGHT[p.role]

/** A tactical instruction; kept for the scrim and watch flows that pass one in. */
export interface TacticalCall {
  kind: 'focus' | 'rush' | 'steady'
  /** for 'focus': who the game is played around */
  playerId?: string
  roundsLeft: number
}

export type Side = 'a' | 'b'

/**
 * One game, played a beat at a time.
 *
 * Watch mode drives this from the UI; skip mode runs it straight to the end.
 * Both share this exact code path, so a game you watched and one you skipped
 * are generated the same way.
 */
export class MapSim {
  readonly map: string
  readonly A: Lineup
  readonly B: Lineup
  /** kills, which is what the scoreboard shows — NOT who is winning; see `winner` */
  a = 0
  b = 0
  /** beats completed */
  round = 0
  /** game clock, minutes */
  minute = 0
  /** A's gold lead; negative when B is ahead */
  gold = 0
  /** A's gold lead at fifteen minutes, once the clock has passed it */
  goldAt15: number | null = null
  towers: Record<Side, number> = { a: 0, b: 0 }
  dragons: Record<Side, number> = { a: 0, b: 0 }
  barons: Record<Side, number> = { a: 0, b: 0 }
  winner: 'A' | 'B' | null = null
  /**
   * There are no tactical timeouts in this sport. The fields stay because the
   * watch screen reads them; with none to spend it never offers one.
   */
  timeouts: Record<Side, number> = { a: 0, b: 0 }
  calls: Record<Side, TacticalCall | null> = { a: null, b: null }

  private rng: Rng
  private ctx: MapCtx
  private maxLead: Record<Side, number> = { a: 0, b: 0 }
  private soulSaid = false

  /** kept for the scrim flow's signature; every game is simply played out */
  readonly format: 'first13' | 'full24'
  private readonly swingA: number
  private readonly swingB: number

  constructor(map: string, A: Lineup, B: Lineup, rng: Rng, format: 'first13' | 'full24' = 'first13') {
    this.format = format
    this.map = map
    this.A = A
    this.B = B
    this.rng = rng
    this.swingA = rng.norm(0, GAME_SWING)
    this.swingB = rng.norm(0, GAME_SWING)
    this.ctx = { lines: {}, highlights: [], rounds: [] }
    for (const p of [...A.players, ...B.players]) this.ctx.lines[p.id] = blankLine()
  }

  get over(): boolean { return this.winner !== null }
  get rounds(): RoundLog[] { return this.ctx.rounds }
  get highlights(): string[] { return this.ctx.highlights }

  canTimeout(side: Side): boolean {
    return !this.over && this.timeouts[side] > 0 && this.round > 0
  }

  callTimeout(side: Side, call: Omit<TacticalCall, 'roundsLeft'>): boolean {
    if (!this.canTimeout(side)) return false
    this.timeouts[side]--
    this.calls[side] = { ...call, roundsLeft: 3 }
    return true
  }

  private callMod(call: TacticalCall | null, early: boolean, style: CompStyle): number {
    if (!call) return 0
    if (call.kind === 'rush') return (early ? 2.4 : -1.6) * callBoost('rush', style)
    if (call.kind === 'steady') return (early ? -1.2 : 2.0) * callBoost('steady', style)
    return 0.6
  }

  /** What this beat is fought over, given the clock and what is left on the map. */
  private pickBeat(): BeatKind {
    const m = this.minute
    const rng = this.rng
    const drakes = this.dragons.a + this.dragons.b
    if (this.round === 1) return 'lane'
    if (m < 14) return rng.weighted<BeatKind>(['lane', 'gank', 'dragon', 'herald', 'tower'], [2.6, 2.6, drakes < 2 ? 3.6 : 0.8, 1.5, 1.2])
    if (m < 24) return rng.weighted<BeatKind>(['fight', 'dragon', 'tower', 'pick', 'baron'], [2.2, 3.8, 2.6, 1.6, m >= 20 ? 1.4 : 0])
    return rng.weighted<BeatKind>(['fight', 'baron', 'dragon', 'tower', 'pick'], [2.8, 2.4, 2.6, 2, 1.2])
  }

  playRound(): void {
    if (this.over) return
    const rng = this.rng
    this.round++
    this.minute += this.round === 1 ? rng.range(2.6, 4.2) : rng.range(1.7, 2.7)
    const m = this.minute
    // 0 while the game is lanes and first fights, 1 once the map has opened up
    const late = clamp((m - 8) / 14, 0, 1)
    const early = late < 0.5

    const strA = (1 - late) * this.A.atk + late * this.A.def +
      this.callMod(this.calls.a, early, this.A.style) + this.swingA + BLUE_EDGE
    const strB = (1 - late) * this.B.atk + late * this.B.def +
      this.callMod(this.calls.b, early, this.B.style) + this.swingB
    // the side that is behind leans on its reading of the game to steady the ship
    const steadyA = this.gold < 0 ? this.A.midRound * 0.35 : 0
    const steadyB = this.gold > 0 ? this.B.midRound * 0.35 : 0
    const pull = GOLD_PULL * Math.tanh(this.gold / GOLD_SCALE)
    const diff = strA + steadyA - (strB + steadyB) + pull
    const p = 1 / (1 + Math.exp(-diff / BEAT_SENS))
    const aWins = rng.chance(p)

    const kind = this.pickBeat()
    const winners = aWins ? this.A.players : this.B.players
    const losers = aWins ? this.B.players : this.A.players
    const wSide: Side = aWins ? 'a' : 'b'
    const lSide: Side = aWins ? 'b' : 'a'
    const power = (side: Player[]) => Math.min(1, side.length / 5)

    // how bloody it was: a team fight kills more people than a tower does
    const bloody = kind === 'fight' || kind === 'baron' ? 1 : kind === 'tower' || kind === 'herald' ? 0.35 : 0.65
    const closeness = Math.abs(p - 0.5)
    let wk = Math.round(rng.weighted([0, 1, 2, 3, 4], [
      2.4 * (1.25 - bloody), 3.4, 2.2 * bloody + 0.3, 1.3 * bloody, 0.5 * bloody * (0.6 + closeness),
    ]) * power(winners))
    let lk = Math.round(rng.weighted([0, 1, 2], [
      6 + closeness * 6, 2.2 * bloody + 0.4, 0.7 * bloody,
    ]) * power(losers))
    wk = Math.min(wk, losers.length); lk = Math.min(lk, winners.length)
    const firstBlood = this.a + this.b === 0 && wk + lk > 0
    const focus = aWins ? this.calls.a : this.calls.b
    const multi = allocateBeat(winners, losers, wk, lk, this.ctx, rng, firstBlood,
      focus?.kind === 'focus' ? focus.playerId : undefined)
    if (aWins) { this.a += wk; this.b += lk } else { this.b += wk; this.a += lk }

    // ---- what the beat was worth
    let swing = (300 * (wk - lk) + rng.range(150, 450)) * (m < 15 ? 0.72 : 1)
    if (kind === 'dragon') { this.dragons[wSide]++; swing += 250 }
    else if (kind === 'herald') swing += 550
    else if (kind === 'tower') { this.towers[wSide]++; swing += rng.range(550, 800) }
    else if (kind === 'baron') {
      this.barons[wSide]++
      this.towers[wSide] = Math.min(11, this.towers[wSide] + rng.int(1, 2))
      swing += rng.range(1500, 2300)
    } else if (kind === 'fight' && wk >= 3) {
      this.towers[wSide] = Math.min(11, this.towers[wSide] + 1)
      swing += 500
    }
    // shutdown gold: what the side that is behind takes is worth more
    const wasBehind = aWins ? this.gold < -2500 : this.gold > 2500
    if (wasBehind) swing *= 1.3
    swing = Math.max(120, swing)
    this.gold += aWins ? swing : -swing
    if (this.goldAt15 === null && m >= 15) this.goldAt15 = Math.round(this.gold)
    this.maxLead.a = Math.max(this.maxLead.a, this.gold)
    this.maxLead.b = Math.max(this.maxLead.b, -this.gold)

    // ---- can it end here
    const lead = aWins ? this.gold : -this.gold
    let ended = false
    if (m >= 20) {
      const byLead = clamp((lead - 2500) / 9000, 0, 0.8)
      const byClock = clamp((m - 19) / 10, 0.12, 1)
      const byObjective = kind === 'baron' ? 0.18 : kind === 'fight' && wk >= 4 ? 0.22 : 0
      const soul = this.dragons[wSide] >= 4 ? 0.08 : 0
      const dragging = m >= 34 ? clamp((m - 34) / 8, 0, 0.6) : 0
      if (rng.chance(Math.min(0.94, byLead * byClock + byObjective * byClock + soul + dragging))) ended = true
    }
    if (m >= 45) ended = true
    if (ended) {
      const ace = Math.min(losers.length, rng.int(2, 5))
      allocateBeat(winners, losers, ace, 0, this.ctx, rng, false)
      if (aWins) this.a += ace; else this.b += ace
      this.winner = aWins ? 'A' : 'B'
      this.towers[wSide] = Math.max(this.towers[wSide], 8 + rng.int(0, 3))
    }

    this.ctx.rounds.push({
      n: this.round, winner: aWins ? 'A' : 'B', minute: Math.round(m * 10) / 10,
      event: ended ? 'nexus' : kind, gold: Math.round(this.gold), killsA: this.a, killsB: this.b,
    })

    // ---- the lines worth reading afterwards
    const room = () => this.ctx.highlights.length < 9
    const name = (s: Side) => (s === 'a' ? this.A.team.name : this.B.team.name)
    const ign = (id: string) => [...this.A.players, ...this.B.players].find((x) => x.id === id)?.ign ?? ''
    if (firstBlood && room() && rng.chance(0.5)) {
      const fb = Object.entries(this.ctx.lines).find(([, l]) => l.firstKills > 0)?.[0]
      if (fb) this.ctx.highlights.push(`${Math.floor(m)} 分钟，${ign(fb)} 拿下一血。`)
    }
    if (multi && room()) this.ctx.highlights.push(HL.quad(ign(multi)))
    if (!this.soulSaid && this.dragons[wSide] === 4 && room()) {
      this.soulSaid = true
      this.ctx.highlights.push(`${name(wSide)} 拿下第四条小龙，龙魂到手。`)
    }
    if (kind === 'baron' && wasBehind && room()) this.ctx.highlights.push(`${name(wSide)} 落后时抢下大龙，局势反转。`)
    else if (kind === 'baron' && room() && rng.chance(0.4)) this.ctx.highlights.push(`${Math.floor(m)} 分钟，${name(wSide)} 拿下大龙。`)
    if (ended && room()) {
      const back = this.maxLead[lSide]
      if (back >= 5000) this.ctx.highlights.push(`${name(wSide)} 最多落后 ${(back / 1000).toFixed(1)}k，翻盘拿下这一局。`)
      else if (m < 26) this.ctx.highlights.push(`${name(wSide)} ${Math.floor(m)} 分钟结束比赛。`)
    }

    for (const side of ['a', 'b'] as Side[]) {
      const c = this.calls[side]
      if (c && --c.roundsLeft <= 0) this.calls[side] = null
    }
  }

  /** Finalise per-player lines and hand back the game. */
  result(): { score: MapScore; highlights: string[] } {
    const rng = this.rng
    const m = Math.max(1, this.minute)
    const aWon = this.winner === 'A'
    const finish = (side: Player[], won: boolean, lead: number) => {
      const teamGold = m * 1780 + lead / 2
      const raw = side.map((p) => DPM[p.role] * (0.72 + (p.attrs.mechanics * 0.6 + p.attrs.teamfight * 0.4) / 250) *
        (won ? 1.05 : 0.96) * rng.range(0.85, 1.15))
      side.forEach((p, i) => {
        const l = this.ctx.lines[p.id]
        l.rounds = Math.round(m)
        l.damage = Math.round(raw[i] * m)
        l.cs = Math.round(CSPM[p.role] * m * (0.86 + p.attrs.farming / 600) * (won ? 1.02 : 0.98) * rng.range(0.94, 1.06))
        l.gold = Math.round(teamGold * GOLD_SHARE[p.role] * (0.9 + p.attrs.farming / 800) + l.kills * 250 + l.assists * 60)
      })
      // a performance score on the scale the rest of the game already reads (200 is an average game)
      const tk = Math.max(1, side.reduce((s, p) => s + this.ctx.lines[p.id].kills, 0))
      const td = Math.max(1, side.reduce((s, p) => s + this.ctx.lines[p.id].deaths, 0))
      const dmg = Math.max(1, raw.reduce((s, v) => s + v, 0))
      side.forEach((p, i) => {
        const l = this.ctx.lines[p.id]
        const kp = (l.kills + l.assists) / tk
        const rating = 1 + (kp - 0.6) * 0.55 - (l.deaths / td - 0.2) * 0.9 +
          (raw[i] / dmg - DPM[p.role] / 2400) * 1.6 + (won ? 0.1 : -0.1)
        l.acs = Math.round(200 * clamp(rating, 0.35, 1.9))
      })
    }
    finish(this.A.players, aWon, this.gold)
    finish(this.B.players, !aWon, -this.gold)
    return {
      score: {
        map: this.map,
        // who won, as 1–0: everything downstream reads "the higher score won"
        scoreA: aWon ? 1 : 0, scoreB: aWon ? 0 : 1,
        killsA: this.a, killsB: this.b, minutes: Math.round(m * 10) / 10,
        goldDiff: Math.round(this.gold), goldAt15: this.goldAt15 ?? Math.round(this.gold),
        towersA: this.towers.a, towersB: this.towers.b,
        dragonsA: this.dragons.a, dragonsB: this.dragons.b,
        baronsA: this.barons.a, baronsB: this.barons.b,
        edge: { a: this.A.edge, b: this.B.edge },
        lines: this.ctx.lines, rounds: this.ctx.rounds,
        agents: { ...this.A.agents, ...this.B.agents },
      },
      highlights: this.ctx.highlights,
    }
  }

  /** Run the remaining beats without stopping. */
  runOut(): void {
    let guard = 0
    while (!this.over && guard++ < 60) this.playRound()
    if (!this.over) this.winner = this.gold >= 0 ? 'A' : 'B'
  }
}

/**
 * A whole match, map by map. The veto runs up front; each map is then a MapSim
 * the caller can step through or run out. `simulateMatch` below is just this
 * class driven to completion, so watched and skipped matches agree.
 */
export class MatchSim {
  readonly maps: string[]
  readonly vetoLog: string[]
  readonly need: number
  readonly aId: string
  readonly bId: string
  wonA = 0
  wonB = 0
  played: MapScore[] = []
  highlights: string[] = []
  current: MapSim | null = null
  mapIndex = -1

  private state: GameState
  private rng: Rng
  private seenA = new Set<string>()
  private seenB = new Set<string>()

  readonly format: 'first13' | 'full24'

  constructor(
    state: GameState, aId: string, bId: string, bo: 1 | 3 | 5, rng: Rng,
    agreed?: { map: string; format: 'first13' | 'full24' },
    /** 赛程标签，只用来判断这是不是总决赛（决定 veto 的优先权） */
    label?: string,
  ) {
    this.state = state
    this.aId = aId
    this.bId = bId
    this.rng = rng
    this.need = Math.ceil(bo / 2)
    this.format = agreed?.format ?? 'first13'
    if (agreed) {
      // a scrim has no veto — both sides agreed the map when booking it
      this.maps = [agreed.map]
      this.vetoLog = []
    } else if (state.vetoPlan && state.vetoPlan.maps.length === bo) {
      // the manager ran the veto himself on the pre-match screen
      this.maps = state.vetoPlan.maps.slice()
      this.vetoLog = state.vetoPlan.log.slice()
    } else {
      const pool = poolFor(state)
      const { maps, log } = runVeto(state, aId, bId, bo, pool, rng, vetoEdge(label))
      this.maps = maps
      this.vetoLog = log
    }
  }

  get decided(): boolean {
    return this.wonA >= this.need || this.wonB >= this.need
  }

  /** Which side the managed club is on, for timeout routing. */
  sideOf(teamId: string): 'a' | 'b' | null {
    return teamId === this.aId ? 'a' : teamId === this.bId ? 'b' : null
  }

  /** Begin the next map. Returns false when the match is already decided. */
  nextMap(): boolean {
    if (this.decided || this.mapIndex + 1 >= this.maps.length) return false
    this.mapIndex++
    const m = this.maps[this.mapIndex]
    const A = buildLineup(this.state, this.aId, m, this.bId)
    const B = buildLineup(this.state, this.bId, m, this.aId)
    for (const p of A.players) this.seenA.add(p.id)
    for (const p of B.players) this.seenB.add(p.id)
    this.current = new MapSim(m, A, B, this.rng, this.format)
    return true
  }

  /** Fold the finished map into the match tally. */
  closeMap(): void {
    if (!this.current) return
    const { score, highlights } = this.current.result()
    this.played.push(score)
    for (const h of highlights) {
      if (this.highlights.length < 10) this.highlights.push(`[${mapCn(score.map)}] ${h}`)
    }
    // A 24-round scrim can finish 12-12. The else branch used to hand that to
    // side B: the news read "0-1", the whole squad lost form and morale for a
    // defeat, and the scoreboard right above it said 12–12.
    if (score.scoreA > score.scoreB) this.wonA++
    else if (score.scoreB > score.scoreA) this.wonB++
    this.current = null
  }

  finish(): MatchResult {
    const totals: Record<string, { acs: number; maps: number }> = {}
    for (const ms of this.played) {
      for (const [pid, l] of Object.entries(ms.lines)) {
        const t = (totals[pid] ??= { acs: 0, maps: 0 })
        t.acs += l.acs
        t.maps++
      }
    }
    const winnerIds = new Set(
      (this.wonA > this.wonB ? this.state.teams[this.aId] : this.state.teams[this.bId])?.roster ?? [],
    )
    let mvp: string | null = null
    let best = -1
    for (const [pid, t] of Object.entries(totals)) {
      if (!t.maps) continue
      const s = t.acs / t.maps + (winnerIds.has(pid) ? 18 : 0)
      if (s > best) {
        best = s
        mvp = pid
      }
    }
    return {
      mapsWonA: this.wonA, mapsWonB: this.wonB, maps: this.played,
      vetoLog: this.vetoLog, mvp, highlights: this.highlights,
      lineups: { a: [...this.seenA], b: [...this.seenB] },
    }
  }

  /** Play everything that is left without stopping. */
  runOut(): MatchResult {
    while (!this.decided && this.nextMap()) {
      this.current!.runOut()
      this.closeMap()
    }
    return this.finish()
  }
}

/**
 * Paperwork only the manager's own matches will ever show.
 *
 * The round log is one: nothing draws a ribbon for a match you did not play.
 * So is the edge breakdown — MatchModal renders 「为什么是这个结果」 behind an
 * `involved` check, so for every other club in the world those numbers were
 * written, saved and never once looked at. Three maps of them is 1.4kB a
 * match, and the league plays about seven hundred of them a season.
 */
export function stripRoundLogs(result: MatchResult): void {
  for (const m of result.maps) {
    delete m.rounds
    delete m.edge
  }
}

/**
 * Old matches keep their score and lose their paperwork.
 *
 * Every played match in the league kept its per-player lines, veto log and
 * highlights for the whole season — a thousand matches deep, the save grew to
 * 5.7MB of JSON (11MB as UTF-16 in storage) and localStorage refused every
 * autosave from about day 200 onward. Sixty thousand QuotaExceededErrors on
 * the dashboard were this.
 *
 * That first pass was not enough, and the dashboard said so: 134,000 more of
 * them the week this was written. Measured rather than guessed, a career at
 * day 224 was still writing 2.07MB of JSON — 4.1MB as UTF-16, against a 5MB
 * origin budget that also has to hold a manual save, the tutorial snapshot and
 * the card mode. Two things were still being kept that nothing reads:
 *
 *   Other clubs' matches kept `agents` and `lineups` after the prune, which is
 *   most of what was left of them — 780 bytes each where 140 will do, times
 *   seven hundred matches. Their scoreboard is already emptied here, so the
 *   agent each of those players picked has nowhere to be shown.
 *
 *   Our own matches kept everything for the whole season, 9kB apiece. The
 *   round-by-round ribbon and the edge breakdown are two thirds of that and
 *   both belong to the post-match screen, which is a thing you read the day it
 *   happens. After six weeks they go and the scoreboard stays, so the match
 *   still opens and still shows who did what.
 */
export function pruneMatchDetail(state: GameState): void {
  // ten days, which is exactly how far back the schedule screen looks by
  // default — so every other club's match you can still see in the list still
  // opens with its scoreboard, and the ones that lose it are the ones you
  // would have to go looking for
  const foreignCutoff = state.day - 10
  // six weeks: long enough that the ribbon is still there for anything you
  // might plausibly go back and re-read, short enough to bound the season
  const mineCutoff = state.day - 45
  for (const f of state.fixtures) {
    if (!f.played || !f.result) continue

    if (f.teamA === state.myTeam || f.teamB === state.myTeam) {
      if (f.day >= mineCutoff) continue
      for (const m of f.result.maps) {
        delete m.rounds
        delete m.edge
      }
      continue
    }

    if (f.day >= foreignCutoff) continue
    // already stripped: leave it alone rather than reallocating every day
    if (!f.result.vetoLog.length && !f.result.highlights.length && !f.result.lineups
      && !f.result.maps.some((m) => m.agents || m.edge || m.rounds || Object.keys(m.lines).length)) {
      continue
    }
    f.result.vetoLog = []
    f.result.highlights = []
    delete f.result.lineups
    for (const m of f.result.maps) {
      m.lines = {}
      delete m.edge
      delete m.rounds
      delete m.agents
    }
  }
}

/**
 * Everything the save can lose and still be the same career.
 *
 * The last resort, run in place when the browser has refused a write: every
 * match in the world comes down to its scoreline and its MVP, ours included,
 * and the feed and the ledger keep their most recent hundred lines. What
 * survives is what the game asks questions of — honours, squads, contracts,
 * the record — so nothing that decides an ending or an achievement is touched.
 * A career missing last month's scoreboards is not a career lost, which is the
 * only other option at this point.
 */
export function stripToTheBone(state: GameState): void {
  for (const f of state.fixtures) {
    if (!f.result) continue
    f.result.vetoLog = []
    f.result.highlights = []
    delete f.result.lineups
    // Other clubs' games come down to the series score. The table is built
    // from mapsWon, so the standings are untouched; what goes is the list of
    // map scores in a modal for a match you did not play. Ours keep their map
    // scores, because the achievements are still asking them questions.
    if (f.teamA !== state.myTeam && f.teamB !== state.myTeam) {
      f.result.maps = []
      continue
    }
    for (const m of f.result.maps) {
      m.lines = {}
      delete m.edge
      delete m.rounds
      delete m.agents
    }
  }
  if (state.news.length > 100) state.news.splice(0, state.news.length - 100)
  if (state.finances.log.length > 100) {
    state.finances.log.splice(0, state.finances.log.length - 100)
  }
}

// ---------------------------------------------------------------- match

export function simulateMatch(
  state: GameState,
  aId: string,
  bId: string,
  bo: 1 | 3 | 5,
  rng: Rng,
  agreed?: { map: string; format: 'first13' | 'full24' },
  label?: string,
): MatchResult {
  return new MatchSim(state, aId, bId, bo, rng, agreed, label).runOut()
}

/** Roll the match's per-map lines into a player's season + career totals. */
export function applyMatchStats(state: GameState, result: MatchResult): void {
  for (const ms of result.maps) {
    for (const [pid, l] of Object.entries(ms.lines)) {
      const p = state.players[pid]
      if (!p) continue
      for (const bucket of [p.season, p.career]) {
        bucket.maps++
        bucket.rounds += l.rounds
        bucket.kills += l.kills
        bucket.deaths += l.deaths
        bucket.assists += l.assists
        bucket.firstKills += l.firstKills
        bucket.firstDeaths += l.firstDeaths
        bucket.damage += l.damage
        bucket.clutches += l.clutches
      }
    }
  }
  if (result.mvp) {
    const p = state.players[result.mvp]
    if (p) {
      p.season.mvps++
      p.career.mvps++
    }
  }
}

export { ratingOf } from './player'

/**
 * The best performance on ONE map — the same scoring the match MVP uses (ACS
 * plus a winner's nod), judged against that map's own winner. The match MVP
 * tag used to sit on every per-map sheet, where a 1.56 on the map lost the
 * label to whoever had averaged best across the series.
 */
export function mapMvp(
  map: MapScore, lineups?: { a: string[]; b: string[] },
): string | null {
  const winners = new Set(map.scoreA > map.scoreB ? lineups?.a ?? [] : lineups?.b ?? [])
  let best = -1
  let mvp: string | null = null
  for (const [pid, l] of Object.entries(map.lines)) {
    const s = l.acs + (winners.has(pid) ? 18 : 0)
    if (s > best) {
      best = s
      mvp = pid
    }
  }
  return mvp
}
