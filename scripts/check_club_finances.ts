/**
 * Do the world's clubs stay solvent, region by region, over a few seasons?
 *
 *   npx tsx scripts/check_club_finances.ts [seasons=3] [seed=20261005]
 *
 * The economy was tuned on VALORANT's scale, where a regional title paid
 * $380k in every region. League's real prize money is far smaller and far
 * more uneven (an LCP split's whole pool is $80k; an LPL Split 3 champion
 * takes CNY 1.7M) — real clubs live on sponsors and the league's revenue
 * share, not prizes (决定 D77). Whatever the prize table says, the world must
 * not go broke: this plays seasons headless and reads every AI club's budget.
 *
 * Prints, per region and tier: the median budget at the start and at the end,
 * and how many clubs ended in the red. Fails when more than a tenth of the
 * tier-one clubs, or any whole region's median, ends below zero.
 */
import { createNewGame } from '../src/engine/world'
import { WORLD_TEAMS } from '../src/engine/teams'
import { advanceDay, continuePastFive, setupSeason, HEADLESS } from '../src/engine/season'
import type { GameState, Region } from '../src/engine/types'

HEADLESS.noDismissal = true
const SEASONS = Number(process.argv[2] ?? 3)
const SEED = Number(process.argv[3] ?? 20261005)
let bad = 0
const check = (ok: boolean, what: string, detail = '') => {
  if (!ok) bad++
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${detail ? ` — ${detail}` : ''}`)
}
const median = (xs: number[]) => { const s = xs.slice().sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : 0 }
const k = (n: number) => `${Math.round(n / 1000)}k`

const g: GameState = createNewGame(WORLD_TEAMS.find((t) => t.tag === 'BLG')!.id, '审计', SEED)
setupSeason(g)
const start = new Map(Object.values(g.teams).map((t) => [t.id, t.budget]))
const year0 = g.year
let guard = 0
while (g.year < year0 + SEASONS && guard++ < 420 * SEASONS) {
  g.boardConfidence = 90; g.onNotice = false; g.missedStreak = 0
  if (g.midReview) continuePastFive(g)
  advanceDay(g, { autoResolveDrawDecisions: true })
}
check(g.year === year0 + SEASONS, `${SEASONS} 个赛季走完`)

const REGIONS: Region[] = ['LPL', 'LCK', 'LEC', 'LCS', 'LCP', 'CBLOL']
let t1 = 0, t1red = 0
for (const tier of [1, 2] as const) {
  for (const r of REGIONS) {
    const clubs = Object.values(g.teams).filter((t) => t.region === r && t.tier === tier && t.id !== g.myTeam)
    if (!clubs.length) continue
    const red = clubs.filter((t) => t.budget < 0).length
    if (tier === 1) { t1 += clubs.length; t1red += red }
    const m0 = median(clubs.map((t) => start.get(t.id) ?? 0)), m1 = median(clubs.map((t) => t.budget))
    console.log(`     ${tier === 1 ? '一级' : '次级'} ${r.padEnd(5)} ${String(clubs.length).padStart(2)} 队  中位预算 ${k(m0)} → ${k(m1)}  赤字 ${red}`)
    if (tier === 1) check(m1 >= 0, `${r} 一级联赛的中位俱乐部没有赤字`, k(m1))
  }
}
check(t1red <= t1 / 10, '一级联赛赤字的俱乐部不超过一成', `${t1red}/${t1}`)
console.log(bad ? `\n❌ ${bad} 项不通过` : '\n✅ 世界的账本撑得住')
process.exit(bad ? 1 : 0)
