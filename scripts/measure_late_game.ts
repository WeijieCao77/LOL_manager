/**
 * How easy is the late game? (ported from VAL MANAGER, 2026-09-23)
 *
 *   npx tsx scripts/measure_late_game.ts [seasons=2] [seeds=2]
 *   MAX=1        every season opens with the five trained out (attributes to 97)
 *   TEAM=BLG  DIFF=normal|hard|pro
 *   ROTATE=1     a manager who changes his dials every week — the counterplay to being read
 *
 * The managed club is run by a stand-in manager who does what a player would do
 * without thinking: the recommended personal focus, the drill an AI club would
 * pick, the board pinned so the clock never stops. Prints per season: series
 * record, record against the AI top eight, titles, heat, and the mean per-game
 * edge terms against the top eight (EDGES=1).
 */
import { createNewGame } from '../src/engine/world'
import { squadOf } from '../src/engine/roster'
import { WORLD_TEAMS } from '../src/engine/teams'
import { advanceDay, continuePastFive, setupSeason } from '../src/engine/season'
import { trainingAdvice, aiDrillFor } from '../src/engine/training'
import { recomputeOverall } from '../src/engine/player'
import { poolFor } from '../src/engine/match'
import type { GameState } from '../src/engine/types'
import { DIFFICULTY } from '../src/engine/difficulty'

// calibration knobs, never set in play: PREP=1.5 scales every level's prep cap,
// KNEE=-2 moves every level's knee, SLOPE=0.8 scales every level's slope
for (const d of Object.values(DIFFICULTY)) {
  if (process.env.PREP) d.prepMax *= Number(process.env.PREP)
  if (process.env.KNEE) d.topKnee += Number(process.env.KNEE)
  if (process.env.SLOPE) d.topSlope *= Number(process.env.SLOPE)
}

const SEASONS = Number(process.argv[2] ?? 2)
const SEEDS = Number(process.argv[3] ?? 2)
const MAX = process.env.MAX === '1'
const TAG = process.env.TEAM ?? 'BLG'
const DIFF = process.env.DIFF
const ROTATE = process.env.ROTATE === '1'
const PLANS = [
  { pace: 50, utility: 55, aggression: 50, adaptability: 50 },
  { pace: 30, utility: 70, aggression: 35, adaptability: 65 },
  { pace: 70, utility: 45, aggression: 65, adaptability: 40 },
]

const pct = (a: number, b: number) => b ? `${(100 * a / b).toFixed(0)}%` : '-'
const tot = { w: 0, l: 0, tw: 0, tl: 0, gw: 0, gl: 0, titles: 0, seasons: 0 }
const gap: Record<string, number> = {}
let gapN = 0

function maxOut(g: GameState) {
  for (const p of squadOf(g, g.myTeam)) {
    for (const k of Object.keys(p.attrs) as (keyof typeof p.attrs)[]) p.attrs[k] = Math.max(p.attrs[k], 97)
    p.potential = Math.max(p.potential, 99)
    recomputeOverall(p)
  }
}

for (let s = 0; s < SEEDS; s++) {
  const seed = 20260923 + s * 101
  const g = createNewGame(WORLD_TEAMS.find((t) => t.tag === TAG)!.id, '审计', seed)
  if (DIFF) (g as unknown as { difficulty: string }).difficulty = DIFF
  setupSeason(g)
  for (let y = 0; y < SEASONS; y++) {
    const year = g.year
    if (MAX) maxOut(g)
    const rank = Object.values(g.teams).filter((t) => t.id !== g.myTeam && t.tier === 1)
      .sort((a, b) => b.rating - a.rating).slice(0, 8).map((t) => t.id)
    let w = 0, l = 0, tw = 0, tl = 0
    const honours0 = g.honours.length
    let guard = 0
    while (g.year === year && guard++ < 500) {
      g.boardConfidence = 100; g.onNotice = false; g.missedStreak = 0
      if (g.midReview) continuePastFive(g)
      if (g.day % 7 === 0) {
        for (const p of squadOf(g, g.myTeam)) g.training[p.id] = trainingAdvice(p, g.day).focus
        if (ROTATE) {
          g.mapTactics = {}
          poolFor(g).forEach((m, i) => { g.mapTactics![m] = { ...PLANS[(i + g.day / 7) % 3] } })
        }
      }
      if (g.drillLock == null) { g.drill = aiDrillFor(g, g.teams[g.myTeam]); g.drillLock = g.day + 7 }
      const r = advanceDay(g, { autoResolveDrawDecisions: true })
      for (const f of r.playedMine) {
        if (f.comp === 'scrim' || !f.result) continue
        const mineA = f.teamA === g.myTeam
        const won = (f.result.mapsWonA > f.result.mapsWonB) === mineA
        const opp = mineA ? f.teamB : f.teamA
        won ? w++ : l++
        for (const m of f.result.maps) ((m.scoreA > m.scoreB) === mineA ? tot.gw++ : tot.gl++)
        if (rank.includes(opp)) {
          won ? tw++ : tl++
          for (const m of f.result.maps) {
            if (!m.edge) continue
            const me = mineA ? m.edge.a : m.edge.b
            const them = mineA ? m.edge.b : m.edge.a
            for (const k of new Set([...Object.keys(me), ...Object.keys(them)])) {
              gap[k] = (gap[k] ?? 0) + (Number((me as never)[k] ?? 0) - Number((them as never)[k] ?? 0))
            }
            gapN++
          }
        }
      }
    }
    const got = g.honours.slice(honours0).map((h) => h.title)
    tot.w += w; tot.l += l; tot.tw += tw; tot.tl += tl; tot.titles += got.length; tot.seasons++
    const five = squadOf(g, g.myTeam).sort((a, b) => b.overall - a.overall).slice(0, 5)
    const sc = g.scout
    console.log(`seed ${seed} ${year}: ${w}-${l} (${pct(w, w + l)}) · vs AI前八 ${tw}-${tl} (${pct(tw, tw + tl)}) · 冠军 ${got.join(' / ') || '无'} · 五人 ${(five.reduce((a, p) => a + p.overall, 0) / 5).toFixed(1)}` +
      (sc ? ` · 针对 ${sc.heat}${g.nemesis ? ` 宿敌 ${g.teams[g.nemesis.teamId].tag}` : ''}` : ''))
  }
}
console.log(`\n合计 ${tot.seasons} 季：系列赛 ${tot.w}-${tot.l} (${pct(tot.w, tot.w + tot.l)}) · 单局 ${pct(tot.gw, tot.gw + tot.gl)} · vs AI前八 ${tot.tw}-${tot.tl} (${pct(tot.tw, tot.tw + tot.tl)}) · 冠军 ${(tot.titles / tot.seasons).toFixed(2)}/季`)
if (process.env.EDGES === '1') {
  console.log('对 AI 前八每局的平均差（我 − 对手）：')
  console.log(Object.entries(gap).map(([k, v]) => `${k} ${(v / Math.max(1, gapN)).toFixed(2)}`).join(' · '))
}
