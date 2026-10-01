/**
 * The 2026 League year, region by region (docs/调研-2026赛制.md).
 *
 * Each tier-one region's three stages and the three internationals are written
 * as programs for engine/formats.ts. They sit in the engine's six slots: 第一 /
 * 第二 / 第三赛段 are each region's own three stages (LPL Split 1–3; LCK Cup,
 * Rounds 1-2 + Road to MSI, Rounds 3-4 + Playoffs; LEC Versus / Spring / Summer;
 * LCS Lock-In / Spring / Summer; LCP Split 1–3; CBLOL Cup / Split 1 / Split 2),
 * and First Stand, MSI and Worlds where the old internationals were.
 *
 * Days are days of the year, from the real 2026 calendar. Where the source does
 * not say (待查 in the research), the plainest reading is used and marked
 * 「近似」 here: who meets whom in a play-in round, how a tie on group points in
 * LCK Cup is broken, which way round a pick is made.
 */
import { pickWeakest, L, S, W } from './formats'
import type { Ctx, Program, Template } from './formats'
import type { Competition, GameState, Region } from './types'

// ------------------------------------------------------------ templates

const UB1 = '胜者组第一轮', UB2 = '胜者组第二轮', UBSF = '胜者组半决赛', UBF = '胜者组决赛'
const LB1 = '败者组第一轮', LB2 = '败者组第二轮', LB3 = '败者组第三轮', LBSF = '败者组半决赛', LBF = '败者组决赛'
const GF = '总决赛'

/** Eight, 1v8 / 4v5 / 2v7 / 3v6. `early` is the best-of for the first two rounds. */
export const de8 = (early?: 1 | 3 | 5): Template => ({
  waves: [
    [{ name: UB1, slots: [{ a: S(1), b: S(8), bo: early }, { a: S(4), b: S(5), bo: early }, { a: S(2), b: S(7), bo: early }, { a: S(3), b: S(6), bo: early }] }],
    [
      { name: UB2, slots: [{ a: W(UB1, 0), b: W(UB1, 1), bo: early }, { a: W(UB1, 2), b: W(UB1, 3), bo: early }] },
      { name: LB1, slots: [{ a: L(UB1, 0), b: L(UB1, 1), bo: early }, { a: L(UB1, 2), b: L(UB1, 3), bo: early }] },
    ],
    [
      { name: UBF, slots: [{ a: W(UB2, 0), b: W(UB2, 1) }] },
      { name: LB2, slots: [{ a: W(LB1, 0), b: L(UB2, 1) }, { a: W(LB1, 1), b: L(UB2, 0) }] },
    ],
    [{ name: LBSF, slots: [{ a: W(LB2, 0), b: W(LB2, 1) }] }],
    [{ name: LBF, slots: [{ a: W(LBSF), b: L(UBF) }] }],
    [{ name: GF, slots: [{ a: W(UBF), b: W(LBF) }] }],
  ],
  places: [W(GF), L(GF), L(LBF), L(LBSF), L(LB2, 0), L(LB2, 1), L(LB1, 0), L(LB1, 1)],
})

/**
 * Six, the top two waiting in the second round (LCK, LCP, CBLOL, LCS Summer).
 * LCK's lower bracket as written: the lower-seeded upper-round-two loser drops
 * in first, the higher one a round later. `early` is the best-of for the upper
 * bracket's first two rounds (CBLOL Cup plays them best of three).
 */
export const de6Byes = (early?: 1 | 3 | 5): Template => ({
  waves: [
    [{ name: UB1, slots: [{ a: S(3), b: S(6), bo: early }, { a: S(4), b: S(5), bo: early }] }],
    [
      { name: UB2, slots: [{ a: S(1), b: W(UB1, 1), bo: early }, { a: S(2), b: W(UB1, 0), bo: early }] },
      { name: LB1, slots: [{ a: L(UB1, 0), b: L(UB1, 1) }] },
    ],
    [
      { name: UBF, slots: [{ a: W(UB2, 0), b: W(UB2, 1) }] },
      { name: LB2, slots: [{ a: W(LB1), b: L(UB2, 1) }] },
    ],
    [{ name: LB3, slots: [{ a: W(LB2), b: L(UB2, 0) }] }],
    [{ name: LBF, slots: [{ a: W(LB3), b: L(UBF) }] }],
    [{ name: GF, slots: [{ a: W(UBF), b: W(LBF) }] }],
  ],
  places: [W(GF), L(GF), L(LBF), L(LB3), L(LB2), L(LB1)],
})

/** Six, the top four in the upper semi-finals and five and six in the lower bracket (LEC, LCS Spring and Lock-In). */
export const de6Top4: Template = {
  waves: [
    [{ name: UBSF, slots: [{ a: S(1), b: S(4) }, { a: S(2), b: S(3) }] }],
    [
      { name: UBF, slots: [{ a: W(UBSF, 0), b: W(UBSF, 1) }] },
      // 近似: which semi-final loser meets five and which six is not published
      { name: LB1, slots: [{ a: L(UBSF, 0), b: S(6) }, { a: L(UBSF, 1), b: S(5) }] },
    ],
    [{ name: LB2, slots: [{ a: W(LB1, 0), b: W(LB1, 1) }] }],
    [{ name: LBF, slots: [{ a: W(LB2), b: L(UBF) }] }],
    [{ name: GF, slots: [{ a: W(UBF), b: W(LBF) }] }],
  ],
  places: [W(GF), L(GF), L(LBF), L(LB2), L(LB1, 0), L(LB1, 1)],
}

/** LPL Split 3's Season Playoffs: one and two wait in the upper semis, the Knights Rivals pair starts in the lower bracket. */
export const de8LplS3: Template = {
  waves: [
    [{ name: '胜者组八强赛', slots: [{ a: S(3), b: S(6) }, { a: S(4), b: S(5) }] }],
    [
      { name: UBSF, slots: [{ a: S(1), b: W('胜者组八强赛', 1) }, { a: S(2), b: W('胜者组八强赛', 0) }] },
      { name: LB1, slots: [{ a: S(7), b: L('胜者组八强赛', 0) }, { a: S(8), b: L('胜者组八强赛', 1) }] },
    ],
    [
      { name: UBF, slots: [{ a: W(UBSF, 0), b: W(UBSF, 1) }] },
      { name: LB2, slots: [{ a: W(LB1, 0), b: L(UBSF, 1) }, { a: W(LB1, 1), b: L(UBSF, 0) }] },
    ],
    [{ name: LBSF, slots: [{ a: W(LB2, 0), b: W(LB2, 1) }] }],
    [{ name: LBF, slots: [{ a: W(LBSF), b: L(UBF) }] }],
    [{ name: GF, slots: [{ a: W(UBF), b: W(LBF) }] }],
  ],
  places: [W(GF), L(GF), L(LBF), L(LBSF), L(LB2, 0), L(LB2, 1), L(LB1, 0), L(LB1, 1)],
}

/** Four, full double elimination: LCP Split 3, and the MSI and Worlds play-ins (the champion goes through). */
export const de4 = (prefix = ''): Template => {
  const n = (s: string) => `${prefix}${s}`
  return {
    waves: [
      [{ name: n(UBSF), slots: [{ a: S(1), b: S(4) }, { a: S(2), b: S(3) }] }],
      [
        { name: n(UBF), slots: [{ a: W(n(UBSF), 0), b: W(n(UBSF), 1) }] },
        { name: n(LBSF), slots: [{ a: L(n(UBSF), 0), b: L(n(UBSF), 1) }] },
      ],
      [{ name: n(LBF), slots: [{ a: L(n(UBF)), b: W(n(LBSF)) }] }],
      [{ name: n(GF), slots: [{ a: W(n(UBF)), b: W(n(LBF)) }] }],
    ],
    places: [W(n(GF)), L(n(GF)), L(n(LBF)), L(n(LBSF))],
  }
}

const KR = '骑士之路'
/** LPL Split 1: round one's winners are through, its losers get a second chance against round two's winners. */
const krS1: Template = {
  waves: [
    [
      { name: `${KR} 第一轮`, slots: [{ a: S(1), b: S(4) }, { a: S(2), b: S(3) }] },
      { name: `${KR} 第二轮`, slots: [{ a: S(5), b: S(8) }, { a: S(6), b: S(7) }] },
    ],
    [{ name: `${KR} 第三轮`, slots: [{ a: L(`${KR} 第一轮`, 0), b: W(`${KR} 第二轮`, 1) }, { a: L(`${KR} 第一轮`, 1), b: W(`${KR} 第二轮`, 0) }] }],
  ],
  places: [
    W(`${KR} 第一轮`, 0), W(`${KR} 第一轮`, 1), W(`${KR} 第三轮`, 0), W(`${KR} 第三轮`, 1),
    L(`${KR} 第三轮`, 0), L(`${KR} 第三轮`, 1), L(`${KR} 第二轮`, 0), L(`${KR} 第二轮`, 1),
  ],
}
/** LPL Split 2: four single best-of-fives. 近似: one plays eight, two seven… */
const krS2: Template = {
  waves: [[{ name: KR, slots: [{ a: S(1), b: S(8) }, { a: S(2), b: S(7) }, { a: S(3), b: S(6) }, { a: S(4), b: S(5) }] }]],
  places: [W(KR, 0), W(KR, 1), W(KR, 2), W(KR, 3), L(KR, 0), L(KR, 1), L(KR, 2), L(KR, 3)],
}
/** Four teams, two through: the winners' match winner, then the decider's (a GSL group). */
const gsl2 = (name: string): Template => ({
  waves: [
    [{ name: `${name} 开局赛`, slots: [{ a: S(1), b: S(4) }, { a: S(2), b: S(3) }] }],
    [
      { name: `${name} 胜者赛`, slots: [{ a: W(`${name} 开局赛`, 0), b: W(`${name} 开局赛`, 1) }] },
      { name: `${name} 败者赛`, slots: [{ a: L(`${name} 开局赛`, 0), b: L(`${name} 开局赛`, 1) }] },
    ],
    [{ name: `${name} 决胜赛`, slots: [{ a: L(`${name} 胜者赛`), b: W(`${name} 败者赛`) }] }],
  ],
  places: [W(`${name} 胜者赛`), W(`${name} 决胜赛`), L(`${name} 决胜赛`), L(`${name} 败者赛`)],
})

const PI = '入围赛'
/** LCK Cup Play-In: six, three through. The two with most wins wait a round (近似: the pairings). */
const piLckCup: Template = {
  waves: [
    [{ name: `${PI} 第一轮`, slots: [{ a: S(3), b: S(6) }, { a: S(4), b: S(5) }] }],
    [{ name: `${PI} 第二轮`, slots: [{ a: S(1), b: W(`${PI} 第一轮`, 1) }, { a: S(2), b: W(`${PI} 第一轮`, 0) }] }],
    [{ name: `${PI} 最终轮`, slots: [{ a: L(`${PI} 第二轮`, 0), b: L(`${PI} 第二轮`, 1) }] }],
  ],
  places: [
    W(`${PI} 第二轮`, 0), W(`${PI} 第二轮`, 1), W(`${PI} 最终轮`), L(`${PI} 最终轮`),
    L(`${PI} 第一轮`, 0), L(`${PI} 第一轮`, 1),
  ],
}
/** LCK Rounds 3-4 Play-In: Legend 5 v Rise 1 (winner through), Rise 2 v 3 (loser out), then the second chance. */
const piLckS3: Template = {
  waves: [
    [{ name: `${PI} 第一轮`, slots: [{ a: S(1), b: S(2) }] }, { name: `${PI} 第二轮`, slots: [{ a: S(3), b: S(4) }] }],
    [{ name: `${PI} 第三轮`, slots: [{ a: L(`${PI} 第一轮`), b: W(`${PI} 第二轮`) }] }],
  ],
  places: [W(`${PI} 第一轮`), W(`${PI} 第三轮`), L(`${PI} 第三轮`), L(`${PI} 第二轮`)],
}
/** CBLOL Cup Play-In: five v six in the upper final, seven v eight below; both finals' winners through. */
const piCblol: Template = {
  waves: [
    [{ name: `${PI} 胜者组决赛`, slots: [{ a: S(1), b: S(2), bo: 3 }] }, { name: `${PI} 败者组半决赛`, slots: [{ a: S(3), b: S(4), bo: 3 }] }],
    [{ name: `${PI} 败者组决赛`, slots: [{ a: L(`${PI} 胜者组决赛`), b: W(`${PI} 败者组半决赛`), bo: 5 }] }],
  ],
  places: [W(`${PI} 胜者组决赛`), W(`${PI} 败者组决赛`), L(`${PI} 败者组决赛`), L(`${PI} 败者组半决赛`)],
}
/** LCS Lock-In's Last-Chance match: the two worse 1-2 sides, one game. */
const lastChance: Template = {
  waves: [[{ name: '最后机会赛', slots: [{ a: S(1), b: S(2), bo: 1 }] }]],
  places: [W('最后机会赛'), L('最后机会赛')],
}
/** Four, single elimination. */
const se4: Template = {
  waves: [
    [{ name: '半决赛', slots: [{ a: S(1), b: S(4) }, { a: S(2), b: S(3) }] }],
    [{ name: '决赛', slots: [{ a: W('半决赛', 0), b: W('半决赛', 1) }] }],
  ],
  places: [W('决赛'), L('决赛'), L('半决赛', 0), L('半决赛', 1)],
}
/** Eight, single elimination. */
const se8: Template = {
  waves: [
    [{ name: '八强赛', slots: [{ a: S(1), b: S(8) }, { a: S(4), b: S(5) }, { a: S(2), b: S(7) }, { a: S(3), b: S(6) }] }],
    [{ name: '半决赛', slots: [{ a: W('八强赛', 0), b: W('八强赛', 1) }, { a: W('八强赛', 2), b: W('八强赛', 3) }] }],
    [{ name: '决赛', slots: [{ a: W('半决赛', 0), b: W('半决赛', 1) }] }],
  ],
  places: [W('决赛'), L('决赛'), L('半决赛', 0), L('半决赛', 1), L('八强赛', 0), L('八强赛', 1), L('八强赛', 2), L('八强赛', 3)],
}
/** First Stand's two GSL groups side by side; places A1 B1 A2 B2 A3 B3 A4 B4. */
const fstGroups: Template = (() => {
  const a = gsl2('A组'), b = gsl2('B组')
  const shift = (t: Template, by: number): Template => ({
    waves: t.waves.map((w) => w.map((r) => ({ ...r, slots: r.slots.map((s) => ({
      ...s,
      a: 'seed' in s.a ? S(s.a.seed + by) : s.a,
      b: 'seed' in s.b ? S(s.b.seed + by) : s.b,
    })) }))),
    places: t.places,
  })
  const bb = shift(b, 4)
  return {
    waves: a.waves.map((w, i) => [...w, ...bb.waves[i]]),
    places: a.places.flatMap((p, i) => [p, bb.places[i]]),
  }
})()

// ------------------------------------------------------------ helpers

export const T1_REGIONS: Region[] = ['LPL', 'LCK', 'LEC', 'LCS', 'LCP', 'CBLOL']
/** for seeding internationals when nothing better is known: the regions' standing in the world */
export const REGION_ORDER: Region[] = ['LCK', 'LPL', 'LEC', 'LCS', 'LCP', 'CBLOL']

const tier1 = (state: GameState, region: Region) =>
  Object.values(state.teams).filter((t) => t.region === region && t.tier === 1)
    .sort((a, b) => b.rating - a.rating).map((t) => t.id)

const byTags = (state: GameState, region: Region, tags: string[]): string[] => {
  const ids = tags.map((tag) => Object.values(state.teams).find((t) => t.tier === 1 && t.region === region && t.tag === tag)?.id)
  return ids.every(Boolean) ? (ids as string[]) : []
}

export const ckey = (slot: string, region?: Region) => (region ? `${slot}:${region}` : slot)
const done = (state: GameState, slot: string, region?: Region): Competition | undefined => {
  const c = state.comps[ckey(slot, region)]
  return c?.champion ? c : undefined
}
const finished = (state: GameState, slot: string, region?: Region): string[] => done(state, slot, region)?.finished ?? []

/**
 * Last year's ranking of a region's league, best first — the seeding for the
 * first stage. 2026 opens from the real groups; later years from the year
 * before (state.prevRank, written when a season is set up).
 */
function lastYear(state: GameState, region: Region): string[] {
  const prev = state.prevRank?.[region]?.filter((id) => state.teams[id]?.tier === 1 && state.teams[id]?.region === region)
  const all = tier1(state, region)
  if (prev?.length) return [...prev, ...all.filter((id) => !prev.includes(id))]
  if (state.year === 2026 && region === 'LPL') {
    // LPL/2026/Split 1/Regular Season: Ascend, Perseverance, Nirvana as drawn from 2025
    const real = byTags(state, 'LPL', ['BLG', 'AL', 'TES', 'IG', 'JDG', 'WBG', 'NIP', 'WE', 'EDG', 'TT', 'LGD', 'UP', 'LNG', 'OMG'])
    if (real.length === all.length) return real
  }
  if (state.year === 2026 && region === 'LCK') {
    // LCK/2026/Cup: Baron GEN T1 NS DNS BRO, Elder HLE DK KT BFX KRX — interleaved so the snake gives them back
    const real = byTags(state, 'LCK', ['GEN', 'HLE', 'DK', 'T1', 'NS', 'KT', 'BFX', 'DNS', 'BRO', 'KRX'])
    if (real.length === all.length) return real
  }
  return all
}

const tableOf = (ctx: Ctx, key: string, group?: string) =>
  group ? ctx.res[key]?.groups?.[group] ?? [] : ctx.res[key]?.order ?? []

/** the top four pick their opponents from the qualifiers, best first; seeds for de8 (1v8, 4v5, 2v7, 3v6) */
const picked8 = (state: GameState, top4: string[], quals: string[]): string[] => {
  const p = pickWeakest(state, top4, quals)
  return [...top4, p[3], p[2], p[1], p[0]]
}

// ------------------------------------------------------------ the regions

type Slot = 'kickoff' | 'stage1' | 'stage2'

const LPL: Record<Slot, Program> = {
  kickoff: {
    phases: [
      {
        kind: 'rr', key: 'rr', start: 13, end: 36, bo: 3,
        groups: (ctx) => {
          const r = lastYear(ctx.state, 'LPL')
          return [
            { name: 'Ascend', teams: r.slice(0, 6), cycles: 2 },
            { name: 'Perseverance', teams: r.slice(6, 10), cycles: 2 },
            { name: 'Nirvana', teams: r.slice(10, 14), cycles: 2 },
          ]
        },
      },
      {
        kind: 'ko', key: 'kr', start: 38, end: 41, bo: 5, template: () => krS1,
        seeds: (ctx) => {
          const a = tableOf(ctx, 'rr', 'Ascend'), p = tableOf(ctx, 'rr', 'Perseverance'), n = tableOf(ctx, 'rr', 'Nirvana')
          return [a[4], a[5], p[0], p[1], p[2], p[3], n[0], n[1]]
        },
      },
      {
        kind: 'ko', key: 'po', start: 44, end: 66, bo: 5, template: () => de8(),
        seeds: (ctx) => picked8(ctx.state, tableOf(ctx, 'rr', 'Ascend').slice(0, 4), tableOf(ctx, 'kr').slice(0, 4)),
      },
    ],
  },
  stage1: {
    after: () => ['kickoff:LPL'],
    phases: [
      {
        kind: 'rr', key: 'rr', start: 93, end: 138, bo: 3,
        groups: (ctx) => {
          const r = finished(ctx.state, 'kickoff', 'LPL')
          return [{ name: 'Ascend', teams: r.slice(0, 8), cycles: 2 }, { name: 'Nirvana', teams: r.slice(8, 14), cycles: 1 }]
        },
      },
      {
        kind: 'ko', key: 'kr', start: 141, end: 141, bo: 5, template: () => krS2,
        seeds: (ctx) => {
          const a = tableOf(ctx, 'rr', 'Ascend'), n = tableOf(ctx, 'rr', 'Nirvana')
          return [a[4], a[5], a[6], a[7], n[0], n[1], n[2], n[3]]
        },
      },
      {
        kind: 'ko', key: 'po', start: 144, end: 164, bo: 5, template: () => de8(),
        seeds: (ctx) => picked8(ctx.state, tableOf(ctx, 'rr', 'Ascend').slice(0, 4), tableOf(ctx, 'kr').slice(0, 4)),
      },
    ],
  },
  stage2: {
    after: () => ['stage1:LPL'],
    phases: [
      {
        // the bottom two of Split 2's Nirvana are already done for the year
        kind: 'rr', key: 'rr', start: 202, end: 230, bo: 3,
        groups: (ctx) => {
          const r = finished(ctx.state, 'stage1', 'LPL')
          return [{ name: 'Ascend', teams: r.slice(0, 8), cycles: 2 }, { name: 'Nirvana', teams: r.slice(8, 12), cycles: 2 }]
        },
      },
      {
        kind: 'ko', key: 'kr', start: 233, end: 237, bo: 5, template: () => gsl2(KR),
        seeds: (ctx) => {
          const a = tableOf(ctx, 'rr', 'Ascend'), n = tableOf(ctx, 'rr', 'Nirvana')
          return [a[6], a[7], n[0], n[1]]
        },
      },
      {
        kind: 'ko', key: 'po', start: 240, end: 255, bo: 5, template: () => de8LplS3,
        seeds: (ctx) => [...tableOf(ctx, 'rr', 'Ascend').slice(0, 6), ...tableOf(ctx, 'kr').slice(0, 2)],
      },
    ],
  },
}

const LCK: Record<Slot, Program> = {
  kickoff: {
    phases: [
      {
        kind: 'cross', key: 'gb', start: 13, end: 31,
        groups: (ctx) => {
          // snake: 1 4 5 8 9 against 2 3 6 7 10 (近似 — the real split is not published)
          const r = lastYear(ctx.state, 'LCK')
          return [
            { name: 'Baron', teams: [r[0], r[3], r[4], r[7], r[8]].filter(Boolean) },
            { name: 'Elder', teams: [r[1], r[2], r[5], r[6], r[9]].filter(Boolean) },
          ]
        },
      },
      {
        kind: 'ko', key: 'pi', start: 36, end: 38, bo: 3, template: () => piLckCup,
        seeds: (ctx) => {
          const g = ctx.res.gb
          const win = g.groups![g.winner!], lose = Object.entries(g.groups!).find(([k]) => k !== g.winner)![1]
          const six = [...win.slice(2, 5), ...lose.slice(1, 4)]
          return six.sort((x, y) => (ctx.comp.standings[y]?.w ?? 0) - (ctx.comp.standings[x]?.w ?? 0))
        },
      },
      {
        kind: 'ko', key: 'po', start: 42, end: 59, bo: 5, template: () => de6Byes(),
        seeds: (ctx) => {
          const g = ctx.res.gb
          const win = g.groups![g.winner!], lose = Object.entries(g.groups!).find(([k]) => k !== g.winner)![1]
          const q = tableOf(ctx, 'pi').slice(0, 3)
          return [win[0], win[1], lose[0], q[0], q[1], q[2]]
        },
      },
    ],
  },
  stage1: {
    phases: [
      { kind: 'rr', key: 'r12', start: 90, end: 150, bo: 3, groups: (ctx) => [{ name: 'LCK', teams: tier1(ctx.state, 'LCK'), cycles: 2 }] },
      { kind: 'ko', key: 'rtm', start: 156, end: 164, bo: 5, template: () => de6Byes(), seeds: (ctx) => tableOf(ctx, 'r12').slice(0, 6) },
    ],
  },
  stage2: {
    after: () => ['stage1:LCK'],
    phases: [
      {
        kind: 'rr', key: 'r34', start: 209, end: 234, bo: 3,
        groups: (ctx) => {
          const r = done(ctx.state, 'stage1', 'LCK')?.prog?.res.r12?.order ?? tier1(ctx.state, 'LCK')
          return [{ name: 'Legend', teams: r.slice(0, 5), cycles: 2 }, { name: 'Rise', teams: r.slice(5, 10), cycles: 2 }]
        },
        // Rounds 1-2's records come with them
        carry: (ctx) => done(ctx.state, 'stage1', 'LCK'),
      },
      {
        kind: 'ko', key: 'pi', start: 237, end: 239, bo: 5, template: () => piLckS3,
        seeds: (ctx) => {
          const l = tableOf(ctx, 'r34', 'Legend'), r = tableOf(ctx, 'r34', 'Rise')
          return [l[4], r[0], r[1], r[2]]
        },
      },
      {
        kind: 'ko', key: 'po', start: 240, end: 255, bo: 5, template: () => de6Byes(),
        seeds: (ctx) => [...tableOf(ctx, 'r34', 'Legend').slice(0, 4), ...tableOf(ctx, 'pi').slice(0, 2)],
      },
    ],
  },
}

/** single round robin, then a bracket from the top of the table */
const tableThen = (
  region: Region, rr: [number, number], rrBo: 1 | 3, ko: [number, number], template: () => import('./formats').Template, size: number, after?: string,
): Program => ({
  after: after ? () => [after] : undefined,
  phases: [
    { kind: 'rr', key: 'rr', start: rr[0], end: rr[1], bo: rrBo, groups: (ctx) => [{ name: region, teams: tier1(ctx.state, region), cycles: 1 }] },
    { kind: 'ko', key: 'po', start: ko[0], end: ko[1], bo: 5, template, seeds: (ctx) => tableOf(ctx, 'rr').slice(0, size) },
  ],
})

const LEC: Record<Slot, Program> = {
  // Versus: one game each, the top eight in a double elimination (rounds one and two best of three)
  kickoff: tableThen('LEC', [16, 38], 1, [46, 59], () => de8(3), 8),
  stage1: tableThen('LEC', [86, 129], 3, [142, 157], () => de6Top4, 6),
  stage2: tableThen('LEC', [204, 241], 3, [247, 262], () => de6Top4, 6),
}

const LCS: Record<Slot, Program> = {
  kickoff: {
    phases: [
      {
        kind: 'swiss', key: 'sw', start: 23, end: 37, rounds: 3, bo: () => 3,
        seeds: (ctx) => lastYear(ctx.state, 'LCS'),
      },
      {
        // the two worse 1-2 sides; the best 1-2 is the fifth seed already
        kind: 'ko', key: 'lc', start: 39, end: 39, bo: 1, template: () => lastChance,
        seeds: (ctx) => tableOf(ctx, 'sw').slice(5, 7),
      },
      {
        // 近似: the 3-0 side picks between the two worst 2-1s — it takes the weaker
        kind: 'ko', key: 'po', start: 43, end: 59, bo: 5, template: () => de6Top4,
        seeds: (ctx) => {
          const sw = tableOf(ctx, 'sw')
          return [sw[0], sw[1], sw[2], sw[3], sw[4], tableOf(ctx, 'lc')[0]]
        },
      },
    ],
  },
  stage1: tableThen('LCS', [93, 136], 3, [142, 164], () => de6Top4, 6),
  stage2: tableThen('LCS', [205, 248], 3, [254, 276], () => de6Byes(), 6),
}

const LCP: Record<Slot, Program> = {
  kickoff: tableThen('LCP', [15, 44], 3, [47, 59], () => de6Byes(), 6),
  stage1: tableThen('LCP', [93, 138], 3, [144, 157], () => de6Byes(), 6),
  stage2: {
    phases: [
      {
        // three wins through, three losses out; the deciding games are best of five
        kind: 'swiss', key: 'sw', start: 204, end: 224, rounds: 5, win: 3, lose: 3,
        bo: (round, w, l) => (round <= 2 ? 3 : round === 3 ? (w === 2 || l === 2 ? 5 : 3) : 5),
        seeds: (ctx) => {
          const pts = lcpPoints(ctx.state)
          return tier1(ctx.state, 'LCP').sort((a, b) => (pts[b] ?? 0) - (pts[a] ?? 0))
        },
      },
      { kind: 'ko', key: 'po', start: 230, end: 241, bo: 5, template: () => de4(), seeds: (ctx) => tableOf(ctx, 'sw').slice(0, 4) },
    ],
  },
}

const CBLOL: Record<Slot, Program> = {
  kickoff: {
    phases: [
      { kind: 'rr', key: 'rr', start: 16, end: 38, bo: 1, groups: (ctx) => [{ name: 'CBLOL', teams: tier1(ctx.state, 'CBLOL'), cycles: 1 }] },
      { kind: 'ko', key: 'pi', start: 41, end: 43, bo: 3, template: () => piCblol, seeds: (ctx) => tableOf(ctx, 'rr').slice(4, 8) },
      {
        kind: 'ko', key: 'po', start: 45, end: 59, bo: 5, template: () => de6Byes(3),
        seeds: (ctx) => [...tableOf(ctx, 'rr').slice(0, 4), ...tableOf(ctx, 'pi').slice(0, 2)],
      },
    ],
  },
  stage1: tableThen('CBLOL', [86, 140], 3, [144, 156], () => de6Byes(), 6),
  stage2: tableThen('CBLOL', [205, 262], 3, [268, 282], () => de6Byes(), 6),
}

export const REGION_PROGRAMS: Record<Region, Record<Slot, Program>> = { LPL, LCK, LEC, LCS, LCP, CBLOL }

/** what each stage is, in a few lines, for the standings screen (docs/调研-2026赛制.md) */
export const STAGE_BLURB: Record<string, string> = {
  'LPL:kickoff': '按上一年成绩分三组（Ascend 6 / Perseverance 4 / Nirvana 4），组内双循环 BO3。Ascend 前四直接进淘汰赛；Ascend 5–6、Perseverance 全部、Nirvana 前二打骑士之路（BO5），四队晋级；Nirvana 3–4 本赛段出局。淘汰赛八队双败 BO5，Ascend 前四依次挑对手。前二去 First Stand。',
  'LPL:stage1': '按第一赛段名次分组：前八 Ascend 双循环、后六 Nirvana 单循环，BO3。Ascend 前四进淘汰赛；Ascend 5–8 与 Nirvana 1–4 打骑士之路（单场 BO5），胜者晋级；Nirvana 末两名今年的比赛到此结束。前二去 MSI。',
  'LPL:stage2': '第二赛段前十二名：前八 Ascend、后四 Nirvana，组内双循环 BO3。Ascend 前二直通胜者组半决赛、3–6 进胜者组八强；Ascend 7–8 与 Nirvana 前二打骑士之路（四队双败，两队进败者组）。冠军是 LPL 一号种子，全年积分第一是二号种子，之后积分前几名打区域资格赛争剩下的名额。',
  'LCK:kickoff': 'Baron、Elder 两组只打对面组：前两周 BO3，第三周「超级周」同号种子 BO5。BO3 胜 +1、BO5 胜 +2 记到组里，组积分高的是胜组。胜组前二直通季后赛第二轮、败组第一进第一轮；胜组 3–5 与败组 2–4 打入围赛（三队晋级）；败组第五出局。季后赛六队双败 BO5，前二去 First Stand。',
  'LCK:stage1': '十队双循环 BO3（Rounds 1-2）。前六打 Road to MSI（六队双败 BO5，前二种子轮空），前二去 MSI。战绩带入第三赛段。',
  'LCK:stage2': '按前两轮名次分 Legend（1–5）和 Rise（6–10），带着前两轮的战绩组内双循环。Legend 前二直通季后赛第二轮、3–4 进第一轮；Legend 第五与 Rise 前三打入围赛（两队晋级）；Rise 4–5 出局。季后赛六队双败 BO5，前三去全球总决赛。',
  'LEC:kickoff': 'Versus：单循环 BO1，前八进双败淘汰赛（前两轮 BO3，之后 BO5）。冠军去 First Stand。',
  'LEC:stage1': '单循环 BO3，前六进季后赛：前四进胜者组半决赛，5–6 从败者组打起。前二去 MSI。',
  'LEC:stage2': '单循环 BO3，前六进季后赛：前四进胜者组半决赛，5–6 从败者组打起。前三去全球总决赛。',
  'LCS:kickoff': 'Lock-In：三轮瑞士轮 BO3。3-0 与三支 2-1 进胜者组半决赛；1-2 里成绩最好的是五号种子，另两支打一局定胜负的最后机会赛争六号种子；0-3 出局。季后赛六队双败 BO5，冠军去 First Stand。',
  'LCS:stage1': '单循环 BO3，前四进胜者组半决赛、5–6 从败者组打起，7–8 出局。前二去 MSI。',
  'LCS:stage2': '单循环 BO3，前二直通胜者组第二轮、3–6 从胜者组第一轮打起。前三去全球总决赛。',
  'LCP:kickoff': '单循环 BO3，前六进季后赛（前二轮空到第二轮）。冠军去 First Stand。',
  'LCP:stage1': '单循环 BO3，前六进季后赛（前二轮空到第二轮）。冠军去 MSI，另一个 MSI 名额给冠军之外积分最高的队。',
  'LCP:stage2': '八队瑞士轮：三胜晋级、三负淘汰，决定命运的场次 BO5。四队进双败淘汰，前二去全球总决赛，第三个名额给积分最高的队。',
  'CBLOL:kickoff': 'Cup：单循环 BO1。1–2 直通季后赛第二轮、3–4 进第一轮；5–8 打入围赛（两队晋级）。季后赛六队双败，冠军去 First Stand。',
  'CBLOL:stage1': '单循环 BO3，前二直通第二轮、3–6 进第一轮，7–8 出局。冠军去 MSI（巴西只有一个 MSI 名额）。',
  'CBLOL:stage2': '单循环 BO3，前二直通第二轮、3–6 进第一轮，7–8 出局。前二去全球总决赛。',
}


// ------------------------------------------------------------ points

/** LPL's Championship Points: Split 1 and 2 placings, Split 3 below the champion (who is LPL1). */
export const LPL_POINTS = {
  kickoff: [80, 50, 40, 20, 10, 10, 5, 5],
  stage1: [110, 80, 50, 30, 15, 15, 10, 10],
  stage2: [0, 110, 80, 50, 30, 30, 15, 15],
} as const

export function lplPoints(state: GameState): Record<string, number> {
  const pts: Record<string, number> = {}
  for (const slot of ['kickoff', 'stage1', 'stage2'] as const) {
    finished(state, slot, 'LPL').forEach((id, i) => { pts[id] = (pts[id] ?? 0) + (LPL_POINTS[slot][i] ?? 0) })
  }
  return pts
}

/**
 * LCP's points (近似 in two places: the +5 bonus match for Swiss leavers is not
 * played, and the game-score part is per stage table, clamped at zero).
 */
export function lcpPoints(state: GameState): Record<string, number> {
  const pts: Record<string, number> = {}
  const add = (id: string, n: number) => { pts[id] = (pts[id] ?? 0) + n }
  for (const [slot, per] of [['kickoff', 1], ['stage1', 2]] as const) {
    const c = done(state, slot, 'LCP')
    if (!c) continue
    const rr = c.prog?.res.rr?.order ?? []
    rr.forEach((id, i) => {
      add(id, Math.max(0, 7 - i))
      const s = c.standings[id]
      if (s) add(id, Math.max(0, (s.mapW - s.mapL) * per))
    })
    const po = c.prog?.res.po?.order ?? []
    po.forEach((id, i) => add(id, [20, 15, 10, 5, 0, 0][i] ?? 0))
  }
  const s3 = done(state, 'stage2', 'LCP')
  const sw = state.comps['stage2:LCP']?.prog?.res.sw?.order ?? []
  sw.forEach((id, i) => add(id, [50, 40, 30, 30, 15, 15, 3, 0][i] ?? 0))
  if (s3) s3.finished.slice(2, 4).forEach((id, i) => add(id, [15, 0][i]))
  return pts
}

// ------------------------------------------------------------ qualification

/** First Stand: LPL and LCK two each (their first stage's top two), everyone else its champion. */
export function fstSeeds(state: GameState): Record<Region, string[]> {
  const out = {} as Record<Region, string[]>
  for (const r of T1_REGIONS) out[r] = finished(state, 'kickoff', r).slice(0, r === 'LPL' || r === 'LCK' ? 2 : 1)
  return out
}

/** The region that won First Stand sends its second MSI seed straight to the bracket. */
export const fstRegion = (state: GameState): Region | undefined => {
  const c = done(state, 'masters1')
  return c ? state.teams[c.champion!]?.region : undefined
}

/** MSI: every region two (CBLOL one); LCP's second is its best on points who is not the champion. */
export function msiSeeds(state: GameState): Record<Region, string[]> {
  const out = {} as Record<Region, string[]>
  for (const r of T1_REGIONS) {
    const f = finished(state, 'stage1', r)
    if (r === 'CBLOL') out[r] = f.slice(0, 1)
    else if (r === 'LCP') {
      const pts = lcpPoints(state)
      const champ = f[0]
      const best = Object.keys(pts).filter((id) => id !== champ).sort((a, b) => pts[b] - pts[a])[0] ?? f[1]
      out[r] = [champ, best].filter(Boolean)
    } else out[r] = f.slice(0, 2)
  }
  // the First Stand region's second seed is guaranteed; if it is CBLOL, its runner-up comes
  const fr = fstRegion(state)
  if (fr === 'CBLOL') out.CBLOL = finished(state, 'stage1', 'CBLOL').slice(0, 2)
  return out
}

/** Worlds slots: 3 each and CBLOL 2, one more for the region of MSI's runner-up, one for its champion. */
export function worldsSlots(state: GameState): Record<Region, number> {
  const out: Record<Region, number> = { LPL: 3, LCK: 3, LEC: 3, LCS: 3, LCP: 3, CBLOL: 2 }
  const msi = done(state, 'masters2')
  if (msi) {
    const second = state.teams[msi.finished[1]]?.region
    if (second) out[second]++
    const champ = state.teams[msi.champion!]
    if (champ && reachedSummerPlayoffs(state, champ.id)) out[champ.region]++
  }
  return out
}

/** in its region's third-stage bracket (the MSI champion's Worlds slot asks for it) */
export function reachedSummerPlayoffs(state: GameState, id: string): boolean {
  const c = state.comps[ckey('stage2', state.teams[id]?.region)]
  return !!c?.prog?.seeds.po?.includes(id)
}

/**
 * Who goes to Worlds from a region, in seed order. The MSI champion (if it made
 * its summer bracket) is guaranteed one of its region's slots; if it qualified on
 * its own, the region's next team takes the extra one.
 */
export function worldsSeeds(state: GameState, region: Region): string[] {
  const n = worldsSlots(state)[region]
  let order: string[]
  if (region === 'LPL') {
    const s3 = finished(state, 'stage2', 'LPL')
    const pts = lplPoints(state)
    const champ = s3[0]
    const second = Object.keys(pts).filter((id) => id !== champ).sort((a, b) => pts[b] - pts[a] || s3.indexOf(a) - s3.indexOf(b))[0]
    const rf = state.comps['qual:LPL']?.champion ? state.comps['qual:LPL'].finished : []
    order = [champ, second, ...rf].filter(Boolean)
  } else if (region === 'LCP') {
    const s3 = finished(state, 'stage2', 'LCP')
    const pts = lcpPoints(state)
    const third = Object.keys(pts).filter((id) => !s3.slice(0, 2).includes(id)).sort((a, b) => pts[b] - pts[a])
    order = [...s3.slice(0, 2), ...third, ...s3.slice(2)]
  } else {
    order = finished(state, 'stage2', region)
  }
  order = [...new Set(order)]
  const msi = done(state, 'masters2')
  const champ = msi?.champion
  let picks = order.slice(0, n)
  if (champ && state.teams[champ]?.region === region && reachedSummerPlayoffs(state, champ) && !picks.includes(champ)) {
    picks = [...order.slice(0, n - 1), champ]
  }
  return picks
}

/** LPL's Regional Finals: who plays for the last slots, by Championship Points. */
export function lplRegionalField(state: GameState): string[] {
  const s3 = finished(state, 'stage2', 'LPL')
  const pts = lplPoints(state)
  const champ = s3[0]
  const rest = Object.keys(pts).filter((id) => id !== champ).sort((a, b) => pts[b] - pts[a] || s3.indexOf(a) - s3.indexOf(b))
  const slots = worldsSlots(state).LPL
  // the second seed is the points leader; the Regional Finals play for the rest
  return rest.slice(1, 1 + (slots >= 4 ? 4 : 3))
}

/** LPL Regional Finals: four in a double elimination for two slots, or three in a gauntlet for one. */
export function lplRegionalProgram(state: GameState): Program {
  const four = worldsSlots(state).LPL >= 4
  const t: Template = four
    ? {
      waves: [
        [{ name: '胜者组决赛', slots: [{ a: S(1), b: S(2) }] }, { name: '败者组半决赛', slots: [{ a: S(3), b: S(4) }] }],
        [{ name: '败者组决赛', slots: [{ a: L('胜者组决赛'), b: W('败者组半决赛') }] }],
      ],
      places: [W('胜者组决赛'), W('败者组决赛'), L('败者组决赛'), L('败者组半决赛')],
    }
    : {
      waves: [
        [{ name: '擂台赛 半决赛', slots: [{ a: S(2), b: S(3) }] }],
        [{ name: '擂台赛 决赛', slots: [{ a: S(1), b: W('擂台赛 半决赛') }] }],
      ],
      places: [W('擂台赛 决赛'), L('擂台赛 决赛'), L('擂台赛 半决赛')],
    }
  return { phases: [{ kind: 'ko', key: 'rf', start: 259, end: 261, bo: 5, template: () => t, seeds: () => lplRegionalField(state) }] }
}

// ------------------------------------------------------------ internationals

const regionRank = (_state: GameState, r: Region): number => REGION_ORDER.indexOf(r)

/** First Stand: pots by region (LCK1/LPL1, the four champions, LCK2/LPL2), two GSL groups, then four in a single elimination. */
export function fstProgram(state: GameState): Program {
  const seeds = fstSeeds(state)
  return {
    blurb: '两个 GSL 小组 BO5（一组里同赛区最多一队），各组前二进四强单败 BO5。冠军所在赛区的 MSI 二号种子直通正赛。',
    phases: [
      {
        kind: 'ko', key: 'grp', start: 74, end: 78, bo: 5, template: () => fstGroups,
        seeds: () => {
          const mid = (['LEC', 'LCS', 'LCP', 'CBLOL'] as Region[]).map((r) => seeds[r][0]).filter(Boolean)
          // 近似: the pot-two draw, deterministic per save
          const h = (id: string) => [...`${state.seed}:${id}`].reduce((s, c) => (s * 31 + c.charCodeAt(0)) | 0, 7)
          mid.sort((a, b) => h(a) - h(b))
          return [seeds.LCK[0], mid[0], mid[1], seeds.LPL[1], seeds.LPL[0], mid[2], mid[3], seeds.LCK[1]]
        },
      },
      { kind: 'ko', key: 'ko', start: 79, end: 80, bo: 5, template: () => se4, seeds: (ctx) => tableOf(ctx, 'grp').slice(0, 4) },
    ],
  }
}

/** MSI: the first seeds and the First Stand region's second straight into the bracket; the other seconds play in for one place. */
export function msiProgram(state: GameState): Program {
  const seeds = msiSeeds(state)
  const fr = fstRegion(state) ?? 'LPL'
  const fst = done(state, 'masters1')
  // regions ranked by their best finish at First Stand, then by standing
  const best = (r: Region) => {
    const i = (fst?.finished ?? []).findIndex((id) => state.teams[id]?.region === r)
    return i < 0 ? 99 : i
  }
  const ranked = T1_REGIONS.slice().sort((a, b) => best(a) - best(b) || regionRank(state, a) - regionRank(state, b))
  const playIn = ranked.filter((r) => r !== fr).map((r) => seeds[r][1]).filter(Boolean)
  return {
    blurb: '各赛区一号种子和 First Stand 冠军赛区的二号种子直通正赛；其余二号种子打四队双败入围赛，一队晋级。正赛八队双败 BO5。冠军打进本赛区夏季季后赛就锁定一个全球总决赛名额；亚军所在赛区多一个全球总决赛名额。',
    phases: [
      { kind: 'ko', key: 'pi', start: 178, end: 181, bo: 5, template: () => de4('入围赛 '), seeds: () => playIn.slice(0, 4) },
      {
        kind: 'ko', key: 'br', start: 183, end: 192, bo: 5, template: () => de8(),
        seeds: (ctx) => {
          const firsts = ranked.map((r) => seeds[r][0]).filter(Boolean)
          const s = [...firsts.slice(0, 6), seeds[fr][1], tableOf(ctx, 'pi')[0]].filter(Boolean)
          // a region does not meet itself in round one (1v8, 2v7)
          const reg = (id: string) => ctx.state.teams[id]?.region
          if (reg(s[0]) === reg(s[7])) [s[6], s[7]] = [s[7], s[6]]
          if (reg(s[1]) === reg(s[6])) [s[6], s[7]] = [s[7], s[6]]
          return s
        },
      },
    ],
  }
}

/** Worlds: the last seed of LEC, LCS, LCP and CBLOL play in for one place; sixteen in a Swiss; eight in a single elimination. */
export function worldsProgram(state: GameState): Program {
  const per = Object.fromEntries(T1_REGIONS.map((r) => [r, worldsSeeds(state, r)])) as Record<Region, string[]>
  const playIn = (['LEC', 'LCS', 'LCP', 'CBLOL'] as Region[]).map((r) => per[r][per[r].length - 1]).filter(Boolean)
  const direct = T1_REGIONS.flatMap((r) => per[r].filter((id) => !playIn.includes(id)).map((id, i) => ({ id, seed: i + 1, r })))
  return {
    blurb: 'LEC、LCS、LCP、CBLOL 的末位种子打四队双败入围赛，一队晋级。十六队瑞士轮五轮，三胜晋级、三负淘汰，决定命运的场次 BO3、其余 BO1。八强单败 BO5。',
    phases: [
      { kind: 'ko', key: 'pi', start: 287, end: 290, bo: 5, template: () => de4('入围赛 '), seeds: () => playIn },
      {
        kind: 'swiss', key: 'sw', start: 295, end: 303, rounds: 5, win: 3, lose: 3,
        // the games that decide a team's fate are best of three, the rest one game
        bo: (_r, w, l) => (w === 2 || l === 2 ? 3 : 1),
        seeds: (ctx) => {
          const list = [...direct.sort((a, b) => a.seed - b.seed || regionRank(state, a.r) - regionRank(state, b.r)).map((x) => x.id), tableOf(ctx, 'pi')[0]]
          return list.filter(Boolean)
        },
      },
      { kind: 'ko', key: 'ko', start: 306, end: 317, bo: 5, template: () => se8, seeds: (ctx) => tableOf(ctx, 'sw').slice(0, 8) },
    ],
  }
}

/**
 * The year's ranking of each league, best first, for next year's first stage:
 * LPL by Championship Points behind its Split 3 champion, everyone else by its
 * third stage, then its second for whoever did not play it.
 */
export function seasonRanking(state: GameState): Partial<Record<Region, string[]>> {
  const out: Partial<Record<Region, string[]>> = {}
  for (const r of T1_REGIONS) {
    const s3 = finished(state, 'stage2', r)
    if (!s3.length) continue
    const s2 = finished(state, 'stage1', r)
    const at = (list: string[], id: string) => (list.includes(id) ? list.indexOf(id) : 99)
    const all = tier1(state, r)
    if (r === 'LPL') {
      const pts = lplPoints(state)
      out[r] = [s3[0], ...all.filter((id) => id !== s3[0])
        .sort((a, b) => (pts[b] ?? 0) - (pts[a] ?? 0) || at(s3, a) - at(s3, b) || at(s2, a) - at(s2, b))]
    } else {
      out[r] = all.slice().sort((a, b) => at(s3, a) - at(s3, b) || at(s2, a) - at(s2, b))
    }
  }
  return out
}

/** The program a competition runs, by its `program` key. */
export function programFor(state: GameState, comp: Competition): Program | null {
  const key = comp.program ?? ''
  if (key === 'fst') return fstProgram(state)
  if (key === 'msi') return msiProgram(state)
  if (key === 'worlds') return worldsProgram(state)
  if (key === 'qual:LPL') return lplRegionalProgram(state)
  const [region, slot] = key.split(':') as [Region, Slot]
  const p = REGION_PROGRAMS[region]?.[slot]
  return p ? { ...p, blurb: STAGE_BLURB[key] } : null
}

// ------------------------------------------------------------ in words, for the screens

const EVENT_OF = { kickoff: 'masters1', stage1: 'masters2', stage2: 'champions' } as const
export const EVENT_CN = { masters1: 'First Stand', masters2: 'MSI 季中冠军赛', champions: '全球总决赛' } as const

/** what a region's stage sends on, in a few words */
export function qualLine(region: Region, slot: Slot): string {
  if (slot === 'kickoff') return region === 'LPL' || region === 'LCK' ? '前 2 去 First Stand' : '冠军去 First Stand'
  if (slot === 'stage1') {
    if (region === 'CBLOL') return '冠军去 MSI（巴西只有一个名额）'
    if (region === 'LCP') return '冠军去 MSI，另一个名额给冠军之外积分最高的队'
    return '前 2 去 MSI'
  }
  if (region === 'LPL') return '冠军是一号种子，全年积分第一是二号种子，接下来的积分前几名打区域资格赛'
  if (region === 'LCP') return '前 2 去全球总决赛，第 3 个名额给积分最高的队'
  if (region === 'CBLOL') return '前 2 去全球总决赛'
  return '前 3 去全球总决赛'
}

/** the region's seeds for an event, once its feeding stage is over (or null) */
export function eventSeeds(state: GameState, ev: 'masters1' | 'masters2' | 'champions', region: Region): string[] | null {
  const slot = ev === 'masters1' ? 'kickoff' : ev === 'masters2' ? 'stage1' : 'stage2'
  if (!state.comps[ckey(slot, region)]?.champion) return null
  if (ev === 'masters1') return fstSeeds(state)[region]
  if (ev === 'masters2') {
    if (!state.comps.masters1?.champion) return null
    return msiSeeds(state)[region]
  }
  if (!state.comps.masters2?.champion) return null
  if (region === 'LPL' && state.comps['qual:LPL'] && !state.comps['qual:LPL'].champion) return null
  return worldsSeeds(state, region)
}

export { EVENT_OF }
