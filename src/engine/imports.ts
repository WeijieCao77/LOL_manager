/**
 * The optional import rule: at most two players from outside a club's region.
 *
 * Left to itself the market globalises — managers stack a squad with the best
 * of four regions, and so does the AI, which is nothing like the circuit this
 * game is modelled on. With `state.importLimit` on, every club, the player's
 * and the AI's alike, may hold at most IMPORT_MAX players whose nationality
 * belongs to another region, bench included.
 *
 * Origin is the player's competitive RESIDENCY where Leaguepedia records one —
 * that is the thing the real rule is written on, and it is not nationality:
 * Rookie is Korean and an LPL resident since December 2021. Nationality stands
 * in where residency is not on record, and the `region` field after that. A
 * player with neither counts as native: an import rule should punish
 * squad-building, never missing data. And the rule gates ACQUISITIONS only.
 *
 * The real rule caps the STARTING five, not the roster (a third import may
 * sit on the bench). This one still counts the roster, which is slightly
 * stricter; moving it to the lineup is on the list.
 * A squad already over the limit when the rule turns on keeps its players —
 * renewals are retention, not recruitment — it simply cannot add more.
 */
import { REGION_CN } from './types'
import type { GameState, Player, Region, Team } from './types'

export const IMPORT_MAX = 2

/**
 * Which region a nationality belongs to, for players whose residency is not on
 * record. Follows Riot's competitive regions as of 2026 (docs/调研-外援名额与居民规则.md):
 * Hong Kong and Macao count with China; Taiwan, Vietnam, Japan, South-East Asia
 * and Oceania are Asia-Pacific; Turkey, the CIS and MENA are EMEA since 2023;
 * Latin America plays in the Brazilian conference's ecosystem.
 */
export const NAT_REGION: Record<string, Region> = {
  cn: 'LPL', hk: 'LPL', mo: 'LPL',
  kr: 'LCK',
  tw: 'LCP', vn: 'LCP', jp: 'LCP', ph: 'LCP', sg: 'LCP', my: 'LCP', th: 'LCP', id: 'LCP', au: 'LCP', nz: 'LCP',
  us: 'LCS', ca: 'LCS',
  br: 'CBLOL', ar: 'CBLOL', cl: 'CBLOL', mx: 'CBLOL', pe: 'CBLOL', co: 'CBLOL', uy: 'CBLOL', do: 'CBLOL',
  ec: 'CBLOL', ve: 'CBLOL', cr: 'CBLOL', py: 'CBLOL', bo: 'CBLOL',
  gb: 'LEC', ie: 'LEC', fr: 'LEC', de: 'LEC', es: 'LEC', pt: 'LEC', it: 'LEC', nl: 'LEC', be: 'LEC', ch: 'LEC',
  at: 'LEC', dk: 'LEC', se: 'LEC', no: 'LEC', fi: 'LEC', is: 'LEC', pl: 'LEC', cz: 'LEC', sk: 'LEC', hu: 'LEC',
  ro: 'LEC', bg: 'LEC', gr: 'LEC', si: 'LEC', hr: 'LEC', rs: 'LEC', ba: 'LEC', mk: 'LEC', lt: 'LEC', lv: 'LEC',
  ee: 'LEC', ua: 'LEC', ru: 'LEC', kz: 'LEC', am: 'LEC', tr: 'LEC', il: 'LEC', ma: 'LEC', eg: 'LEC', sa: 'LEC',
}

/**
 * The region a player is from.
 *
 * Nationality decides when it is on record. When it is not, the player's own
 * `region` field stands in — it is set once when the world is built (from
 * nationality where known, else from the club that employed him) and no
 * transfer ever rewrites it, so it is where he entered the world. This keeps
 * the rule consistent with the screen: jakee carries no nationality but his
 * card says 美洲, and a rule that quietly called him native while the UI
 * called him American was answering a different question than it displayed.
 * A world-built squad member has region equal to his club's, so grandfathering
 * is untouched.
 */
export const originOf = (p: Player): Region =>
  p.residency ?? NAT_REGION[(p.nat ?? '').toLowerCase()] ?? p.region

/** Is this player an import for this club? */
export const isImport = (p: Player, team: Team): boolean =>
  originOf(p) !== team.region

/** How many imports a club currently holds, bench included. */
export const importCount = (state: GameState, teamId: string): number => {
  const team = state.teams[teamId]
  if (!team) return 0
  return team.roster.reduce((n, id) => {
    const p = state.players[id]
    return p && isImport(p, team) ? n + 1 : n
  }, 0)
}

/**
 * May this club take this player on? Null when it may; the reason when not.
 *
 * With the rule off, always yes. With it on, a native always fits, and an
 * import fits while the club holds fewer than IMPORT_MAX of them.
 */
export function importBlock(state: GameState, teamId: string, p: Player): string | null {
  if (!state.importLimit) return null
  const team = state.teams[teamId]
  if (!team || !isImport(p, team)) return null
  if (importCount(state, teamId) < IMPORT_MAX) return null
  return teamId === state.myTeam
    ? `外援名额已满（${IMPORT_MAX}/${IMPORT_MAX}），${p.ign} 来自${regionCn(originOf(p))}赛区，先放走一名外援才能签。`
    : `${team.name} 的外援名额已满。`
}

const regionCn = (r: Region): string =>
  REGION_CN[r]
