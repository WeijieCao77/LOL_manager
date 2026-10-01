/**
 * The real formats of the years a historical career plays (programsHist.ts).
 *
 *   npx tsx scripts/check_hist_formats.ts [startYear=2016] [seasons=1]
 *
 * Plays a career from a past year headless and holds each year against
 * docs/调研-2016与2022赛制.md:
 *   - no First Stand; every region plays a Spring and a Summer split under the
 *     league's name of that year (EU LCS, NA LCS, LMS, PCS…), in their windows
 *   - MSI has one team a region; the Regional Finals are played where the year
 *     had them; Worlds has fifteen (2016: 14 + Brazil's wildcard) or eighteen
 *     (2022: 11 straight to the groups, 7 in the play-in) and four groups
 *   - each region's Worlds seeds follow the year's rule (Summer champion,
 *     points leader, Regional Finals)
 *   - nobody plays two games on one day; every fixture sits inside its stage
 *   - the year ends and the next one opens — including when the era turns
 *     (2018 → 2019, 2024 → 2025)
 */
import { createNewGame } from '../src/engine/world'
import { advanceDay, continuePastFive, setupSeason, HEADLESS } from '../src/engine/season'
import { loadWorld } from '../src/engine/eras'
import { ensureHistory } from '../src/engine/realHistory'
import { stagesOf } from '../src/engine/rulebook'
import { T1_REGIONS } from '../src/engine/programs2026'
import { eraOf, histPoints, histWorldsSeeds, relegatesIn } from '../src/engine/programsHist'
import { leagueLabel } from '../src/engine/leagueNames'
import { qualification } from '../src/engine/qualify'
import type { Fixture, GameState } from '../src/engine/types'

HEADLESS.noDismissal = true
const START = Number(process.argv[2] ?? 2016)
const SEASONS = Number(process.argv[3] ?? 1)
let bad = 0
const check = (ok: boolean, what: string, detail = '') => {
  if (!ok) bad++
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${detail ? ` — ${detail}` : ''}`)
}

async function main() {
  await ensureHistory()
  const world = await loadWorld(START)
  if (!world) { console.log(`FAIL 没有 ${START} 年的世界`); process.exit(1) }
  const me = world.teams.find((t) => t.tier === 1 && t.region === 'LCK')!
  const g: GameState = createNewGame(me.id, '审计', 20261004, undefined, { world, year: START })
  setupSeason(g)
  const tag = (id: string) => g.teams[id]?.tag ?? id

  for (let s = 0; s < SEASONS; s++) {
    const year = g.year
    const era = eraOf(year)
    console.log(`\n== ${year}（按 ${era} 年的赛制）`)
    const stages = stagesOf(g)
    const seen = new Map<string, Fixture>()
    let snap: GameState | null = null
    const quals = new Set<string>()
    const t1Before = Object.fromEntries(T1_REGIONS.map((r) => [r, Object.values(g.teams).filter((t) => t.region === r && t.tier === 1).map((t) => t.id)]))
    let guard = 0
    while (g.year === year && guard++ < 420) {
      if (g.midReview) continuePastFive(g)
      advanceDay(g, { autoResolveDrawDecisions: true })
      for (const f of g.fixtures) if (f.played && !seen.has(f.id)) seen.set(f.id, { ...f })
      const q = qualification(g)
      if (q) quals.add(q.headline.replace(/\d+/g, '#'))
      if (g.comps.champions?.champion && !snap) snap = JSON.parse(JSON.stringify(g))
    }
    check(g.year === year + 1, `${year} 年走完`, `${g.year} 年 第 ${g.day} 天`)
    const S = snap ?? g
    const fx = [...seen.values()]
    // the year-end swap where the year really had one
    for (const r of T1_REGIONS) {
      const now = Object.values(g.teams).filter((t) => t.region === r && t.tier === 1).map((t) => t.id)
      const up = now.filter((id) => !t1Before[r].includes(id)), down = t1Before[r].filter((id) => !now.includes(id))
      const hasTier2 = !!S.comps[`challengers2:${r}`]?.champion
      const want = era !== 2026 && relegatesIn(r, year) && hasTier2 ? 1 : 0
      check(up.length === want && down.length === want, `${year} ${leagueLabel(year, r)} 年末升降级 ${want ? '一换一' : '没有'}`,
        want ? `${up.map(tag).join('')} 升 · ${down.map(tag).join('')} 降（夏季赛末名 ${tag(S.comps[`stage2:${r}`]?.finished.slice(-1)[0] ?? '')}）` : '')
    }

    if (era === 2026) {
      check(!!S.comps.masters1?.champion, `${year}：2025 年起回到 2026 年的赛制（有 First Stand）`)
      continue
    }
    check(!S.comps.masters1 && !Object.keys(S.comps).some((k) => k.startsWith('kickoff:')), `${year}：没有 First Stand，也没有第一赛段`)
    for (const r of T1_REGIONS) {
      const s1 = S.comps[`stage1:${r}`], s2 = S.comps[`stage2:${r}`]
      const label = leagueLabel(year, r)
      check(!!s1?.champion && !!s2?.champion && s1.name === `${label} 春季赛` && s2.name === `${label} 夏季赛`,
        `${year} ${label}：春季赛、夏季赛都打完`, `${s1?.name} 冠军 ${tag(s1?.champion ?? '')} · ${s2?.name} 冠军 ${tag(s2?.champion ?? '')}`)
      const pts = histPoints(S, r)
      if (Object.keys(pts).length) {
        const top = Object.entries(pts).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([id, p]) => `${tag(id)} ${p}`).join(' ')
        console.log(`     ${label} 全年积分：${top}`)
      }
    }
    const msi = S.comps.masters2
    check(!!msi?.champion && msi.teams.length === 6 && new Set(msi.teams.map((id) => S.teams[id].region)).size === 6,
      `${year} MSI：六个赛区各一队`, `${msi?.teams.length} 队 · 冠军 ${tag(msi?.champion ?? '')}（${msi?.city}）`)
    const rfs = Object.values(S.comps).filter((c) => c.key.startsWith('qual:'))
    const wantRf = era === 2016 ? 5 : 2
    check(rfs.length === wantRf && rfs.every((c) => !!c.champion), `${year} 区域资格赛 ${wantRf} 个，都打完`, rfs.map((c) => `${c.name} ${c.teams.length} 队 → ${tag(c.finished[0])}`).join('；'))
    const w = S.comps.champions
    const wantW = era === 2016 ? 15 : 18
    check(!!w?.champion && w.teams.length === wantW, `${year} 全球总决赛 ${wantW} 队，打完`, `${w?.teams.length} 队 · 冠军 ${tag(w?.champion ?? '')}（${w?.city}）`)
    const groups = w?.prog?.groups.grp ?? []
    check(groups.length === 4 && groups.reduce((n, x) => n + x.teams.length, 0) === 16 - (era === 2016 ? 1 : 0),
      `${year} 全球总决赛小组赛四组`, groups.map((x) => `${x.name} ${x.teams.map(tag).join('/')}`).join('  '))
    const sameRegion = groups.filter((x) => new Set(x.teams.map((id) => S.teams[id].region)).size < x.teams.length).length
    check(sameRegion <= 1, `${year} 小组里同赛区相遇不超过一组`, `${sameRegion} 组`)
    for (const r of T1_REGIONS) {
      const seeds = histWorldsSeeds(S, r) ?? []
      const want = era === 2016 ? { LPL: 3, LCK: 3, LEC: 3, LCS: 3, LCP: 2, CBLOL: 1 }[r] : { LPL: 4, LCK: 4, LEC: 4, LCS: 3, LCP: 2, CBLOL: 1 }[r]
      check(seeds.length === want && seeds.every((id) => w?.teams.includes(id)), `${year} ${leagueLabel(year, r)} 全球总决赛 ${want} 个名额`, seeds.map(tag).join(' '))
    }
    // the days: inside the stage windows, nobody twice on one day
    const win = (key: string) => stages.find((x) => x.key === key)
    const outside = fx.filter((f) => {
      const st = win(f.stage)
      return st && (f.day < st.start || f.day > st.end)
    })
    check(outside.length === 0, `${year} 每场比赛都在本阶段的日期窗口里`, outside.slice(0, 3).map((f) => `${f.comp} ${f.label} 第 ${f.day} 天`).join('；'))
    const busy = new Map<string, number>()
    for (const f of fx) for (const id of [f.teamA, f.teamB]) busy.set(`${id}@${f.day}`, (busy.get(`${id}@${f.day}`) ?? 0) + 1)
    const twice = [...busy.entries()].filter(([, n]) => n > 1)
    check(twice.length === 0, `${year} 没有一队一天打两场`, twice.slice(0, 3).map(([k]) => k).join(' '))
    const bo = new Set(fx.filter((f) => f.comp === 'stage2:LEC' && f.label.startsWith('常规赛')).map((f) => f.bo))
    console.log(`     晋级形势里出现过的说法：${[...quals].slice(0, 6).join(' / ')}`)
    void bo
  }
  console.log(bad ? `\n❌ ${bad} 项不通过` : '\n✅ 历史年份按当年的真实赛制打')
  process.exit(bad ? 1 : 0)
}
void main()
