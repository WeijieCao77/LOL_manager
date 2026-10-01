import type { Role } from './types'
import raw from '../data/champions.json'

/**
 * The map. There is one.
 *
 * VAL MANAGER, which this engine was built from, dealt seven maps a season and
 * let clubs veto them; everything that varied by map there (comfort, the
 * default five, drills) still runs here over a pool of one, so it is inert
 * rather than removed. What varies from game to game in this sport is the
 * draft, and that lives in comp.ts.
 */
export const MAPS = ['召唤师峡谷'] as const
export type GameMap = (typeof MAPS)[number]

/**
 * One champion as scripts/lol/build_champions.py read it off twelve years of
 * professional games. Nothing here is authored except the Chinese name.
 */
export interface Champion {
  id: string
  /** official Chinese name; null where it could not be confirmed, and the id shows instead */
  cn: string | null
  /** every position it is really played in (12% of its games or more), most common first */
  positions: Role[]
  /** first appearance in a professional game, YYYY-MM-DD — a career in an earlier year cannot pick it */
  since: string
  /** −1 snowballs early … +1 scales late: how much longer its wins run than its losses, and its gold at 15 */
  lean: number
  /** team-fighting lean: kill participation against its position's average */
  fight: number
  /** pick / ban / win rate in the major leagues in the world's opening season */
  meta: { pick: number; ban: number; win: number | null } | null
  /** every year's [pick, ban, win], by year */
  metaBy?: Record<string, [number, number, number | null]>
}

export const CHAMPIONS = (raw as unknown as { champions: Champion[] }).champions
const BY_ID = new Map(CHAMPIONS.map((c) => [c.id, c]))
export const championOf = (id: string): Champion | undefined => BY_ID.get(id)

/**
 * The champions, by the position they are played in. A champion with two real
 * positions is listed under both — 加里奥 is a mid laner and a top laner, and
 * a table that kept only one would charge a top laner for picking him.
 */
export const AGENTS: Record<Role, string[]> = { 上单: [], 打野: [], 中单: [], 下路: [], 辅助: [] }
for (const c of CHAMPIONS) for (const r of c.positions) AGENTS[r].push(c.id)

export const ALL_AGENTS = CHAMPIONS.map((c) => c.id).sort()

/** The single map's display name; kept as a function because every screen already calls it. */
export const MAP_CN: Record<string, string> = { 召唤师峡谷: '召唤师峡谷' }
export const mapCn = (m: string): string => MAP_CN[m] ?? m

/** Official Chinese champion names. The English id stays the key everywhere. */
export const AGENT_CN: Record<string, string> = Object.fromEntries(
  CHAMPIONS.filter((c) => c.cn).map((c) => [c.id, c.cn as string]),
)

/**
 * The champion's canonical id from whatever spelling the data carried —
 * "KaiSa", "Kai'Sa" and "kaisa" are one champion. Null for anything that is
 * not one.
 */
const squash = (a: string): string => String(a).toLowerCase().replace(/[^a-z0-9]/g, '')
const AGENT_BY_KEY = new Map(CHAMPIONS.map((c) => [squash(c.id), c.id]))
export const canonAgent = (a: string): string | null => AGENT_BY_KEY.get(squash(a)) ?? null
/** A pool cleaned the same way: canonical, deduplicated, junk dropped. */
export const canonAgents = (list: readonly string[]): string[] => {
  const out: string[] = []
  for (const a of list) {
    const c = canonAgent(a)
    if (c && !out.includes(c)) out.push(c)
  }
  return out
}

/** A champion as the manager reads it. */
export const agentCn = (a: string): string => AGENT_CN[a] ?? AGENT_CN[canonAgent(a) ?? ''] ?? a

/** The position a champion is mostly played in. `agentRoles` has all of them. */
export const AGENT_ROLE: Record<string, Role> = Object.fromEntries(
  CHAMPIONS.filter((c) => c.positions.length).map((c) => [c.id, c.positions[0]]),
) as Record<string, Role>
export const agentRoles = (a: string): Role[] => championOf(a)?.positions ?? []

/**
 * The year whose real drafts set the meta. A 2016 career drafts like 2016 did,
 * and the year after like 2017 — every year's pick and ban rates are in the
 * table (scripts/lol/build_champions.py). Set by the season clock
 * (season.ts advanceDay, world.ts createNewGame, save.ts on load).
 */
const META_YEARS = [...new Set(CHAMPIONS.flatMap((c) => Object.keys(c.metaBy ?? {})).map(Number))].sort((a, b) => a - b)
let metaYear = META_YEARS[META_YEARS.length - 1] ?? 2026
export function setMetaYear(year: number): void {
  // the nearest year with data, never ahead of the career
  const y = [...META_YEARS].reverse().find((x) => x <= year) ?? META_YEARS[0]
  if (y !== undefined) metaYear = y
}
export const currentMetaYear = (): number => metaYear

/** this year's real pick / ban / win rates for a champion */
export function metaOf(a: string): { pick: number; ban: number; win: number | null } | null {
  const c = championOf(a)
  const row = c?.metaBy?.[String(metaYear)]
  if (row) return { pick: row[0], ban: row[1], win: row[2] }
  return c?.meta ?? null
}

/** How contested a champion is in this year's drafts: picks plus bans. */
export const presence = (a: string): number => {
  const m = metaOf(a)
  return m ? m.pick + m.ban : 0
}

/**
 * 版本热门: picked or banned in at least a tenth of the season's real games
 * (68 of 173 in 2026). The plan screen lists these first with their numbers, the
 * way VAL MANAGER's lists each map's pro picks with how often they are run.
 */
export const HOT_PRESENCE = 0.1
export const hotChampions = (): string[] =>
  CHAMPIONS.filter((c) => presence(c.id) >= HOT_PRESENCE).sort((a, b) => presence(b.id) - presence(a.id)).map((c) => c.id)

/** 「选 12% · 禁 30%」 — this season's real draft numbers for a champion, or '' */
export const draftLine = (a: string): string => {
  const m = metaOf(a)
  if (!m) return ''
  const pct = (x: number) => `${Math.round(x * 100)}%`
  return m.ban >= 0.01 ? `选 ${pct(m.pick)} · 禁 ${pct(m.ban)}` : `选 ${pct(m.pick)}`
}

/**
 * What the map is usually played with, most contested first — used to fill a
 * lineup automatically with something sensible and to tell the manager when a
 * hand-made pick is unusual. Read off the season's real drafts.
 */
export const MAP_META: Record<string, string[]> = {}
// read through a getter, so it is always the meta of the year the career is in
const metaOrder = new Map<number, string[]>()
Object.defineProperty(MAP_META, '召唤师峡谷', {
  enumerable: true,
  get: () => {
    if (!metaOrder.has(metaYear)) metaOrder.set(metaYear, CHAMPIONS.slice().sort((a, b) => presence(b.id) - presence(a.id)).map((c) => c.id))
    return metaOrder.get(metaYear)!
  },
})

export const SPONSOR_NAMES = [
  'Hyperion Energy', 'Nexon Peripherals', 'Vertex Bank', 'Kaido Motors', 'BitStream',
  'Solaris Airlines', 'RedShift Gaming', 'Momentum Apparel', 'Auralink Audio', 'ZenCore PC',
  'Northgate Telecom', 'PulseWear', 'Fortis Insurance', 'Skyline Beverages',
]

/** Flavour lines used by the round narrator. */
export const HIGHLIGHT_TEMPLATES = {
  ace: (p: string, m: string) => `${p} 在 ${m} 拿下五杀。`,
  quad: (p: string) => `${p} 一波团战带走四个，对面直接崩了。`,
  clutch: (p: string, n: number) =>
    n >= 3 ? `${p} 一打${n}，把这波团战抢了回来。`
      : `${p} 残血反杀，稳稳收下这一波。`,
  firstBlood: (p: string, n: number) => `${p} 连续 ${n} 次拿下首杀。`,
  eco: (t: string) => `${t} 前期连续拿到资源，把经济拉开。`,
  antiEco: (t: string, o: string) => `${t} 落后时打赢了 ${o} 的正面团，局势反转。`,
  flawless: (t: string) => `${t} 零换五。`,
  streak: (t: string, n: number) => `${t} 连赢 ${n} 波，把差距彻底拉开。`,
  comeback: (t: string, from: number) => `${t} 前期只拿到 ${from} 分，后面追了回来。`,
  mapPoint: (t: string) => `${t} 在高地上守住了一波。`,
  overtime: () => `双方僵持，比赛进入大后期。`,
}

export const INJURIES = [
  { note: '手腕劳损', days: [5, 14] },
  { note: '腱鞘炎复发', days: [7, 18] },
  { note: '颈椎不适', days: [4, 10] },
  { note: '腰伤', days: [6, 16] },
  { note: '重感冒', days: [2, 6] },
  { note: '心理疲劳 / 需要休息', days: [5, 12] },
]
