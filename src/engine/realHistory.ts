/**
 * Where a historical career's world goes after its first day (策划稿 §七.3, 决定 8).
 *
 * A 2016 career that only simulated would reach 2020 with no Knight, no Viper,
 * no Chovy. Replacing rosters with the real ones every winter (破晓's 「换页」)
 * would undo the manager's market work each year. So two things, and neither
 * is forced:
 *
 *   真实新人按年入场 — a real person who entered the leagues we simulate in
 *     year Y, and was nowhere in this world from the start year to Y−1, joins
 *     the free-agent pool when Y opens: his real age, his level as it was then
 *     (his Y+1 rating, which was made from his year-Y games), a ceiling read
 *     off the best he later became. Where he goes is the market's business —
 *     you can sign him before anybody else does.
 *   历史引力 — an AI club leans towards the men who really played for it that
 *     year: each is signed back with some probability, never from the
 *     manager's own squad, and a full roster lets go of whoever is not in its
 *     real five. Only up to 2026; after that the future is nobody's history.
 *
 * Real retirement is a prior: a man's last real season makes retiring likely,
 * a man who really played on makes it unlikely.
 *
 * The data (src/data/history.json, scripts/lol/build_history.py) is loaded on
 * demand — only historical careers need it — and nothing about it is saved:
 * a save holds the people who already arrived, not the ones still to come.
 */
import { Rng, clamp, hashStr } from './rng'
import { makeProspect } from './prospects'
import { seedAgentPro } from './agents'
import { agentAvailable, startYearOf } from './eras'
import { recordJoin, recordLeave } from './history'
import { contractLength, expectedSalary } from './player'
import { autoStarters } from './world'
import { ROSTER_MAX } from './transfer'
import { defaultContract } from './types'
import type { GameState, Player, Role } from './types'

interface Person {
  ign: string
  role: Role
  birth?: string | null
  nat?: string | null
  res?: string | null
  real?: string | null
  /** year -> [club (OE's name) or null for a free agent, overall, tier] */
  years: Record<string, [string | null, number, number]>
}
interface HistoryFile { people: Record<string, Person>; rosters: Record<string, Record<string, string[]>> }

let HISTORY: HistoryFile | null = null
/** load the real years (once). Historical careers await this before they start or load. */
export async function ensureHistory(): Promise<void> {
  if (!HISTORY) HISTORY = (await import('../data/history.json')).default as unknown as HistoryFile
}
export const historyLoaded = (): boolean => !!HISTORY

/** the last year history covers: after it the world is the manager's alone */
export const LAST_REAL_YEAR = 2026
/** how likely an AI club is to bring back each man who really played for it that year */
export const GRAVITY = 0.65

export const isHistoryCareer = (s: { startYear?: number }): boolean => startYearOf(s) < LAST_REAL_YEAR

/** the people who enter this world when `year` opens, for a career started in its start year */
export function entrantsFor(state: GameState, year: number): string[] {
  if (!HISTORY) return []
  const start = startYearOf(state)
  if (year <= start || year > LAST_REAL_YEAR) return []
  return Object.entries(HISTORY.people)
    .filter(([, r]) => r.years[String(year)]?.[0] && !Array.from({ length: year - start }, (_, i) => start + i).some((y) => r.years[String(y)]))
    .map(([k]) => k)
}

/** the year a man really stopped playing in the leagues we simulate */
export function realLastYear(key: string | undefined): number | null {
  const r = key && HISTORY?.people[key]
  if (!r) return null
  return Math.max(...Object.keys(r.years).map(Number))
}

const idOf = (key: string) => `H${(hashStr(`hist:${key}`) >>> 0).toString(36)}`

/** Turn a real person into a free agent of this world, at his real age and the level he had then. */
export function makeEntrant(key: string, year: number): Player | null {
  const r = HISTORY?.people[key]
  if (!r) return null
  const now = r.years[String(year)]
  const next = r.years[String(year + 1)]
  const level = (next ?? now)?.[1] ?? 60
  const peak = Math.max(...Object.entries(r.years).filter(([y]) => Number(y) >= year).map(([, v]) => v[1]))
  const p = makeProspect({
    id: idOf(key), ign: r.ign, real: r.real ?? null, nat: r.nat ?? null, born: r.birth ?? null,
    age: r.birth ? null : 20, pos: r.role, level, res: (r.res ?? undefined) as Player['residency'], agents: [],
  }, year)
  p.hkey = key
  // the ceiling is what he really became, never below where he starts
  p.potential = clamp(Math.max(peak, p.overall + 1), p.overall, 97)
  const released = (a: string) => agentAvailable({ year, day: 0 }, a)
  p.agentPro = seedAgentPro(p, released)
  return p
}

/**
 * When a historical year opens: the real newcomers arrive, and every AI club
 * leans towards its real roster. Called from setupSeason before anything is
 * drawn up, so the year's competitions see the clubs as they now are.
 */
export function openRealYear(state: GameState, notes: string[]): boolean {
  if (!HISTORY || !isHistoryCareer(state) || state.year > LAST_REAL_YEAR || state.year <= startYearOf(state)) return false
  const year = state.year
  // ---- the newcomers
  const came: string[] = []
  for (const key of entrantsFor(state, year)) {
    const p = makeEntrant(key, year)
    if (!p || state.players[p.id]) continue
    state.players[p.id] = p
    came.push(p.ign)
  }
  if (came.length) {
    state.news.push({
      day: state.day, kind: 'player', important: true,
      text: `🌱 ${year} 年进入职业赛场的新面孔：${came.slice(0, 10).join('、')}${came.length > 10 ? ` 等 ${came.length} 人` : ''}。他们在自由市场上，谁先签算谁的。`,
    })
    notes.push(`🌱 ${came.length} 名 ${year} 年的真实新人进入自由市场。`)
  }

  // ---- the pull of what really happened
  const rosters = HISTORY.rosters[String(year)] ?? {}
  const byKey = new Map<string, Player>()
  for (const p of Object.values(state.players)) if (p.hkey) byKey.set(p.hkey, p)
  const rng = new Rng(hashStr(`gravity:${state.seed}:${year}`))
  let moved = 0
  for (const team of Object.values(state.teams)) {
    if (team.id === state.myTeam || !team.oeName) continue
    const real = rosters[team.oeName] ?? []
    if (!real.length) continue
    for (const key of real) {
      const p = byKey.get(key)
      if (!p || p.teamId === team.id || p.teamId === state.myTeam || p.retiring) continue
      if (!rng.chance(GRAVITY)) continue
      const from = p.teamId ? state.teams[p.teamId] : undefined
      if (from) {
        from.roster = from.roster.filter((id) => id !== p.id)
        from.starters = from.starters.filter((id) => id !== p.id)
        recordLeave(state, p)
      }
      p.teamId = team.id
      p.contractYears = contractLength(p, rng, team.roster.map((id) => state.players[id]))
      p.salary = expectedSalary(p, team.tier)
      p.contract = defaultContract(p.salary, p.contractYears)
      p.expiredYear = undefined
      team.roster.push(p.id)
      recordJoin(state, p, team.id)
      moved++
    }
    // over the limit: let go of whoever is not in the real squad, weakest first
    const realSet = new Set(real)
    while (team.roster.length > ROSTER_MAX) {
      const spare = team.roster.map((id) => state.players[id])
        .filter((p) => p && !realSet.has(p.hkey ?? ''))
        .sort((a, b) => a.overall - b.overall)[0]
      if (!spare) break
      team.roster = team.roster.filter((id) => id !== spare.id)
      team.starters = team.starters.filter((id) => id !== spare.id)
      recordLeave(state, spare)
      spare.teamId = null
    }
  }
  for (const team of Object.values(state.teams)) {
    team.starters = team.starters.filter((id) => team.roster.includes(id))
    if (team.starters.length < 5) team.starters = autoStarters(state, team.id)
  }
  if (moved) {
    state.news.push({ day: state.day, kind: 'transfer', text: `休赛期的转会市场：${moved} 名选手换了东家。` })
  }
  return true
}

/** a real retirement is likely in his last real season, unlikely while he really played on */
export function retirementPrior(state: GameState, p: Player): number {
  if (!HISTORY || !p.hkey || state.year > LAST_REAL_YEAR || !isHistoryCareer(state)) return 1
  const last = realLastYear(p.hkey)
  if (last === null) return 1
  if (last <= state.year) return 3
  return 0.25
}
