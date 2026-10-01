/**
 * Starting a career in a past season — the 历史生涯档.
 *
 * A save has always begun in 2026 from world.json. A historical save begins
 * in January of an earlier year from world_<year>.json (built by
 * scripts/build_world_year.py: the rosters that played that year's opening
 * events, rated on the seasons before), and from there the engine simulates
 * — the setup is real history, what happens next is the manager's. What a
 * year changes beyond its world:
 *
 *   - the calendar's names: the real host cities for that year's 国际赛
 *     and 全球总决赛 (REAL_HOSTS) rather than the seeded rotation
 *   - which agents exist: an agent released after the game date is not on
 *     any map plan, drill or auto-pick until its patch lands (AGENT_SINCE),
 *     and lands with a news line when it does
 *   - the career's own clock: 五年之约 and the ten-year run count from the
 *     start year, not from 2026
 *   - the rulebook: the classic vct-2025 flow, which is the 2024–2025
 *     circuit's shape (第一赛段, two stages, two 国际赛, 全球总决赛)
 *
 * The world files are loaded on demand — they are a quarter megabyte each
 * and only a historical start needs one.
 */
import { CHAMPIONS } from './content'
import type { RawTeam } from './teams'
import type { RawPlayer } from './world'

/**
 * The past seasons a career can start in: 2016 (S6) and 2022 (S12), each rated
 * on the matches before it by scripts/lol/build_world.py --year Y --history.
 * After its first day the world follows history where the manager leaves it
 * alone (engine/realHistory.ts).
 */
export const HISTORICAL_YEARS: readonly number[] = [2016, 2022]
export type StartYear = number
export const DEFAULT_START_YEAR = 2026

export interface RawWorld {
  meta: { season: number; historical?: boolean; openingEvents?: string[]; tier2?: string }
  teams: RawTeam[]
  players: RawPlayer[]
}

export async function loadWorld(year: number): Promise<RawWorld | null> {
  // the real years a historical career grows into come with its world
  const { ensureHistory } = await import('./realHistory')
  await ensureHistory()
  if (year === 2016) return (await import('../data/world_2016.json')).default as unknown as RawWorld
  if (year === 2022) return (await import('../data/world_2022.json')).default as unknown as RawWorld
  return null
}

export const startYearOf = (s: { startYear?: number }): number => s.startYear ?? DEFAULT_START_YEAR

/** the seasons a career has run, the first counting as one */
export const seasonsOf = (s: { year: number; startYear?: number }): number => s.year - startYearOf(s) + 1

/** 五年之约 falls after the fifth season, the story ends after the tenth */
export const midYearOf = (s: { startYear?: number }): number => startYearOf(s) + 4
export const finalYearOf = (s: { startYear?: number }): number => startYearOf(s) + 10

export const ERA_CN: Record<number, string> = {
  2016: 'S6 · 2016 赛季起',
  2022: 'S12 · 2022 赛季起',
  2026: '2026 赛季起',
}

/**
 * Where the internationals were actually played. First Stand is the first
 * 国际赛 of the year, MSI 季中冠军赛 the second, then 全球总决赛. 2023 had one
 * 国际赛 (Tokyo) after LOCK//IN; it is listed for the day a 2023 start exists.
 */
export const REAL_HOSTS: Record<number, { masters1: string; masters2: string; champions: string }> = {
  // MSI and the Worlds final, where they were really played (2020's MSI was cancelled: the mid-season cup was online)
  2016: { masters1: '—', masters2: '上海', champions: '洛杉矶' },
  2017: { masters1: '—', masters2: '里约热内卢', champions: '北京' },
  2018: { masters1: '—', masters2: '巴黎', champions: '仁川' },
  2019: { masters1: '—', masters2: '台北', champions: '巴黎' },
  2020: { masters1: '—', masters2: '线上', champions: '上海' },
  2021: { masters1: '—', masters2: '雷克雅未克', champions: '雷克雅未克' },
  2022: { masters1: '—', masters2: '釜山', champions: '旧金山' },
  2023: { masters1: '—', masters2: '伦敦', champions: '首尔' },
  2024: { masters1: '—', masters2: '成都', champions: '伦敦' },
  2025: { masters1: '首尔', masters2: '温哥华', champions: '成都' },
  // First Stand São Paulo, MSI Daejeon, Worlds in North America (final at Barclays Center)
  2026: { masters1: '圣保罗', masters2: '大田', champions: '纽约' },
}

/**
 * When each agent joined the game, year and month of the patch. Agents not
 * listed have been in since before any world this game can start in
 * (2022). Veto and Miks are bounded by the event tables rather than a patch
 * note — neither appears in any 2025 event, Veto first at the 2026
 * 第一赛段, Miks in mid-2026 — so their months are the earliest consistent
 * with that; scripts/check_history_world.ts holds every entry against the
 * first competitive appearance in the cache.
 */
export const AGENT_SINCE: Record<string, [number, number]> = Object.fromEntries(
  CHAMPIONS.map((c) => [c.id, [Number(c.since.slice(0, 4)), Number(c.since.slice(5, 7))] as [number, number]]),
)

const monthOf = (s: { year: number; day: number }): number => {
  const d = new Date(Date.UTC(s.year, 0, 1))
  d.setUTCDate(d.getUTCDate() + s.day)
  return d.getUTCMonth() + 1
}

/** is this agent in the game on this game date */
export function agentAvailable(s: { year: number; day: number }, agent: string): boolean {
  const since = AGENT_SINCE[agent]
  if (!since) return true
  // Asked for every champion, thousands of times a simulated day. Nearly all
  // of them shipped in an earlier year, which the year alone answers; only one
  // released in the current year needs the calendar, and building a Date for
  // all 173 was what made a season take ten minutes instead of ten seconds.
  if (s.year !== since[0]) return s.year > since[0]
  return monthOf(s) >= since[1]
}

/** the agents released on this very game day's month start — for the news line */
export function agentsReleasedToday(s: { year: number; day: number }): string[] {
  const d = new Date(Date.UTC(s.year, 0, 1))
  d.setUTCDate(d.getUTCDate() + s.day)
  if (d.getUTCDate() !== 1) return []
  const m = d.getUTCMonth() + 1
  return Object.entries(AGENT_SINCE).filter(([, [y, mm]]) => y === s.year && mm === m).map(([a]) => a)
}

/**
 * When each map shipped, from Liquipedia's map pages. A map not listed was in
 * the game before any world this game can start in.
 */
export const MAP_SINCE: Record<string, string> = {}

/**
 * The competitive pool Riot actually ran in 2023–2025, from each date on: the
 * map lists of that year's events on Liquipedia, and the rotations their
 * pages date — Bind for Icebox from week 5 of the 2023 leagues, Haven for
 * Breeze in week 2 of 2024 第三赛段 and Abyss for Split at its playoffs. The
 * first entry is the 2022 全球总决赛 pool, which held until Lotus shipped.
 * Other years have no table and keep the dealt pool (match.activePool).
 */
export const REAL_POOLS: [string, string[]][] = []

const isoOf = (s: { year: number; day: number }): string => {
  const d = new Date(Date.UTC(s.year, 0, 1))
  d.setUTCDate(d.getUTCDate() + s.day)
  return d.toISOString().slice(0, 10)
}

/** the real pool on this game date, or null for a year without a table */
export function realPool(s: { year: number; day: number }): string[] | null {
  if (!REAL_POOLS.length) return null
  const iso = isoOf(s)
  let pool: string[] | null = null
  for (const [from, maps] of REAL_POOLS) if (from <= iso) pool = maps
  return pool && pool.slice()
}

/** is this map in the game on this game date */
export const mapReleased = (s: { year: number; day: number }, map: string): boolean =>
  !MAP_SINCE[map] || isoOf(s) >= MAP_SINCE[map]
