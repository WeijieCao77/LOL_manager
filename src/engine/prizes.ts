/**
 * Prize money as League really paid it (决定 D77).
 *
 * The table this replaces was VALORANT's, raised after a "赚不到钱" week: every
 * region's split paid its champion $380k. League's regional money is smaller
 * and very uneven — an LCP split's whole pool is $80k, CBLOL's Cup $20k,
 * while an LPL Split 3 champion takes CNY 1.7M — and its clubs live on
 * sponsors and the league's revenue share, which is where this game's
 * stipend sits (leagueShare.ts). The internationals are the big money.
 *
 * Every pool below is the Liquipedia infobox figure for that event
 * (data-raw/lol/formats_2016/2022/2026.json, read 2026-10-01), converted to
 * USD at one approximate annual rate per currency and era (FX). Where the
 * page has no figure (待查 in docs/调研-*), the same league's nearest known
 * year stands in and the row says so. How a pool is split across places is
 * known for a few events and used for all of its kind:
 *   regional      — LPL 2026 Split 3: 42.5 / 25 / 15 / 7.5 / 5 / 5 %
 *   Worlds        — Worlds 2016: 40 / 15 / 7.5 ×2 / 4 ×4 / 2.25 ×4 / 1.25 ×4 %
 *   MSI, FST      — MSI 2022: 30 / 20 / 10 ×2 / 7 ×2 / 3.33 ×2 / 2.67 ×2 / 1 %
 *                   (MSI 2016 as paid: 250k / 100k / 50k ×2)
 */
import type { Competition, GameState, Region } from './types'
import { eraOf } from './programsHist'

/** approximate annual averages: CNY, KRW, BRL, TWD in units per US dollar; EUR in US dollars per euro */
const FX = {
  CNY: { 2016: 6.64, 2022: 6.73, 2026: 7.1 },
  KRW: { 2016: 1160, 2022: 1290, 2026: 1400 },
  BRL: { 2016: 3.48, 2022: 5.16, 2026: 5.5 },
  TWD: { 2016: 32.3, 2022: 32.3, 2026: 32.3 },   // only LMS 2016 is paid in TWD
  EUR: { 2016: 1.11, 2022: 1.05, 2026: 1.1 },
} as const
type Era = 2016 | 2022 | 2026
const usd = (amount: number, cur: keyof typeof FX | 'USD', era: Era): number =>
  cur === 'USD' ? amount : cur === 'EUR' ? amount * FX.EUR[era] : amount / FX[cur][era]

type Slot = 'kickoff' | 'stage1' | 'stage2' | 'challengers1' | 'challengers2'
type Pool = [number, keyof typeof FX | 'USD']

/** per era, region and slot: the pool in its own currency */
const POOLS: Record<Era, Partial<Record<Region, Partial<Record<Slot, Pool>>>>> = {
  2016: {
    LPL: { stage1: [3_500_000, 'CNY'], stage2: [3_500_000, 'CNY'], challengers1: [600_000, 'CNY'], challengers2: [600_000, 'CNY'] },
    LCK: { stage1: [275_000_000, 'KRW'], stage2: [275_000_000, 'KRW'], challengers1: [60_000_000, 'KRW'], challengers2: [60_000_000, 'KRW'] },
    LEC: { stage1: [100_000, 'USD'], stage2: [100_000, 'USD'], challengers1: [22_500, 'EUR'], challengers2: [22_500, 'EUR'] },
    LCS: { stage1: [100_000, 'USD'], stage2: [100_000, 'USD'], challengers1: [21_000, 'USD'], challengers2: [21_000, 'USD'] },
    LCP: { stage1: [3_000_000, 'TWD'], stage2: [3_000_000, 'TWD'] },
    CBLOL: { stage1: [150_000, 'BRL'], stage2: [160_000, 'BRL'] },
  },
  2022: {
    LPL: { stage1: [4_200_000, 'CNY'], stage2: [4_200_000, 'CNY'], challengers1: [800_000, 'CNY'], challengers2: [800_000, 'CNY'] },
    LCK: { stage1: [375_000_000, 'KRW'], stage2: [375_000_000, 'KRW'], challengers1: [80_000_000, 'KRW'], challengers2: [80_000_000, 'KRW'] },
    LEC: { stage1: [200_000, 'EUR'], stage2: [200_000, 'EUR'], challengers1: [20_000, 'EUR'], challengers2: [20_000, 'EUR'] },
    // NACL's 2026 figure: the 2022 second tier has none on record
    LCS: { stage1: [200_000, 'USD'], stage2: [200_000, 'USD'], challengers1: [40_000, 'USD'], challengers2: [40_000, 'USD'] },
    // PCS 2022 has no figure on record: LCP 2026's
    LCP: { stage1: [80_000, 'USD'], stage2: [80_000, 'USD'] },
    CBLOL: { stage1: [400_000, 'BRL'], stage2: [400_000, 'BRL'], challengers1: [100_000, 'BRL'], challengers2: [100_000, 'BRL'] },
  },
  2026: {
    LPL: { kickoff: [1_600_000, 'CNY'], stage1: [2_800_000, 'CNY'], stage2: [4_000_000, 'CNY'] },
    // LCK, LEC, LCS 2026 have no figure on record: their 2022 splits stand in
    LCK: { kickoff: [375_000_000, 'KRW'], stage1: [375_000_000, 'KRW'], stage2: [375_000_000, 'KRW'],
      // LCK CL 2026: 87.5M for the year, 10M of it the Kickoff — the rest over the two halves
      challengers1: [38_750_000, 'KRW'], challengers2: [38_750_000, 'KRW'] },
    LEC: { kickoff: [200_000, 'EUR'], stage1: [200_000, 'EUR'], stage2: [200_000, 'EUR'],
      // LFL 2026 has none on record: LFL 2022's
      challengers1: [20_000, 'EUR'], challengers2: [20_000, 'EUR'] },
    LCS: { kickoff: [200_000, 'USD'], stage1: [200_000, 'USD'], stage2: [200_000, 'USD'], challengers1: [40_000, 'USD'], challengers2: [40_000, 'USD'] },
    // the PCS (LCP's second tier) has no figure on record: NACL's, the nearest second tier that has one
    LCP: { kickoff: [80_000, 'USD'], stage1: [80_000, 'USD'], stage2: [80_000, 'USD'], challengers1: [40_000, 'USD'], challengers2: [40_000, 'USD'] },
    // Circuito Desafiante 2026 has none: CBLOL Academy 2022's
    CBLOL: { kickoff: [20_000, 'USD'], stage1: [60_000, 'USD'], stage2: [60_000, 'USD'], challengers1: [100_000, 'BRL'], challengers2: [100_000, 'BRL'] },
  },
}

const INTL: Record<Era, Partial<Record<'masters1' | 'masters2' | 'champions', number>>> = {
  2016: { masters2: 450_000, champions: 5_070_000 },
  2022: { masters2: 250_000, champions: 2_225_000 },
  2026: { masters1: 1_000_000, masters2: 2_000_000, champions: 5_000_000 },
}

const REGIONAL_SHARE = [0.425, 0.25, 0.15, 0.075, 0.05, 0.05]
const WORLDS_SHARE = [0.4, 0.15, 0.075, 0.075, 0.04, 0.04, 0.04, 0.04, 0.0225, 0.0225, 0.0225, 0.0225, 0.0125, 0.0125, 0.0125, 0.0125]
const MSI_SHARE = [0.3, 0.2, 0.1, 0.1, 0.07, 0.07, 0.0333, 0.0333, 0.0267, 0.0267, 0.01]
const MSI_2016_SHARE = [250 / 450, 100 / 450, 50 / 450, 50 / 450]

export const PRIZE_SOURCE = 'Liquipedia 各赛事奖金（2016 / 2022 / 2026），按年均汇率折美元；缺的用同联赛最近一年'

/** What each place of a competition pays, in USD, first place first. Empty for a qualifier. */
export function prizeTable(state: Pick<GameState, 'year'>, comp: Pick<Competition, 'stage' | 'region' | 'minor'>): number[] {
  if (comp.minor) return []
  const era = eraOf(state.year)
  const stage = comp.stage as string
  if (stage === 'masters1' || stage === 'masters2' || stage === 'champions') {
    const pool = INTL[era][stage]
    if (!pool) return []
    const share = stage === 'champions' ? WORLDS_SHARE : era === 2016 ? MSI_2016_SHARE : MSI_SHARE
    return share.map((s) => Math.round(pool * s))
  }
  const row = comp.region ? POOLS[era][comp.region as Region]?.[stage as Slot] : undefined
  if (!row) return []
  const pool = usd(row[0], row[1], era)
  return REGIONAL_SHARE.map((s) => Math.round(pool * s))
}
