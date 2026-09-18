import { clamp } from './rng'
import type { Rng } from './rng'
import { ATTR_KEYS } from './types'
import type { Attrs, Player, Role, Stats } from './types'

/** The flat table: only a fallback for a player whose position is somehow unknown. */
export const ATTR_WEIGHT: Record<keyof Attrs, number> = {
  laning: 0.16, mechanics: 0.19, teamfight: 0.17, farming: 0.11,
  awareness: 0.14, clutch: 0.08, teamwork: 0.10, macro: 0.05,
}

/**
 * What each position is actually judged on. Mirrors ROLE_WEIGHT in
 * scripts/lol/build_world.py, which is where every player's opening rating
 * comes from — the two must be identical, or the first thing that recomputes
 * a player (training, ageing) quietly re-rates him on a different table.
 * scripts/check_role_weight.ts holds them together: build_world writes its
 * table into world.json's meta.roleWeight.
 *
 * 运营 carries little weight everywhere on purpose. A veteran whose hands
 * have gone is not an 85 because he reads the game; he is a 76 whose club
 * wins more after fifteen minutes while he is on the server — that is paid
 * out in the match engine, not in his rating.
 */
export const ROLE_WEIGHT: Record<Role, Record<keyof Attrs, number>> = {
  上单: { laning: 0.24, mechanics: 0.20, teamfight: 0.16, farming: 0.12,
    awareness: 0.10, clutch: 0.08, teamwork: 0.07, macro: 0.03 },
  打野: { laning: 0.10, mechanics: 0.16, teamfight: 0.18, farming: 0.08,
    awareness: 0.22, clutch: 0.08, teamwork: 0.12, macro: 0.06 },
  中单: { laning: 0.20, mechanics: 0.24, teamfight: 0.16, farming: 0.12,
    awareness: 0.10, clutch: 0.09, teamwork: 0.06, macro: 0.03 },
  下路: { laning: 0.16, mechanics: 0.26, teamfight: 0.18, farming: 0.18,
    awareness: 0.06, clutch: 0.09, teamwork: 0.05, macro: 0.02 },
  辅助: { laning: 0.12, mechanics: 0.08, teamfight: 0.16, farming: 0.06,
    awareness: 0.24, clutch: 0.06, teamwork: 0.20, macro: 0.08 },
}

/** The weights this player is judged on. */
export const weightsFor = (p: Pick<Player, 'role'>): Record<keyof Attrs, number> =>
  ROLE_WEIGHT[p.role] ?? ATTR_WEIGHT

export function recomputeOverall(p: Player): number {
  const w = weightsFor(p)
  let v = p.stageBonus ?? 0
  for (const k of ATTR_KEYS) v += p.attrs[k] * w[k]
  p.overall = Math.round(clamp(v, 30, 99))
  return p.overall
}

export function marketValue(p: Player): number {
  let v = 20000 * Math.exp((p.overall - 55) / 10.5)
  if (p.age <= 21) v *= 1.45
  else if (p.age <= 24) v *= 1.15
  else if (p.age >= 28) v *= 0.55
  else if (p.age >= 26) v *= 0.8
  v *= 1 + (p.potential - p.overall) / 100
  // form and morale move the asking price around the edges
  v *= 1 + (p.form - 70) / 400
  return Math.round(v / 1000) * 1000
}

/**
 * What this player expects to be paid, per year.
 *
 * These two constants must stay identical to SALARY_BASE / TIER2_WAGE in
 * scripts/build_world.py — that is where a new world's wage bill comes from,
 * and this is what re-signing the same squad costs. See the note there for why
 * the base is 33000 rather than 15000.
 */
export const SALARY_BASE = 33000
export const TIER2_WAGE = 0.14

export function expectedSalary(p: Player, tier: 1 | 2): number {
  let base = SALARY_BASE * Math.exp((p.overall - 55) / 12)
  if (tier === 2) base *= TIER2_WAGE
  base *= 1 + (p.ambition - 60) / 320
  return Math.round(base / 1000) * 1000
}

export function refreshValue(p: Player): void {
  p.value = marketValue(p)
}

/**
 * Derived numbers used all over the UI.
 *
 * `rounds` in a stat block is MINUTES played (the field keeps its name from
 * the round-based shooter this engine came from), so everything here that
 * says "per round" is per minute: `adr` is damage per minute, `kpr` kills per
 * minute. `acs` is the composite rating on a 200-is-average scale, because
 * that is the scale the awards and the leaderboards already read.
 */
export function statLine(s: Stats) {
  const r = s.rounds || 1
  const m = s.maps || 1
  return {
    kd: s.deaths ? s.kills / s.deaths : s.kills,
    kda: (s.kills + s.assists) / Math.max(1, s.deaths),
    kpr: s.kills / r,
    dpr: s.deaths / r,
    apr: s.assists / r,
    adr: s.damage / r,
    acs: ratingOf(s) * 200,
    kills: s.kills,
    maps: s.maps,
    fkDiff: s.firstKills - s.firstDeaths,
    perMap: s.kills / m,
  }
}

export const AGE_PEAK = 24

/**
 * Yearly drift of ONE attribute at this age: above zero it can still grow over
 * the winter, below zero it fades.
 *
 * The abilities do not age together. Measured on 405 professionals with a
 * birthdate on record, as the same man's change from one season to the next
 * (docs/调研-选手数值与年龄曲线.md §2): 对线 peaks at twenty and falls every year
 * from twenty-two; 操作 and 发育 hold until twenty-four; 团战 a little later and
 * a little slower; 意识 is flat into the late twenties; 心态 and 运营 are bought
 * with games played and do not go with the hands. A veteran is a player whose
 * lane has gone and whose club still wins the second half of the game.
 *
 * The measured slopes carry regression to the mean (a standout year falls
 * back) and survivorship (only those kept are seen again), which pull in
 * opposite directions; the magnitudes below are set at roughly the measured
 * size and held by scripts/check_aging.ts.
 */
export function attrDrift(age: number, k: keyof Attrs): number {
  const curve = (steps: [number, number][]): number => {
    for (const [upTo, v] of steps) if (age <= upTo) return v
    return steps[steps.length - 1][1]
  }
  switch (k) {
    case 'laning': return curve([[19, 1.0], [20, 0.6], [21, 0.2], [25, -1.3], [28, -1.7], [99, -2.0]])
    case 'mechanics':
    case 'farming': return curve([[20, 1.0], [23, 0.4], [27, -1.4], [99, -1.8]])
    case 'teamfight': return curve([[20, 1.0], [23, 0.3], [27, -1.1], [99, -1.6]])
    case 'teamwork': return curve([[22, 0.8], [25, 0.3], [28, -0.4], [99, -0.9]])
    case 'awareness': return curve([[22, 1.0], [26, 0.4], [29, -0.2], [99, -0.7]])
    case 'clutch': return curve([[24, 0.6], [29, 0.25], [99, -0.3]])
    case 'macro': return curve([[24, 0.6], [30, 0.45], [99, 0]])
  }
}

/** The whole player's drift: growth for the young, decline for veterans. */
export function ageDrift(p: Player): number {
  if (p.age <= 21) return 1.0
  if (p.age <= 24) return 0.65
  if (p.age <= 26) return 0.3
  if (p.age <= 28) return -0.25
  if (p.age <= 30) return -0.9
  return -1.6
}

/** The role's colour as a CSS token, so it follows the page's ground: the
 *  yellow that reads on black is invisible on white, and styles.css holds a
 *  deepened set for the light themes. */
export const roleColor = (role: string): string =>
  ({
    上单: 'var(--duelist)', 打野: 'var(--initiator)', 中单: 'var(--controller)',
    下路: 'var(--sentinel)', 辅助: 'var(--flex)',
  })[role] ?? 'var(--flex)'

/**
 * A composite rating from the scoreboard, calibrated so an average starter
 * sits at about 1.00. Per minute: a professional takes about 0.087 kills and
 * deaths and 0.17 assists a minute (27.9 kills a game over 32.6 minutes).
 * Carries score above it and supports a little below, as they do on any
 * scoreboard; it does not know what position a man plays.
 */
export const ratingOf = (s: { kills: number; deaths: number; assists: number; rounds: number }) => {
  if (!s.rounds) return 0
  const kpm = s.kills / s.rounds
  const dpm = s.deaths / s.rounds
  const apm = s.assists / s.rounds
  return clamp(0.81 + kpm * 2.4 + apm * 0.9 - dpm * 2.0, 0, 3)
}

/**
 * How long a club ties a player down for, 1-4 years.
 *
 * The world file deals these out across a whole squad so a club's deals never
 * all run out together — see `deal_contract_years` in scripts/build_world.py.
 * Re-signings have to preserve that, and judgement alone does not: a club
 * would like to give its young talent four years and its veterans one, but
 * that preference drifts as a squad matures — everyone's ceiling closes in,
 * everyone starts looking like a one-year renewal, and four seasons later
 * forty clubs are back to a cliff (measured in scripts/check_contracts.ts).
 *
 * So the crowded years are avoided first and the preference only breaks ties.
 * A club that already has two deals ending in two years signs the next man for
 * three, which is what a real front office does and what keeps the stagger
 * alive however the squad ages.
 */
export function contractLength(p: Player, rng: Rng, squad: Player[] = []): number {
  // age leads, ceiling only nudges: a squad's remaining ceiling closes as it
  // matures, so a preference weighted on that alone slides towards one-year
  // deals for everybody. The league's age spread does not move — clubs keep
  // signing teenagers — so an age-led score keeps its shape season after season.
  const tie = Math.max(0, 27 - p.age) + (p.potential - p.overall) * 0.8
  const want = tie >= 14.2 ? 4 : tie >= 10 ? 3 : tie >= 6 ? 2 : 1
  let best = want
  let bestCost = Infinity
  for (const y of [1, 2, 3, 4]) {
    const crowd = squad.filter((q) => q.id !== p.id && q.contractYears === y).length
    // crowding outweighs preference by more than the widest preference gap,
    // so a club never stacks a third deal onto a year that already has two
    const cost = crowd * 4 + Math.abs(y - want) + rng.range(0, 0.6)
    if (cost < bestCost) {
      bestCost = cost
      best = y
    }
  }
  return best
}
