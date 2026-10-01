/**
 * The League year before 2025, for careers started in the past
 * (docs/调研-2016与2022赛制.md). Two shapes:
 *
 *   2016 (S6), played 2016–2018: Spring, MSI with one team a region, Summer,
 *     every league's Championship Points, the Regional Finals gauntlets, and a
 *     sixteen-team Worlds of four groups — no play-in.
 *   2022 (S12), played 2019–2024: Spring, MSI's Rumble, Summer, LPL and LCK's
 *     Regional Finals for a third and fourth seed, a Worlds with a play-in.
 *
 * Neither year had First Stand. The engine's slots: Spring sits in 第二赛段
 * (stage1), MSI in masters2, Summer in 第三赛段 (stage2), Worlds in champions;
 * a region's Regional Finals is `qual:<region>`, a minor competition in the
 * stage2 slot. 2017–2018 and 2019–2024 changed their formats in details the
 * research did not cover; they play their era's shape (决定 D69).
 *
 * Where the game only has six regions and the real event had more, the
 * missing ones are left out, never invented: MSI 2022 goes straight to its
 * Rumble (the group stage's other teams came from regions this game does not
 * play), Worlds 2022's play-in has seven, Worlds 2016 has fifteen. 2016's
 * wildcard qualifiers are not played: CBLOL's champion takes the wildcard
 * place (INTZ really did reach Worlds 2016 that way).
 *
 * Bo2 leagues (EU LCS 2016 Summer, LMS, CBLOL 2016) are played as two games
 * of one, which ranks the same as wins/draws/losses up to tie-breaks.
 * LPL 2016's third-placed team does not start its series one game up.
 * Mid-year promotion is not played; year-end promotion is (season.ts).
 */
import { L, S, W, pickWeakest } from './formats'
import type { Ctx, Program, Template } from './formats'
import { de6Top4, de8LplS3, done, finished, lastYear, se4, se8, tableOf, tier1, T1_REGIONS } from './programs2026'
import { EVENT_CN as EVENT_CN_2026, EVENT_OF as EVENT_OF_2026, eventSeeds, lplPoints, programFor, qualLine } from './programs2026'
import { hashStr } from './rng'
import type { Competition, GameState, Region } from './types'

export type Era = 2016 | 2022 | 2026
/** the shape a year is played in under the real-formats ruleset */
export const eraOf = (year: number): Era => (year <= 2018 ? 2016 : year <= 2024 ? 2022 : 2026)
/** the program-key prefix of a historical era */
export const eraTag = (era: Era): string => (era === 2016 ? 'h16' : 'h22')

// ------------------------------------------------------------ templates

/** A gauntlet: the two lowest play, the winner climbs one seed at a time to the top seed. */
export function gauntlet(n: number, names: string[] = [], firstBo?: 1 | 3 | 5): Template {
  const name = (i: number) => names[i] ?? (i === n - 2 ? '决赛' : `擂台赛 第${i + 1}轮`)
  const waves: Template['waves'] = []
  for (let i = 0; i < n - 1; i++) {
    const top = n - 1 - i
    waves.push([{ name: name(i), slots: [{ a: S(top), b: i === 0 ? S(n) : W(name(i - 1)), bo: i === 0 ? firstBo : undefined }] }])
  }
  const places = [W(name(n - 2)), ...Array.from({ length: n - 1 }, (_, k) => L(name(n - 2 - k)))]
  return { waves, places }
}

/** Four, single elimination with a third-place match. */
const se4Third: Template = {
  waves: [
    [{ name: '半决赛', slots: [{ a: S(1), b: S(4) }, { a: S(2), b: S(3) }] }],
    [{ name: '季军赛', slots: [{ a: L('半决赛', 0), b: L('半决赛', 1) }] }, { name: '决赛', slots: [{ a: W('半决赛', 0), b: W('半决赛', 1) }] }],
  ],
  places: [W('决赛'), L('决赛'), W('季军赛'), L('季军赛')],
}

/** Quarter-finals of four seeds (1v4, 2v3 of the seeds given): the winners go on to be reseeded. */
const qf4 = (bo?: 1 | 3 | 5): Template => ({
  waves: [[{ name: '八强赛', slots: [{ a: S(1), b: S(4), bo }, { a: S(2), b: S(3), bo }] }]],
  places: [W('八强赛', 0), W('八强赛', 1), L('八强赛', 0), L('八强赛', 1)],
})

/**
 * LPL 2016: X1 and Y1 wait in the semis, X2 and Y2 in the quarters; X3 v Y4 and Y3 v X4 open.
 * Seeds: X1 Y1 X2 Y2 X3 Y3 X4 Y4.
 */
const lpl16: Template = {
  waves: [
    [{ name: '第一轮', slots: [{ a: S(5), b: S(8) }, { a: S(6), b: S(7) }] }],
    [{ name: '八强赛', slots: [{ a: S(4), b: W('第一轮', 0) }, { a: S(3), b: W('第一轮', 1) }] }],
    [{ name: '半决赛', slots: [{ a: S(1), b: W('八强赛', 0) }, { a: S(2), b: W('八强赛', 1) }] }],
    [{ name: '季军赛', slots: [{ a: L('半决赛', 0), b: L('半决赛', 1) }] }, { name: '决赛', slots: [{ a: W('半决赛', 0), b: W('半决赛', 1) }] }],
  ],
  places: [W('决赛'), L('决赛'), W('季军赛'), L('季军赛'), L('八强赛', 0), L('八强赛', 1), L('第一轮', 0), L('第一轮', 1)],
}

/** CBLOL 2016 Split 1: one and two in the semis, three to six in best-of-three quarters. */
const cblol16: Template = {
  waves: [
    [{ name: '八强赛', slots: [{ a: S(3), b: S(6), bo: 3 }, { a: S(4), b: S(5), bo: 3 }] }],
    [{ name: '半决赛', slots: [{ a: S(1), b: W('八强赛', 1) }, { a: S(2), b: W('八强赛', 0) }] }],
    [{ name: '决赛', slots: [{ a: W('半决赛', 0), b: W('半决赛', 1) }] }],
  ],
  places: [W('决赛'), L('决赛'), L('半决赛', 0), L('半决赛', 1), L('八强赛', 0), L('八强赛', 1)],
}

/**
 * LPL 2022: two King-of-the-Hill ladders (3/6/7/10 for the second seed, 4/5/8/9
 * for the first), then four in a double elimination.
 */
const KA = '擂台赛A', KB = '擂台赛B'
const lpl22: Template = {
  waves: [
    [{ name: `${KA} 第一轮`, slots: [{ a: S(7), b: S(10) }] }, { name: `${KB} 第一轮`, slots: [{ a: S(8), b: S(9) }] }],
    [{ name: `${KA} 第二轮`, slots: [{ a: S(6), b: W(`${KA} 第一轮`) }] }, { name: `${KB} 第二轮`, slots: [{ a: S(5), b: W(`${KB} 第一轮`) }] }],
    [{ name: `${KA} 第三轮`, slots: [{ a: S(3), b: W(`${KA} 第二轮`) }] }, { name: `${KB} 第三轮`, slots: [{ a: S(4), b: W(`${KB} 第二轮`) }] }],
    [{ name: '胜者组半决赛', slots: [{ a: S(1), b: W(`${KB} 第三轮`) }, { a: S(2), b: W(`${KA} 第三轮`) }] }],
    [
      { name: '胜者组决赛', slots: [{ a: W('胜者组半决赛', 0), b: W('胜者组半决赛', 1) }] },
      { name: '败者组第一轮', slots: [{ a: L('胜者组半决赛', 0), b: L('胜者组半决赛', 1) }] },
    ],
    [{ name: '败者组决赛', slots: [{ a: W('败者组第一轮'), b: L('胜者组决赛') }] }],
    [{ name: '总决赛', slots: [{ a: W('胜者组决赛'), b: W('败者组决赛') }] }],
  ],
  places: [
    W('总决赛'), L('总决赛'), L('败者组决赛'), L('败者组第一轮'),
    L(`${KA} 第三轮`), L(`${KB} 第三轮`), L(`${KA} 第二轮`), L(`${KB} 第二轮`), L(`${KA} 第一轮`), L(`${KB} 第一轮`),
  ],
}

/** 2022's Regional Finals: the top two for the third seed, the loser against the lower bracket's winner for the fourth. */
const rf22: Template = {
  waves: [
    [{ name: '胜者组', slots: [{ a: S(1), b: S(2) }] }, { name: '败者组第一轮', slots: [{ a: S(3), b: S(4) }] }],
    [{ name: '败者组决赛', slots: [{ a: L('胜者组'), b: W('败者组第一轮') }] }],
  ],
  places: [W('胜者组'), W('败者组决赛'), L('败者组决赛'), L('败者组第一轮')],
}

/** Worlds 2022's second play-in round: four v seven and five v six, each winner through. */
const pi2: Template = {
  waves: [[{ name: '入围赛 第二轮', slots: [{ a: S(1), b: S(4) }, { a: S(2), b: S(3) }] }]],
  places: [W('入围赛 第二轮', 0), W('入围赛 第二轮', 1), L('入围赛 第二轮', 0), L('入围赛 第二轮', 1)],
}

// ------------------------------------------------------------ building blocks

/** a table, then quarter-finals of 3–6, then the semis reseeded (one meets the lowest left) */
function tableQfSemis(
  region: Region, rr: [number, number], rrBo: 1 | 3, cycles: number, ko: [number, number], opts: { third?: boolean; pick?: boolean; qfBo?: 1 | 3 | 5 } = {},
): Program {
  const mid = Math.round((ko[0] + ko[1]) / 2)
  return {
    phases: [
      { kind: 'rr', key: 'rr', start: rr[0], end: rr[1], bo: rrBo, groups: (ctx) => [{ name: region, teams: tier1(ctx.state, region), cycles }] },
      { kind: 'ko', key: 'qf', start: ko[0], end: ko[0] + 1, bo: 5, template: () => qf4(opts.qfBo), seeds: (ctx) => tableOf(ctx, 'rr').slice(2, 6) },
      {
        kind: 'ko', key: 'sf', start: mid, end: ko[1], bo: 5, template: () => (opts.third ? se4Third : se4),
        seeds: (ctx) => {
          const t = tableOf(ctx, 'rr')
          const won = tableOf(ctx, 'qf').slice(0, 2).sort((a, b) => t.indexOf(a) - t.indexOf(b))
          if (opts.pick) {
            // the first seed picks its semi-final opponent from the two winners
            const p = pickWeakest(ctx.state, [t[0]], won)[0]
            return [t[0], t[1], won.find((x) => x !== p)!, p]
          }
          return [t[0], t[1], won[0], won[1]]
        },
      },
    ],
  }
}

/** a table, then the top n in a gauntlet */
const tableGauntlet = (region: Region, rr: [number, number], rrBo: 1 | 3, cycles: number, ko: [number, number], n: number, names?: string[], firstBo?: 1 | 3 | 5): Program => ({
  phases: [
    { kind: 'rr', key: 'rr', start: rr[0], end: rr[1], bo: rrBo, groups: (ctx) => [{ name: region, teams: tier1(ctx.state, region), cycles }] },
    { kind: 'ko', key: 'po', start: ko[0], end: ko[1], bo: 5, template: () => gauntlet(n, names, firstBo), seeds: (ctx) => tableOf(ctx, 'rr').slice(0, n) },
  ],
})

/** a table, then a bracket from the top of it */
const tableThen = (region: Region, rr: [number, number], rrBo: 1 | 3, cycles: number, ko: [number, number], template: Template, size: number): Program => ({
  phases: [
    { kind: 'rr', key: 'rr', start: rr[0], end: rr[1], bo: rrBo, groups: (ctx) => [{ name: region, teams: tier1(ctx.state, region), cycles }] },
    { kind: 'ko', key: 'po', start: ko[0], end: ko[1], bo: 5, template: () => template, seeds: (ctx) => tableOf(ctx, 'rr').slice(0, size) },
  ],
})

/** LPL 2016: two groups of six by last year's ranking (snake), each a double round robin plus a single round across */
const lpl16Split = (rr: [number, number], ko: [number, number], after?: string): Program => ({
  after: after ? () => [after] : undefined,
  phases: [
    {
      kind: 'rr', key: 'rr', start: rr[0], end: rr[1], bo: 3, crossCycles: 1,
      groups: (ctx) => {
        // the order of the split before (Spring for Summer), else last year's
        const prev = after ? finished(ctx.state, 'stage1', 'LPL') : []
        const r = prev.length ? prev : lastYear(ctx.state, 'LPL')
        const east = r.filter((_, i) => i % 4 === 0 || i % 4 === 3)
        const west = r.filter((_, i) => i % 4 === 1 || i % 4 === 2)
        return [{ name: '东区', teams: east, cycles: 2 }, { name: '西区', teams: west, cycles: 2 }]
      },
    },
    {
      kind: 'ko', key: 'po', start: ko[0], end: ko[1], bo: 5, template: () => lpl16,
      seeds: (ctx) => {
        const x = tableOf(ctx, 'rr', '东区'), y = tableOf(ctx, 'rr', '西区')
        return [x[0], y[0], x[1], y[1], x[2], y[2], x[3], y[3]]
      },
    },
  ],
})

/** LPL 2022: one single round robin of the whole league; the top ten go on, the rest are done for the split */
const lpl22Split = (rr: [number, number], ko: [number, number]): Program => ({
  phases: [
    { kind: 'rr', key: 'rr', start: rr[0], end: rr[1], bo: 3, groups: (ctx) => [{ name: 'LPL', teams: tier1(ctx.state, 'LPL'), cycles: 1 }] },
    { kind: 'ko', key: 'po', start: ko[0], end: ko[1], bo: 5, template: () => lpl22, seeds: (ctx) => tableOf(ctx, 'rr').slice(0, 10) },
  ],
})

/** LEC 2022 Summer: the table's top six, seeded by the year's points (Spring playoffs plus Summer table) */
const lec22Summer: Program = {
  phases: [
    { kind: 'rr', key: 'rr', start: 167, end: 225, bo: 1, groups: (ctx) => [{ name: 'LEC', teams: tier1(ctx.state, 'LEC'), cycles: 2 }] },
    {
      kind: 'ko', key: 'po', start: 237, end: 253, bo: 5, template: () => de6Top4,
      seeds: (ctx) => {
        const t = tableOf(ctx, 'rr').slice(0, 6)
        const spring = finished(ctx.state, 'stage1', 'LEC')
        const pts = (id: string) => (LEC22_SPRING[spring.indexOf(id)] ?? 0) + (LEC22_SUMMER[t.indexOf(id)] ?? 0)
        return t.slice().sort((a, b) => pts(b) - pts(a) || t.indexOf(a) - t.indexOf(b))
      },
    },
  ],
}
const LEC22_SPRING = [90, 70, 50, 30, 20, 10]
const LEC22_SUMMER = [120, 90, 70, 50, 30, 20]

type HSlot = 'stage1' | 'stage2'

const P16: Record<Region, Record<HSlot, Program>> = {
  LPL: { stage1: lpl16Split([13, 100], [103, 113]), stage2: lpl16Split([145, 220], [224, 238], 'stage1:LPL') },
  LCK: {
    stage1: tableGauntlet('LCK', [12, 100], 3, 2, [104, 113], 5, ['外卡赛', '第二轮', '半决赛', '决赛'], 3),
    stage2: tableGauntlet('LCK', [144, 222], 3, 2, [225, 232], 5, ['外卡赛', '第二轮', '半决赛', '决赛'], 3),
  },
  LEC: { stage1: tableQfSemis('LEC', [13, 79], 1, 2, [90, 107], { third: true }), stage2: tableQfSemis('LEC', [153, 225], 1, 4, [230, 240], { third: true }) },
  LCS: { stage1: tableQfSemis('LCS', [15, 79], 1, 2, [90, 107], { third: true }), stage2: tableQfSemis('LCS', [154, 225], 3, 2, [230, 240], { third: true }) },
  LCP: { stage1: tableGauntlet('LCP', [13, 95], 1, 4, [97, 102], 4), stage2: tableGauntlet('LCP', [160, 225], 1, 4, [228, 233], 4) },
  CBLOL: { stage1: tableThen('CBLOL', [15, 75], 1, 2, [80, 92], cblol16, 6), stage2: tableThen('CBLOL', [139, 180], 1, 2, [183, 190], se4, 4) },
}

const P22: Record<Region, Record<HSlot, Program>> = {
  LPL: { stage1: lpl22Split([9, 84], [85, 113]), stage2: lpl22Split([160, 225], [227, 243]) },
  LCK: { stage1: tableQfSemis('LCK', [11, 78], 3, 2, [82, 91]), stage2: tableQfSemis('LCK', [165, 225], 3, 2, [228, 239], { pick: true }) },
  LEC: { stage1: tableThen('LEC', [13, 64], 1, 2, [83, 99], de6Top4, 6), stage2: lec22Summer },
  LCS: { stage1: tableThen('LCS', [35, 85], 1, 2, [91, 113], de6Top4, 6), stage2: tableThen('LCS', [168, 225], 1, 2, [231, 253], de8LplS3, 8) },
  LCP: { stage1: tableThen('LCP', [41, 77], 1, 2, [89, 106], de8LplS3, 8), stage2: tableThen('LCP', [181, 217], 1, 2, [229, 246], de8LplS3, 8) },
  CBLOL: { stage1: tableThen('CBLOL', [21, 95], 1, 2, [98, 112], de6Top4, 6), stage2: tableThen('CBLOL', [161, 218], 1, 2, [224, 245], de6Top4, 6) },
}

/** what each split is, for the standings screen */
const BLURB: Record<string, string> = {
  'h16:LPL': '东西两区各六队：组内双循环、对面组单循环，全部 BO3。各组第一进半决赛、第二进八强、三四名打第一轮，单败 BO5，有季军赛。按名次拿全年积分。',
  'h16:LCK': '十队双循环 BO3。前五打擂台赛：四五名外卡赛（BO3），胜者依次挑战第三、第二、第一（BO5）。按名次拿全年积分。',
  'h16:LEC': '十队双循环，春季 BO1，夏季每对交手两局（这里按两场单局打）。前二进半决赛，3–6 打八强，半决赛第一名对剩下的最低种子，有季军赛，BO5。夏季 8–10 名清空全年积分。',
  'h16:LCS': '十队双循环，春季 BO1、夏季 BO3。前二进半决赛，3–6 打八强，半决赛第一名对剩下的最低种子，有季军赛，BO5。夏季 8–10 名清空全年积分。',
  'h16:LCP': '八队双循环，每对交手两局（这里按两场单局打）。前四打擂台赛 BO5：三四名先打，胜者依次挑战第二、第一。',
  'h16:CBLOL': '八队单循环，每对交手两局（这里按两场单局打）。春季前六进季后赛（八强 BO3），夏季前四单败 BO5。',
  'h22:LPL': '全联盟单循环 BO3，前十进季后赛、其余本赛段结束。3/6/7/10 与 4/5/8/9 各打一条擂台赛，胜者分别挑战第二、第一；之后四队双败 BO5。按名次拿全年积分。',
  'h22:LCK': '十队双循环 BO3。前二进半决赛，3–6 打外卡赛，半决赛第一名对剩下的最低种子（夏季由第一名挑对手），BO5。按名次拿全年积分。',
  'h22:LEC': '十队双循环 BO1，前六进季后赛：前四进胜者组、五六进败者组，双败 BO5。夏季季后赛的种子按全年积分排。',
  'h22:LCS': '十队双循环 BO1。春季前六进双败季后赛，夏季前八：前二直通胜者组半决赛、3–6 进胜者组八强、7–8 从败者组打起，BO5。',
  'h22:LCP': '双循环 BO1，前八进双败季后赛：前二直通胜者组半决赛、3–6 进胜者组八强、7–8 从败者组打起，BO5。',
  'h22:CBLOL': '十队双循环 BO1，前六进季后赛：前四进胜者组、五六进败者组，双败 BO5。',
}

// ------------------------------------------------------------ points

/** Championship Points by finish, Spring then Summer (the Summer champion is seed one and takes none) */
const POINTS: Record<'h16' | 'h22', Partial<Record<Region, [number[], number[]]>>> = {
  h16: {
    LPL: [[300, 200, 100, 80, 50, 50, 40, 40], [0, 300, 200, 90, 70, 70, 50, 50]],
    LCK: [[90, 70, 50, 30, 10], [0, 90, 70, 40, 20]],
    LEC: [[90, 70, 50, 30, 10, 10], [0, 90, 70, 40, 20, 20]],
    LCS: [[90, 70, 50, 30, 10, 10], [0, 90, 70, 40, 20, 20]],
    LCP: [[90, 70, 50, 30, 10], [0, 90, 70, 40, 20]],
  },
  h22: {
    LPL: [[90, 70, 50, 30, 20, 20, 10, 10], [0, 110, 80, 60, 40, 40, 10, 10]],
    LCK: [[90, 70, 50, 30, 20, 10], [0, 100, 80, 50, 30, 10]],
  },
}

const tagOfComp = (state: GameState, region: Region): 'h16' | 'h22' | null => {
  const p = state.comps[`stage1:${region}`]?.program ?? state.comps[`stage2:${region}`]?.program ?? ''
  return p.startsWith('h16:') ? 'h16' : p.startsWith('h22:') ? 'h22' : null
}

/** a region's Championship Points so far this year (empty where the year had none) */
export function histPoints(state: GameState, region: Region): Record<string, number> {
  const tag = tagOfComp(state, region)
  const table = tag ? POINTS[tag][region] : undefined
  const pts: Record<string, number> = {}
  if (!table) return pts
  finished(state, 'stage1', region).forEach((id, i) => { pts[id] = (pts[id] ?? 0) + (table[0][i] ?? 0) })
  const summer = done(state, 'stage2', region)
  summer?.finished.forEach((id, i) => { pts[id] = (pts[id] ?? 0) + (table[1][i] ?? 0) })
  // EU and NA 2016: eighth to tenth in the Summer table lose the year's points
  if (tag === 'h16' && (region === 'LEC' || region === 'LCS') && summer) {
    for (const id of summer.prog?.res.rr?.order.slice(7) ?? []) pts[id] = 0
  }
  return pts
}

/** the points order behind the Summer champion: ties go to the better Summer finish */
function pointsOrder(state: GameState, region: Region): string[] {
  const s = finished(state, 'stage2', region)
  const pts = histPoints(state, region)
  const champ = s[0]
  const at = (id: string) => (s.includes(id) ? s.indexOf(id) : 99)
  return tier1(state, region).filter((id) => id !== champ).sort((a, b) => (pts[b] ?? 0) - (pts[a] ?? 0) || at(a) - at(b))
}

// ------------------------------------------------------------ qualification

/** the regions with a Regional Finals in an era */
export const rfRegions = (tag: 'h16' | 'h22'): Region[] => (tag === 'h16' ? ['LPL', 'LCK', 'LEC', 'LCS', 'LCP'] : ['LPL', 'LCK'])

/** who plays a region's Regional Finals, in seed order */
export function rfField(state: GameState, region: Region): string[] {
  const tag = tagOfComp(state, region)
  if (!tag || !rfRegions(tag).includes(region) || !done(state, 'stage2', region)) return []
  const order = pointsOrder(state, region)
  // LMS's points leader has no seed of its own: second to fifth play for the one place
  if (tag === 'h16' && region === 'LCP') return order.slice(0, 4)
  return order.slice(1, 5)
}

export function rfProgram(state: GameState, region: Region): Program {
  const tag = tagOfComp(state, region)
  const field = () => rfField(state, region)
  if (tag === 'h22') {
    return {
      blurb: '全年积分其后四队：前两名打胜者组，胜者是三号种子；后两名打败者组，胜者再打胜者组的负者，赢的是四号种子（去入围赛）。BO5。',
      phases: [{ kind: 'ko', key: 'rf', start: region === 'LPL' ? 244 : 243, end: 246, bo: 5, template: () => rf22, seeds: field }],
    }
  }
  if (region === 'LCP') {
    return {
      blurb: '全年积分第二到第五名打四队单败 BO5，冠军拿最后一个全球总决赛名额。',
      phases: [{ kind: 'ko', key: 'rf', start: 243, end: 246, bo: 5, template: () => se4, seeds: field }],
    }
  }
  return {
    blurb: '全年积分第三到第六名打擂台赛 BO5：最低两名先打，胜者依次挑战第四、第三，最后的胜者是三号种子。',
    phases: [{ kind: 'ko', key: 'rf', start: 240, end: 248, bo: 5, template: () => gauntlet(4, ['第一轮', '第二轮', '决赛']), seeds: field }],
  }
}

/** MSI: every region's Spring champion (2016: CBLOL's stands in for the wildcard) */
export function histMsiSeeds(state: GameState): Record<Region, string[]> {
  const out = {} as Record<Region, string[]>
  for (const r of T1_REGIONS) out[r] = finished(state, 'stage1', r).slice(0, 1)
  return out
}

/** Worlds, a region's seeds in order, once its Summer (and Regional Finals) are over; null before */
export function histWorldsSeeds(state: GameState, region: Region): string[] | null {
  const tag = tagOfComp(state, region)
  const s = finished(state, 'stage2', region)
  if (!tag || !s.length) return null
  const needsRf = rfRegions(tag).includes(region)
  const rf = state.comps[`qual:${region}`]
  if (needsRf && rfField(state, region).length >= 2 && !rf?.champion) return null
  const rfOrder = rf?.champion ? rf.finished : []
  const lead = pointsOrder(state, region)[0]
  if (tag === 'h16') {
    if (region === 'CBLOL') return s.slice(0, 1)
    if (region === 'LCP') return [s[0], rfOrder[0]].filter(Boolean)
    return [...new Set([s[0], lead, rfOrder[0]].filter(Boolean))]
  }
  if (region === 'LPL' || region === 'LCK') return [...new Set([s[0], lead, rfOrder[0], rfOrder[1]].filter(Boolean))]
  if (region === 'LEC') return s.slice(0, 4)
  if (region === 'LCS') return s.slice(0, 3)
  if (region === 'LCP') return s.slice(0, 2)
  return s.slice(0, 1)
}

/** 2022: how many of a region's seeds go straight to the groups (the rest play in) */
const DIRECT_22: Record<Region, number> = { LPL: 3, LCK: 3, LEC: 2, LCS: 2, LCP: 1, CBLOL: 0 }

// ------------------------------------------------------------ the draws

/** a number fixed by the save and the year, for drawing groups */
const h = (state: GameState, s: string) => hashStr(`${state.seed}:${state.year}:${s}`)

/**
 * Draw pots into groups, one from each pot per group as far as it goes, two
 * teams of a region in one group only when nothing else fits.
 */
export function drawPots(state: GameState, key: string, pots: string[][], nGroups: number): string[][] {
  const groups: string[][] = Array.from({ length: nGroups }, () => [])
  const reg = (id: string) => state.teams[id]?.region
  for (const [pi, pot] of pots.entries()) {
    const order = pot.slice().sort((a, b) => h(state, `${key}:${pi}:${a}`) - h(state, `${key}:${pi}:${b}`))
    // how many of this pot each group takes: the smaller groups first, as evenly as it goes
    const cap = groups.map(() => 0)
    const byFill = groups.map((g, i) => ({ i, n: g.length })).sort((a, b) => a.n - b.n || a.i - b.i)
    for (let k = 0; k < order.length; k++) cap[byFill[k % nGroups].i]++
    // the assignment with the fewest same-region meetings, the first such in draw order
    let best: number[] | null = null, bestClash = Infinity
    const at: number[] = []
    const search = (k: number, clash: number) => {
      if (clash >= bestClash) return
      if (k === order.length) { best = at.slice(); bestClash = clash; return }
      for (let gi = 0; gi < nGroups; gi++) {
        if (!cap[gi]) continue
        const c = [...groups[gi], ...order.filter((_, j) => j < k && at[j] === gi)].filter((x) => reg(x) === reg(order[k])).length
        cap[gi]--; at[k] = gi
        search(k + 1, clash + c)
        cap[gi]++
        if (bestClash === 0) return
      }
    }
    search(0, 0)
    order.forEach((id, k) => groups[best![k]].push(id))
  }
  return groups
}

const GROUP_NAMES = ['A组', 'B组', 'C组', 'D组']

/** eight from four groups: each winner meets another group's runner-up, A and C on one side */
const ko8FromGroups = (ctx: Ctx): string[] => {
  const g = GROUP_NAMES.map((n) => tableOf(ctx, 'grp', n))
  const [A, B, C, D] = g
  return [A[0], B[0], D[0], C[0], D[1], C[1], A[1], B[1]].filter(Boolean)
}

export function histMsiProgram(state: GameState, tag: 'h16' | 'h22'): Program {
  const seeds = T1_REGIONS.flatMap((r) => histMsiSeeds(state)[r])
  if (tag === 'h16') {
    return {
      blurb: '各赛区春季赛冠军（巴西代表外卡）。六队双循环 BO1，前四进单败淘汰 BO5。',
      phases: [
        { kind: 'rr', key: 'grp', start: 124, end: 128, bo: 1, groups: () => [{ name: 'MSI', teams: seeds, cycles: 2 }] },
        { kind: 'ko', key: 'ko', start: 133, end: 135, bo: 5, template: () => se4, seeds: (ctx) => tableOf(ctx, 'grp').slice(0, 4) },
      ],
    }
  }
  return {
    blurb: '各赛区春季赛冠军直接进对抗赛（小组赛的其他对手来自游戏没有的赛区）：六队双循环 BO1，前四进淘汰赛，对抗赛第一从第三、第四里挑半决赛对手，BO5。',
    phases: [
      { kind: 'rr', key: 'grp', start: 129, end: 141, bo: 1, groups: () => [{ name: '对抗赛', teams: seeds, cycles: 2 }] },
      {
        kind: 'ko', key: 'ko', start: 146, end: 148, bo: 5, template: () => se4,
        seeds: (ctx) => {
          const t = tableOf(ctx, 'grp')
          const p = pickWeakest(ctx.state, [t[0]], [t[2], t[3]])[0]
          return [t[0], t[1], p === t[2] ? t[3] : t[2], p]
        },
      },
    ],
  }
}

export function histWorldsProgram(state: GameState, tag: 'h16' | 'h22'): Program {
  const per = Object.fromEntries(T1_REGIONS.map((r) => [r, histWorldsSeeds(state, r) ?? []])) as Record<Region, string[]>
  const nth = (r: Region, i: number) => per[r][i]
  if (tag === 'h16') {
    const pots = [
      [nth('LCK', 0), nth('LPL', 0), nth('LCS', 0), nth('LCP', 0)],
      [nth('LEC', 0), nth('LCK', 1), nth('LPL', 1), nth('LEC', 1), nth('LCS', 1), nth('LCP', 1), nth('LCK', 2), nth('LPL', 2)],
      [nth('LCS', 2), nth('LEC', 2), nth('CBLOL', 0)],
    ].map((p) => p.filter(Boolean))
    return {
      blurb: '没有入围赛：各赛区种子分三档抽进四个小组（同赛区尽量不同组），组内双循环 BO1，前二进八强。八强单败 BO5。外卡资格赛不模拟，巴西冠军直接占外卡席位。',
      phases: [
        {
          kind: 'rr', key: 'grp', start: 272, end: 282, bo: 1,
          groups: (ctx) => drawPots(ctx.state, 'w16', pots, 4).map((teams, i) => ({ name: GROUP_NAMES[i], teams, cycles: 2 })),
        },
        { kind: 'ko', key: 'ko', start: 286, end: 302, bo: 5, template: () => se8, seeds: ko8FromGroups },
      ],
    }
  }
  const direct = (r: Region) => per[r].slice(0, DIRECT_22[r])
  const playIn = T1_REGIONS.flatMap((r) => per[r].slice(DIRECT_22[r]))
  return {
    blurb: '入围赛七队单循环 BO1，前三晋级，4v7、5v6 两场 BO5 各再出一队。小组赛四组双循环 BO1（同赛区尽量不同组），前二进八强，单败 BO5。',
    phases: [
      { kind: 'rr', key: 'pi', start: 271, end: 275, bo: 1, groups: () => [{ name: '入围赛', teams: playIn, cycles: 1 }] },
      { kind: 'ko', key: 'pi2', start: 276, end: 277, bo: 5, template: () => pi2, seeds: (ctx) => tableOf(ctx, 'pi').slice(3, 7) },
      {
        kind: 'rr', key: 'grp', start: 280, end: 289, bo: 1,
        groups: (ctx) => {
          const through = [...tableOf(ctx, 'pi').slice(0, 3), ...tableOf(ctx, 'pi2').slice(0, 2)]
          const p1 = [direct('LPL')[0], direct('LCK')[0], direct('LEC')[0], direct('LCS')[0]]
          const p2 = [direct('LPL')[1], direct('LCK')[1], direct('LEC')[1], direct('LCP')[0]]
          const p3 = [direct('LPL')[2], direct('LCK')[2], direct('LCS')[1]]
          const pots = [p1, p2, p3, through].map((p) => p.filter(Boolean))
          return drawPots(ctx.state, 'w22', pots, 4).map((teams, i) => ({ name: GROUP_NAMES[i], teams, cycles: 2 }))
        },
      },
      { kind: 'ko', key: 'ko', start: 292, end: 308, bo: 5, template: () => se8, seeds: ko8FromGroups },
    ],
  }
}

// ------------------------------------------------------------ dispatch

/** the program a historical competition runs, by its key (`h16:LPL:stage1`, `h22:msi`, `h16:rf:LCK`…) */
export function histProgramFor(state: GameState, comp: Competition): Program | null {
  const [tag, a, b] = (comp.program ?? '').split(':') as ['h16' | 'h22', string, string]
  if (tag !== 'h16' && tag !== 'h22') return null
  if (a === 'msi') return histMsiProgram(state, tag)
  if (a === 'worlds') return histWorldsProgram(state, tag)
  if (a === 'rf') return rfProgram(state, b as Region)
  const p = (tag === 'h16' ? P16 : P22)[a as Region]?.[b as HSlot]
  return p ? { ...p, blurb: BLURB[`${tag}:${a}`] } : null
}

/** what a historical split sends on, in a few words */
export function histQualLine(tag: 'h16' | 'h22', region: Region, slot: HSlot): string {
  if (slot === 'stage1') return tag === 'h16' && region === 'CBLOL' ? '冠军代表外卡去 MSI' : '冠军去 MSI'
  if (tag === 'h16') {
    if (region === 'CBLOL') return '冠军代表外卡去全球总决赛'
    if (region === 'LCP') return '冠军是一号种子；全年积分第二到第五打区域资格赛争二号种子'
    return '冠军是一号种子，全年积分第一是二号种子，积分第三到第六打区域资格赛争三号种子'
  }
  if (region === 'LPL' || region === 'LCK') return '冠军是一号种子，全年积分第一是二号种子，积分其后四队打区域资格赛争三、四号种子'
  if (region === 'LEC') return '季后赛前 4 去全球总决赛（3、4 号种子打入围赛）'
  if (region === 'LCS') return '季后赛前 3 去全球总决赛（3 号种子打入围赛）'
  if (region === 'LCP') return '季后赛前 2 去全球总决赛（2 号种子打入围赛）'
  return '冠军去全球总决赛入围赛'
}

/** the year's ranking of each league, for next year's seeding: Summer, then Spring */
export function histSeasonRanking(state: GameState): Partial<Record<Region, string[]>> {
  const out: Partial<Record<Region, string[]>> = {}
  for (const r of T1_REGIONS) {
    const s2 = finished(state, 'stage2', r)
    if (!s2.length) continue
    const s1 = finished(state, 'stage1', r)
    const at = (list: string[], id: string) => (list.includes(id) ? list.indexOf(id) : 99)
    out[r] = tier1(state, r).sort((a, b) => at(s2, a) - at(s2, b) || at(s1, a) - at(s1, b))
  }
  return out
}

export { tagOfComp }

// ------------------------------------------------------------ one face for both eras


/** the program a competition runs, whichever era wrote it */
export const anyProgramFor = (state: GameState, comp: Competition): Program | null =>
  histProgramFor(state, comp) ?? programFor(state, comp)

/** the era a region's year is being played in, read off its competitions (the year's rules were fixed when they were drawn up) */
export const histTag = (state: GameState, region?: Region): 'h16' | 'h22' | null =>
  tagOfComp(state, region ?? (state.teams[state.myTeam]?.region as Region) ?? 'LPL')

/** which international a regional stage feeds */
export function anyEventOf(state: GameState, slot: 'kickoff' | 'stage1' | 'stage2'): 'masters1' | 'masters2' | 'champions' {
  if (histTag(state)) return slot === 'stage2' ? 'champions' : 'masters2'
  return EVENT_OF_2026[slot]
}

export const ANY_EVENT_CN = EVENT_CN_2026

/** what a stage sends on, in a few words */
export function anyQualLine(state: GameState, region: Region, slot: 'kickoff' | 'stage1' | 'stage2'): string {
  const tag = histTag(state, region)
  if (tag && slot !== 'kickoff') return histQualLine(tag, region, slot)
  return qualLine(region, slot)
}

/** a region's seeds for an event once they are known, else null */
export function anyEventSeeds(state: GameState, ev: 'masters1' | 'masters2' | 'champions', region: Region): string[] | null {
  const tag = histTag(state, region)
  if (!tag) return eventSeeds(state, ev, region)
  if (ev === 'masters1') return null
  if (ev === 'masters2') return done(state, 'stage1', region) ? histMsiSeeds(state)[region] : null
  return histWorldsSeeds(state, region)
}

/** a region's Championship Points, where its year keeps them (null where it does not) */
export function anyPoints(state: GameState, region: Region): Record<string, number> | null {
  const tag = histTag(state, region)
  if (tag) return POINTS[tag][region] ? histPoints(state, region) : null
  return region === 'LPL' ? lplPoints(state) : null
}

/** how a region's points are given, for the qualification panel */
export function pointsNote(state: GameState, region: Region): string {
  const tag = histTag(state, region)
  const t = tag ? POINTS[tag][region] : undefined
  if (!t) return ''
  const wipe = tag === 'h16' && (region === 'LEC' || region === 'LCS') ? '夏季常规赛 8–10 名清空全年积分。' : ''
  return `积分：春季赛 ${t[0].join('/')}，夏季赛（冠军之外）${t[1].slice(1).join('/')}。${wipe}`
}

/**
 * The leagues that still relegated at the end of a year: LPL and NA LCS until
 * they franchised for 2018, EU LCS until 2019, LCK and CBLOL until 2021, LMS
 * while it existed. (2016 also had a mid-year round after Spring; that one is
 * not played — 决定 D69.)
 */
const RELEGATES_UNTIL: Partial<Record<Region, number>> = { LPL: 2017, LCS: 2017, LEC: 2018, LCK: 2020, CBLOL: 2020, LCP: 2019 }
export const relegatesIn = (region: Region, year: number): boolean => year <= (RELEGATES_UNTIL[region] ?? 0)
