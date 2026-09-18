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
}

export const CHAMPIONS = (raw as unknown as { champions: Champion[] }).champions
const BY_ID = new Map(CHAMPIONS.map((c) => [c.id, c]))
export const championOf = (id: string): Champion | undefined => BY_ID.get(id)

/**
 * Champions by the position they are played in. A champion with two real
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

/** How contested a champion is in the opening season's drafts: picks plus bans. */
export const presence = (a: string): number => {
  const m = championOf(a)?.meta
  return m ? m.pick + m.ban : 0
}

/**
 * What the map is usually played with, most contested first — used to fill a
 * lineup automatically with something sensible and to tell the manager when a
 * hand-made pick is unusual. Read off the season's real drafts.
 */
export const MAP_META: Record<string, string[]> = {
  召唤师峡谷: CHAMPIONS.slice().sort((a, b) => presence(b.id) - presence(a.id)).map((c) => c.id),
}

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
