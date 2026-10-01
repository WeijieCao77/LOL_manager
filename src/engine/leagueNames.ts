/**
 * What each of the six tier-one leagues was called in a given year.
 *
 * The engine keeps today's six region keys all the way back (LEC is the line
 * EU LCS became, LCP the line LMS and PCS became), so a 2016 career runs on the
 * same machinery as a 2026 one. What the player reads is the name of the year
 * he is in: a 2016 career's EU LCS turns into the LEC when 2019 opens.
 */
import type { Region } from './types'

export function leagueLabel(year: number, region: Region): string {
  switch (region) {
    case 'LEC': return year < 2019 ? 'EU LCS' : 'LEC'
    case 'LCS': return year < 2019 ? 'NA LCS' : year === 2025 ? 'LTA North' : 'LCS'
    case 'LCP': return year < 2020 ? 'LMS' : year < 2025 ? 'PCS' : 'LCP'
    case 'CBLOL': return year === 2025 ? 'LTA South' : 'CBLOL'
    default: return region
  }
}

/** every name any of the six has gone by — for reading a title back */
export const ALL_LEAGUE_LABELS = ['LPL', 'LCK', 'LEC', 'EU LCS', 'LCS', 'NA LCS', 'LTA North', 'LTA South', 'LCP', 'LMS', 'PCS', 'CBLOL'] as const

/** a regional title, whatever the year called the league and its stages */
export const REGIONAL_TITLE = new RegExp(`^(${ALL_LEAGUE_LABELS.join('|')}) (第[一二三]赛段|春季赛|夏季赛)$`)
