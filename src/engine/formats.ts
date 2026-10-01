/**
 * A stage as a program of phases — the real 2026 League formats.
 *
 * VAL MANAGER's season engine knows a handful of shapes by name (a table then
 * an eight-team double elimination; a Swiss round then the same; GSL groups)
 * and branches on them in season.ts. League of Legends' year has a different
 * shape in every region and nearly every split (docs/调研-2026赛制.md): LPL's
 * groups drawn from the last split's placings, its Knights Rivals play-ins and
 * the picks the top four make; LCK Cup's two groups that only play each other;
 * the records LCK carries from Rounds 1-2 into 3-4; LCS Lock-In's Swiss; play-ins
 * that send three of six on, or two of four.
 *
 * So a stage here is an ordered list of phases, each of which knows how to
 * schedule itself, how to go on, when it is over, and what ranking it leaves:
 *
 *   rr      groups, each a single or double round robin (a team's record can
 *           be carried in from an earlier stage)
 *   cross   two groups that play only each other — LCK Cup's Group Battle
 *   swiss   n rounds paired by record, with win/loss thresholds or none
 *   ko      a bracket template (engine/bracket.ts's notation: every slot names
 *           a seed, or the winner or loser of an earlier slot), any size,
 *           byes by seeding later rounds, best-of per slot
 *
 * Every phase ends with an `order` of everyone who played in it, best first;
 * the next phase seeds itself from the results so far. The stage's final
 * placings are the last phase's order, then whoever went out earlier, latest
 * phase first. Fixtures carry `ph`, the phase they belong to, and the labels
 * the rest of the game already reads: `常规赛 第N轮 · 组名` for a table game,
 * `SW:<round>:…` for a Swiss game (both count in the table), `KO:<wave>:<round>`
 * for a bracket game, numbered on from the phases before it so the bracket
 * view draws one stage left to right.
 */
import { Rng, hashStr } from './rng'
import { makeFixture, newStandings, roundRobin, sortStandings } from './league'
import type { Competition, Fixture, GameState, StageKey } from './types'
import { projectNext } from './bracket'

// ------------------------------------------------------------ templates

export type Src = { seed: number } | { w: [string, number] } | { l: [string, number] }
export interface Slot { a: Src; b: Src; bo?: 1 | 3 | 5 }
export interface Round { name: string; slots: Slot[] }
export type Wave = Round[]
export interface Template {
  waves: Wave[]
  /** everyone in the bracket, best first, once it is over */
  places: Src[]
}

export const S = (n: number): Src => ({ seed: n })
export const W = (name: string, i = 0): Src => ({ w: [name, i] })
export const L = (name: string, i = 0): Src => ({ l: [name, i] })

// ------------------------------------------------------------ phases

export interface Ctx {
  state: GameState
  comp: Competition
  /** results of the phases already over, by phase key */
  res: Record<string, PhaseResult>
}

export interface PhaseResult {
  /** everyone who played in the phase, best first */
  order: string[]
  /** a group phase's tables, best first, in group order */
  groups?: Record<string, string[]>
  /** cross: the group that won the battle */
  winner?: string
}

interface Base {
  key: string
  /** the first day it may be played (day of the year); later if the phase before it runs long */
  start: number
}

export interface RR extends Base {
  kind: 'rr'
  /** last day of the table */
  end: number
  bo: 1 | 3 | 5
  /** cycles: how many times each pair in a group meets (a Bo2 league is played as two cycles of one game) */
  groups: (ctx: Ctx) => { name: string; teams: string[]; cycles: number }[]
  /** two groups that also play each other this many times (LPL 2016: a single round across) */
  crossCycles?: number
  /** copy these teams' table rows in from another competition before the first game */
  carry?: (ctx: Ctx) => Competition | undefined
}

export interface Cross extends Base {
  kind: 'cross'
  end: number
  /** both groups in seed order; seed i of one meets seed i of the other in the Super Week, best of five */
  groups: (ctx: Ctx) => [{ name: string; teams: string[] }, { name: string; teams: string[] }]
}

export interface Swiss extends Base {
  kind: 'swiss'
  /** the last day; the rounds are spread evenly from `start` to here */
  end?: number
  rounds: number
  /** through at this many wins, out at this many losses; absent = everybody plays every round */
  win?: number
  lose?: number
  bo: (round: number, w: number, l: number, ctx: Ctx) => 1 | 3 | 5
  /** seed order, best first; round one is pools: the top half against the bottom half, avoiding a region's own */
  seeds: (ctx: Ctx) => string[]
}

export interface KO extends Base {
  kind: 'ko'
  /** the last day; the waves are spread evenly from `start` to here, never sooner than tomorrow */
  end?: number
  bo: 1 | 3 | 5
  template: (ctx: Ctx) => Template
  seeds: (ctx: Ctx) => string[]
}

export type Phase = RR | Cross | Swiss | KO

export interface Program {
  phases: Phase[]
  /** how the stage works, in a few lines, for the standings screen */
  blurb?: string
  /** competitions that must be over before the first phase can be drawn up */
  after?: (state: GameState) => string[]
}

export interface ProgState {
  phase: number
  started: boolean
  res: Record<string, PhaseResult>
  /** the seeds each bracket or Swiss was drawn with */
  seeds: Record<string, string[]>
  /** KO waves used by earlier phases, so the next bracket numbers on */
  wave: number
  /** the groups each table phase was drawn into — fixed when it starts, not recomputed */
  groups: Record<string, { name: string; teams: string[] }[]>
}

/** the soonest the next round of a bracket or a Swiss can be: tomorrow */
export const WAVE_GAP = 1

/** wave i of n on its planned day, spread over [start, end], never before `from` */
const planned = (from: number, start: number, end: number | undefined, i: number, n: number): number =>
  end === undefined ? from : Math.max(from, start + Math.round(i * (end - start) / Math.max(1, n - 1)))

const progOf = (comp: Competition): ProgState =>
  (comp.prog ??= { phase: 0, started: false, res: {}, seeds: {}, wave: 0, groups: {} })

const phaseFixtures = (state: GameState, comp: Competition, key: string): Fixture[] =>
  state.fixtures.filter((f) => f.comp === comp.key && f.ph === key)

const winnerOf = (f: Fixture): string | null =>
  f.result ? (f.result.mapsWonA > f.result.mapsWonB ? f.teamA : f.teamB) : null
const loserOf = (f: Fixture): string | null =>
  f.result ? (f.result.mapsWonA > f.result.mapsWonB ? f.teamB : f.teamA) : null
const nameOf = (f: Fixture): string => f.label.split(':')[2] ?? ''
const waveOf = (f: Fixture): number => Number(f.label.split(':')[1] || 0)

function fixture(
  state: GameState, comp: Competition, ph: string, day: number, a: string, b: string, bo: 1 | 3 | 5, label: string,
): Fixture {
  void state
  const f = makeFixture(day, comp.stage as StageKey, comp.key, a, b, bo, label)
  f.ph = ph
  return f
}

// ------------------------------------------------------------ rr

function startRR(ctx: Ctx, p: RR, from: number): Fixture[] {
  const { state, comp } = ctx
  const rng = new Rng(hashStr(`${state.seed}:${state.year}:${comp.key}:${p.key}`))
  const groups = p.groups(ctx)
  progOf(comp).groups[p.key] = groups.map((g) => ({ name: g.name, teams: g.teams.slice() }))
  const carried = p.carry?.(ctx)
  if (carried) {
    for (const g of groups) for (const id of g.teams) {
      if (carried.standings[id]) comp.standings[id] = { ...carried.standings[id] }
    }
  }
  if (groups.length > 1) {
    comp.grouped = true
    comp.groups = groups.map((g) => g.teams.slice())
    comp.groupNames = groups.map((g) => g.name)
  }
  const start = Math.max(p.start, from)
  const end = Math.max(p.end, start + 4)
  const out: Fixture[] = []
  // the rounds across two groups, interleaved with each group's own (LPL 2016)
  const across: [string, string][][] = []
  if (p.crossCycles && groups.length === 2) {
    const [g1, g2] = groups
    const n = Math.min(g1.teams.length, g2.teams.length)
    for (let c = 0; c < p.crossCycles; c++) {
      for (let r = 0; r < n; r++) across.push(g1.teams.slice(0, n).map((a, i) => (c % 2 ? [g2.teams[(i + r) % n], a] : [a, g2.teams[(i + r) % n]]) as [string, string]))
    }
  }
  for (const [gi, g] of groups.entries()) {
    let rounds: [string, string][][] = []
    for (let c = 0; c < g.cycles; c++) {
      for (const pairs of roundRobin(g.teams, rng)) rounds.push(c % 2 ? pairs.map(([a, b]) => [b, a] as [string, string]) : pairs)
    }
    rounds = rounds.filter((r) => r.length)
    if (across.length) {
      // every third round is played across; the first group's schedule carries the cross games,
      // the second leaves those rounds empty so both groups stay on the same days
      const cross = gi === 0 ? across.slice() : across.map(() => [] as [string, string][])
      const mixed: [string, string][][] = []
      const total = rounds.length + cross.length
      for (let i = 0; i < total; i++) {
        const wantCross = cross.length > 0 && (i % 3 === 2 || rounds.length === 0)
        mixed.push(wantCross ? cross.shift()! : rounds.shift() ?? cross.shift()!)
      }
      rounds = mixed
    }
    const step = rounds.length > 1 ? Math.max(1, (end - start) / (rounds.length - 1)) : 0
    const suffix = groups.length > 1 ? ` · ${g.name}` : ''
    rounds.forEach((pairs, i) => {
      const day = start + Math.round(i * step)
      for (const [a, b] of pairs) out.push(fixture(state, comp, p.key, day, a, b, p.bo, `常规赛 第${i + 1}轮${across.length && !g.teams.includes(b) ? ' · 跨组' : suffix}`))
    })
  }
  return out
}

/** A table, best first, read off the competition's standings (wins, then game difference). */
const table = (comp: Competition, ids: string[]): string[] => {
  const set = new Set(ids)
  return sortStandings(comp).filter((id) => set.has(id))
}

function resultRR(ctx: Ctx, p: RR): PhaseResult {
  const groups = progOf(ctx.comp).groups[p.key] ?? p.groups(ctx)
  const out: Record<string, string[]> = {}
  for (const g of groups) out[g.name] = table(ctx.comp, g.teams)
  return { order: groups.flatMap((g) => out[g.name]), groups: out }
}

// ------------------------------------------------------------ cross (LCK Cup Group Battle)

export const CROSS_WIN = { bo3: 1, bo5: 2 } as const

function startCross(ctx: Ctx, p: Cross, from: number): Fixture[] {
  const { state, comp } = ctx
  const [g1, g2] = p.groups(ctx)
  progOf(comp).groups[p.key] = [g1, g2].map((g) => ({ name: g.name, teams: g.teams.slice() }))
  comp.grouped = true
  comp.groups = [g1.teams.slice(), g2.teams.slice()]
  comp.groupNames = [g1.name, g2.name]
  const n = Math.min(g1.teams.length, g2.teams.length)
  const start = Math.max(p.start, from)
  const end = Math.max(p.end, start + 8)
  // weeks one and two: every pairing but the same-seed one, n−1 rounds of n games;
  // the Super Week: seed i against seed i, best of five
  const rounds: [string, string, 3 | 5][][] = []
  for (let r = 1; r < n; r++) rounds.push(g1.teams.slice(0, n).map((a, i) => [a, g2.teams[(i + r) % n], 3]))
  rounds.push(g1.teams.slice(0, n).map((a, i) => [a, g2.teams[i], 5]))
  const step = Math.max(1, (end - start) / Math.max(1, rounds.length - 1))
  const out: Fixture[] = []
  rounds.forEach((pairs, i) => {
    const day = start + Math.round(i * step)
    const label = i === rounds.length - 1 ? '常规赛 超级周' : `常规赛 第${i + 1}轮`
    for (const [a, b, bo] of pairs) out.push(fixture(state, comp, p.key, day, a, b, bo, label))
  })
  return out
}

/** Group points so far: a best-of-three win is one, a best-of-five two. */
export function crossPoints(state: GameState, comp: Competition, key: string): Record<string, number> {
  const groups = comp.groups ?? []
  const pts: Record<string, number> = {}
  comp.groupNames?.forEach((g) => { pts[g] = 0 })
  for (const f of phaseFixtures(state, comp, key)) {
    const w = winnerOf(f)
    if (!w) continue
    const gi = groups.findIndex((g) => g.includes(w))
    if (gi >= 0) pts[comp.groupNames![gi]] += f.bo === 5 ? CROSS_WIN.bo5 : CROSS_WIN.bo3
  }
  return pts
}

function resultCross(ctx: Ctx, p: Cross): PhaseResult {
  const [g1, g2] = progOf(ctx.comp).groups[p.key] ?? p.groups(ctx)
  const pts = crossPoints(ctx.state, ctx.comp, p.key)
  // a tie on group points: the group with more game wins between them (待查 in the
  // source — the rule is not published; this is the plainest reading)
  const gw = (g: { teams: string[] }) => g.teams.reduce((s, id) => s + (ctx.comp.standings[id]?.mapW ?? 0), 0)
  const firstWins = pts[g1.name] > pts[g2.name] || (pts[g1.name] === pts[g2.name] && gw(g1) >= gw(g2))
  const [win, lose] = firstWins ? [g1, g2] : [g2, g1]
  const groups = { [win.name]: table(ctx.comp, win.teams), [lose.name]: table(ctx.comp, lose.teams) }
  return { order: [...groups[win.name], ...groups[lose.name]], groups, winner: win.name }
}

// ------------------------------------------------------------ swiss

/**
 * Pair teams that share a record, top against bottom, without a rematch where
 * any pairing avoids one. A pool with an odd number sends its last team down to
 * the next record (LCP's Split 3 Swiss of eight meets this after round three).
 */
export function pairSwiss(pools: string[][], played: Set<string>): [string, string][] {
  const out: [string, string][] = []
  let carry: string[] = []
  for (const raw of pools) {
    const pool = [...carry, ...raw]
    carry = pool.length % 2 ? [pool.pop()!] : []
    out.push(...pairNoRematch(pool, played))
  }
  if (carry.length && out.length) {
    // nobody left to meet: the odd one plays the last pair's lower team instead (never happens with even fields)
  }
  return out
}

function pairNoRematch(pool: string[], played: Set<string>): [string, string][] {
  const search = (rest: string[]): [string, string][] | null => {
    if (rest.length < 2) return []
    const [a, ...more] = rest
    for (let j = more.length - 1; j >= 0; j--) {
      if (played.has(`${a}|${more[j]}`)) continue
      const tail = search(more.filter((_, k) => k !== j))
      if (tail) return [[a, more[j]], ...tail]
    }
    return null
  }
  return search(pool) ?? pool.reduce<[string, string][]>((acc, a, i) => (i % 2 ? acc : [...acc, [a, pool[i + 1]]]), [])
}

const swissRec = (fs: Fixture[], id: string) => {
  let w = 0, l = 0
  for (const f of fs) {
    if (f.teamA !== id && f.teamB !== id) continue
    const x = winnerOf(f)
    if (!x) continue
    if (x === id) w++; else l++
  }
  return { w, l }
}

function nextSwiss(ctx: Ctx, p: Swiss, day: number): Fixture[] {
  const { state, comp } = ctx
  const ps = progOf(comp)
  const fs = phaseFixtures(state, comp, p.key)
  if (fs.some((f) => !f.played)) return []
  const round = fs.length ? Math.max(...fs.map(waveOf)) : 0
  if (round >= p.rounds) return []
  const seeds = ps.seeds[p.key] ??= p.seeds(ctx)
  const alive = seeds.filter((id) => {
    const r = swissRec(fs, id)
    return !(p.win && r.w >= p.win) && !(p.lose && r.l >= p.lose)
  })
  if (alive.length < 2) return []
  const played = new Set<string>()
  for (const f of fs) { played.add(`${f.teamA}|${f.teamB}`); played.add(`${f.teamB}|${f.teamA}`) }
  let pairs: [string, string][]
  if (round === 0) {
    const n = seeds.length
    const top = seeds.slice(0, n / 2)
    const bottom = seeds.slice(n / 2).reverse()
    pairs = top.map((a, i) => [a, bottom[i]] as [string, string])
    // a region does not meet itself in the first round: swap with the next pairing
    const reg = (id: string) => state.teams[id]?.region
    for (let i = 0; i < pairs.length; i++) {
      if (reg(pairs[i][0]) !== reg(pairs[i][1])) continue
      for (let j = 0; j < pairs.length; j++) {
        if (j === i) continue
        if (reg(pairs[i][0]) !== reg(pairs[j][1]) && reg(pairs[j][0]) !== reg(pairs[i][1])) {
          const t = pairs[i][1]; pairs[i][1] = pairs[j][1]; pairs[j][1] = t
          break
        }
      }
    }
  } else {
    const byRec = new Map<string, string[]>()
    for (const id of alive) {
      const r = swissRec(fs, id)
      const k = `${String(9 - r.w)}-${r.l}`
      byRec.set(k, [...(byRec.get(k) ?? []), id])
    }
    const keys = [...byRec.keys()].sort()
    pairs = pairSwiss(keys.map((k) => byRec.get(k)!), played)
  }
  const when = planned(day, p.start, p.end, round, p.rounds)
  return pairs.map(([a, b]) => {
    const ra = swissRec(fs, a), rb = swissRec(fs, b)
    const bo = p.bo(round + 1, Math.max(ra.w, rb.w), Math.max(ra.l, rb.l), ctx)
    return fixture(state, comp, p.key, when, a, b, bo, `SW:${round + 1}:瑞士轮 第${round + 1}轮`)
  })
}

function resultSwiss(ctx: Ctx, p: Swiss): PhaseResult {
  const fs = phaseFixtures(ctx.state, ctx.comp, p.key)
  const seeds = progOf(ctx.comp).seeds[p.key] ?? []
  // by wins, then fewer losses, then game difference inside the Swiss, then seed
  const gd = (id: string) => fs.reduce((s, f) => {
    if (!f.result) return s
    if (f.teamA === id) return s + f.result.mapsWonA - f.result.mapsWonB
    if (f.teamB === id) return s + f.result.mapsWonB - f.result.mapsWonA
    return s
  }, 0)
  const order = seeds.slice().sort((a, b) => {
    const ra = swissRec(fs, a), rb = swissRec(fs, b)
    return rb.w - ra.w || ra.l - rb.l || gd(b) - gd(a) || seeds.indexOf(a) - seeds.indexOf(b)
  })
  return { order }
}

export const swissRecordIn = (state: GameState, comp: Competition, key: string, id: string) =>
  swissRec(phaseFixtures(state, comp, key), id)

// ------------------------------------------------------------ ko

function resolve(src: Src, seeds: string[], fs: Fixture[]): string | null {
  if ('seed' in src) return seeds[src.seed - 1] ?? null
  const [name, idx] = 'w' in src ? src.w : src.l
  const f = fs.filter((x) => nameOf(x) === name)[idx]
  if (!f) return null
  return 'w' in src ? winnerOf(f) : loserOf(f)
}

function nextKO(ctx: Ctx, p: KO, day: number): Fixture[] {
  const { state, comp } = ctx
  const ps = progOf(comp)
  const fs = phaseFixtures(state, comp, p.key)
  if (fs.some((f) => !f.played)) return []
  const t = p.template(ctx)
  const seeds = ps.seeds[p.key] ??= p.seeds(ctx)
  const done = fs.length ? Math.max(...fs.map(waveOf)) - ps.wave : 0
  if (done >= t.waves.length) return []
  const out: Fixture[] = []
  const when = planned(day, p.start, p.end, done, t.waves.length)
  for (const round of t.waves[done]) {
    for (const slot of round.slots) {
      const a = resolve(slot.a, seeds, fs)
      const b = resolve(slot.b, seeds, fs)
      if (!a || !b) continue
      out.push(fixture(state, comp, p.key, when, a, b, slot.bo ?? p.bo, `KO:${ps.wave + done + 1}:${round.name}`))
    }
  }
  // a wave with nobody to play (a template wave for a bye that is not there) moves on
  return out
}

const koDone = (ctx: Ctx, p: KO): boolean => {
  const fs = phaseFixtures(ctx.state, ctx.comp, p.key)
  if (!fs.length || fs.some((f) => !f.played)) return false
  return Math.max(...fs.map(waveOf)) - progOf(ctx.comp).wave >= p.template(ctx).waves.length
}

function resultKO(ctx: Ctx, p: KO): PhaseResult {
  const fs = phaseFixtures(ctx.state, ctx.comp, p.key)
  const seeds = progOf(ctx.comp).seeds[p.key] ?? []
  const order = p.template(ctx).places.map((s) => resolve(s, seeds, fs)).filter((x): x is string => !!x)
  for (const id of seeds) if (!order.includes(id)) order.push(id)
  return { order }
}

// ------------------------------------------------------------ the runner

export type ProgramStep =
  | { kind: 'wait' }
  | { kind: 'fixtures'; fixtures: Fixture[]; note?: string }
  | { kind: 'done'; order: string[] }

/**
 * Move a programmed competition one step: schedule the next phase, the next
 * round of a bracket or Swiss, or — the last phase over — hand back the final
 * placings. `day` is the earliest day anything new may be played.
 */
export function stepProgram(state: GameState, comp: Competition, prog: Program, day: number): ProgramStep {
  const ps = progOf(comp)
  const ctx: Ctx = { state, comp, res: ps.res }
  for (let guard = 0; guard < 8; guard++) {
    const p = prog.phases[ps.phase]
    if (!p) return { kind: 'done', order: finalOrder(ctx, prog) }
    if (!ps.started) {
      if (ps.phase === 0 && prog.after && prog.after(state).some((k) => !state.comps[k]?.champion)) return { kind: 'wait' }
      ps.started = true
      // the bracket view opens with the first bracket or Swiss game
      if (p.kind === 'ko' || p.kind === 'swiss') comp.bracketStarted = true
      const from = Math.max(day, p.start)
      if (p.kind === 'rr') return { kind: 'fixtures', fixtures: startRR(ctx, p, from) }
      if (p.kind === 'cross') return { kind: 'fixtures', fixtures: startCross(ctx, p, from) }
      if (p.kind === 'swiss') return { kind: 'fixtures', fixtures: nextSwiss(ctx, p, from) }
      return { kind: 'fixtures', fixtures: nextKO(ctx, p, from) }
    }
    const fs = phaseFixtures(state, comp, p.key)
    if (fs.some((f) => !f.played)) return { kind: 'wait' }
    let more: Fixture[] = []
    if (p.kind === 'swiss') more = nextSwiss(ctx, p, Math.max(day, p.start))
    else if (p.kind === 'ko' && !koDone(ctx, p)) more = nextKO(ctx, p, Math.max(day, p.start))
    if (more.length) return { kind: 'fixtures', fixtures: more }
    // the phase is over
    ps.res[p.key] = p.kind === 'rr' ? resultRR(ctx, p)
      : p.kind === 'cross' ? resultCross(ctx, p)
        : p.kind === 'swiss' ? resultSwiss(ctx, p)
          : resultKO(ctx, p)
    if (p.kind === 'ko') ps.wave += p.template(ctx).waves.length
    ps.phase++
    ps.started = false
  }
  return { kind: 'wait' }
}

/** The last phase's order, then whoever went out earlier, latest phase first. */
function finalOrder(ctx: Ctx, prog: Program): string[] {
  const out: string[] = []
  for (let i = prog.phases.length - 1; i >= 0; i--) {
    for (const id of ctx.res[prog.phases[i].key]?.order ?? []) if (!out.includes(id)) out.push(id)
  }
  for (const id of ctx.comp.teams) if (!out.includes(id)) out.push(id)
  return out
}

/** Where a phase stands, for the screens: its result if over, else null. */
export const phaseResult = (comp: Competition, key: string): PhaseResult | undefined => comp.prog?.res[key]

/** A fresh table for a competition whose teams are only known when it starts. */
export function resetTeams(comp: Competition, teams: string[]): void {
  comp.teams = teams.slice()
  comp.standings = newStandings(teams)
}

// ------------------------------------------------------------ picks

/**
 * Seeds that pick their opponents, best first, each taking the weakest club
 * left. LPL's top four choose their quarter-final opponents this way; the
 * manager's own club picks the same way for now (a pick screen is to come).
 */
export function pickWeakest(state: GameState, pickers: string[], pool: string[]): string[] {
  const left = pool.slice()
  return pickers.map(() => {
    left.sort((a, b) => (state.teams[a]?.rating ?? 0) - (state.teams[b]?.rating ?? 0))
    return left.shift()!
  }).filter(Boolean)
}

// ------------------------------------------------------------ the calendar ahead

export interface ProgramRound { name: string; day: number; drawn: boolean }

/**
 * Every bracket and Swiss round still to come in this stage, on its planned
 * day — the phase under way and the ones after it. Table rounds are fixtures
 * from the day their phase starts, so they need no projection.
 */
export function programRounds(state: GameState, comp: Competition, prog: Program): ProgramRound[] {
  const ps = progOf(comp)
  const ctx: Ctx = { state, comp, res: ps.res }
  const out: ProgramRound[] = []
  let wave = ps.wave
  for (let i = ps.phase; i < prog.phases.length; i++) {
    const p = prog.phases[i]
    const fs = phaseFixtures(state, comp, p.key)
    if (p.kind === 'ko') {
      const t = p.template(ctx)
      t.waves.forEach((w, k) => {
        const drawn = fs.filter((f) => waveOf(f) === wave + k + 1)
        out.push({
          name: w.map((r) => r.name).join(' / '),
          day: drawn.length ? Math.min(...drawn.map((f) => f.day)) : planned(p.start, p.start, p.end, k, t.waves.length),
          drawn: drawn.length > 0,
        })
      })
      wave += t.waves.length
    } else if (p.kind === 'swiss') {
      for (let r = 1; r <= p.rounds; r++) {
        const drawn = fs.filter((f) => waveOf(f) === r)
        out.push({
          name: `瑞士轮 第${r}轮`,
          day: drawn.length ? drawn[0].day : planned(p.start, p.start, p.end, r - 1, p.rounds),
          drawn: drawn.length > 0,
        })
      }
    }
  }
  return out
}

/**
 * Where a club plays next in this stage when no fixture says so yet: the round
 * its last result in the bracket under way feeds, on that round's planned day;
 * or the next Swiss round while it is alive. Null when it is out of this phase.
 */
export function programNext(
  state: GameState, comp: Competition, prog: Program, me: string,
): { name: string; day: number } | null {
  const ps = progOf(comp)
  const p = prog.phases[ps.phase]
  if (!p || !ps.started) return null
  const ctx: Ctx = { state, comp, res: ps.res }
  const fs = phaseFixtures(state, comp, p.key)
  const tomorrow = state.day + 1
  if (p.kind === 'ko') {
    const seeds = ps.seeds[p.key] ?? []
    if (!seeds.includes(me)) return null
    const t = p.template(ctx)
    const nx = projectNext(t.waves, seeds, fs, me)
    if (!nx) return null
    return { name: nx.name, day: planned(tomorrow, p.start, p.end, nx.wave - 1, t.waves.length) }
  }
  if (p.kind === 'swiss') {
    const seeds = ps.seeds[p.key] ?? []
    if (!seeds.includes(me)) return null
    const r = swissRec(fs, me)
    if ((p.win && r.w >= p.win) || (p.lose && r.l >= p.lose)) return null
    const round = fs.length ? Math.max(...fs.map(waveOf)) : 0
    if (round >= p.rounds) return null
    return { name: `瑞士轮 第${round + 1}轮`, day: planned(tomorrow, p.start, p.end, round, p.rounds) }
  }
  return null
}
