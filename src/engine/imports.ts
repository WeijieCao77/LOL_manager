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
import { currentMetaYear } from './content'
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

/**
 * Is this player an import for this club? Two regional facts on top of origin
 * (docs/调研-外援名额与居民规则.md §三):
 *   - Hong Kong and Macao players may register in China or in LMS / PCS, and
 *     switch freely: native to both.
 *   - Oceania's league closed in 2020; from 2021 its players are North
 *     American residents (those who had played the PCS may choose it): native
 *     to LCS and LCP.
 * The year is the game's (content.ts keeps it); a career's rules follow it.
 */
export const isImport = (p: Player, team: Team): boolean => {
  const origin = originOf(p)
  if (origin === team.region) return false
  const nat = (p.nat ?? '').toLowerCase()
  if ((nat === 'hk' || nat === 'mo') && (team.region === 'LPL' || team.region === 'LCP')) return false
  if ((nat === 'au' || nat === 'nz') && currentMetaYear() >= 2021 && (team.region === 'LCS' || team.region === 'LCP')) return false
  return true
}

/**
 * From 2025 (LTA), one player from anywhere in the Americas counts as local in
 * the Americas' leagues. Documented for 2025; 2026's LCS and CBLOL field
 * rosters that need it (Shopify Rebellion: two Koreans and a Brazilian), so
 * it is taken to stand.
 */
const americasPass = (team: Team, imports: Player[]): number =>
  currentMetaYear() >= 2025 && (team.region === 'LCS' || team.region === 'CBLOL')
    && imports.some((p) => originOf(p) === 'LCS' || originOf(p) === 'CBLOL') ? 1 : 0

/** How many imports a club currently holds, bench included. */
export const importCount = (state: GameState, teamId: string): number => {
  const team = state.teams[teamId]
  if (!team) return 0
  const imports = team.roster.map((id) => state.players[id]).filter((p): p is Player => !!p && isImport(p, team))
  return imports.length - americasPass(team, imports)
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

// ------------------------------------------------------------ the starting five

/**
 * The real rule (docs/调研-外援名额与居民规则.md §一, Riot 2014 onwards): at most
 * two non-residents in the STARTING five. A third may sit on the bench; he
 * cannot play at the same time as the other two. Always on, for every club —
 * the roster cap above is an optional, stricter house rule on top.
 */
export const STARTER_IMPORT_MAX = 2

export const importsIn = (team: Team, five: Player[]): number => {
  const imports = five.filter((p) => isImport(p, team))
  return imports.length - americasPass(team, imports)
}

/**
 * A five made legal: while it fields more than two imports, the weakest import
 * whose place a resident on the bench can take goes out — a resident of the
 * same position first, else the best resident there is. With no resident to
 * bring in the five stays as it is (a club must field somebody).
 */
/** what playing a man out of position costs, in rating points, when choosing whom to bench */
const ROLE_HOLE = 15

export function legalFive(team: Team, five: Player[], bench: Player[], rate: (p: Player) => number): Player[] {
  const out = five.slice()
  const natives = bench.filter((p) => !out.includes(p) && !isImport(p, team)).sort((a, b) => rate(b) - rate(a))
  while (importsIn(team, out) > STARTER_IMPORT_MAX && natives.length) {
    // only a man whose leaving lowers the count (not the one the Americas pass already covers)
    const cur = importsIn(team, out)
    const imports = out.filter((p) => isImport(p, team) && importsIn(team, out.filter((x) => x !== p)) < cur).sort((a, b) => rate(a) - rate(b))
    if (!imports.length) break
    // the swap that costs least: each import against his best replacement, a
    // resident of his own position counted at full value, anyone else at a
    // position's worth less (a hole in the five costs more than a few points)
    let best: { drop: Player; inn: Player; loss: number } | null = null
    for (const drop of imports) {
      const inn = natives.find((n) => n.role === drop.role) ?? natives[0]
      const loss = rate(drop) - rate(inn) + (inn.role === drop.role ? 0 : ROLE_HOLE)
      if (!best || loss < best.loss) best = { drop, inn, loss }
    }
    out[out.indexOf(best!.drop)] = best!.inn
    natives.splice(natives.indexOf(best!.inn), 1)
  }
  return out
}

/** Why this five may not start together, or null when it may. */
export function fiveBlock(team: Team, five: Player[]): string | null {
  const n = importsIn(team, five)
  return n > STARTER_IMPORT_MAX
    ? `首发最多 ${STARTER_IMPORT_MAX} 名外援（非本赛区居民），现在是 ${n} 名：${five.filter((p) => isImport(p, team)).map((p) => p.ign).join('、')}${americasPass(team, five.filter((p) => isImport(p, team))) ? '（其中一名美洲选手按本土算）' : ''}。`
    : null
}

/**
 * Would an AI club be buying a man it can field? A third import can only sit
 * behind the other two (the starters rule), so a club that already holds two
 * does not shop for another — real clubs do not buy a star to bench him.
 */
export const aiCanField = (state: GameState, teamId: string, p: Player): boolean => {
  const team = state.teams[teamId]
  return !team || !isImport(p, team) || importCount(state, teamId) < STARTER_IMPORT_MAX
}
