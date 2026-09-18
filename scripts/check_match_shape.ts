/**
 * Does a simulated game look like a real one?
 *
 *   npx tsx scripts/check_match_shape.ts [games]
 *
 * The targets are measured, not chosen: 5,308 games in the LPL, LCK, LEC and
 * LCS, 2024–2026, from Oracle's Elixir (analysis/lol — the numbers are printed
 * by the snippet in docs/调研-选手数值与年龄曲线.md's companion study). A
 * simulated game has to land inside a band around each of them, because every
 * one is something a player will notice if it is wrong: games that all end at
 * twenty-five minutes, a scoreboard where the loser out-kills the winner half
 * the time, a fifteen-minute lead that means nothing — or everything.
 */
import { createNewGame } from '../src/engine/world'
import { buildLineup, MapSim } from '../src/engine/match'
import { Rng } from '../src/engine/rng'
import { MAPS } from '../src/engine/content'

const N = Number(process.argv[2] ?? 4000)
const state = createNewGame('T1', 'shape', 20260918)
const rng = new Rng(20260918)
const map = MAPS[0]

// same-league pairs only: that is what the real sample is
const byLeague: Record<string, string[]> = {}
for (const t of Object.values(state.teams)) if (t.tier === 1) (byLeague[t.league] ??= []).push(t.id)
const leagues = Object.values(byLeague).filter((l) => l.length >= 2)

const len: number[] = [], kills: number[] = [], wk: number[] = [], lk: number[] = [], g15: [number, boolean][] = []
let blue = 0, loserMore = 0, dragons = 0, barons = 0, towers = 0, beats = 0
const byGap: Record<number, [number, number]> = {}

for (let i = 0; i < N; i++) {
  const lg = leagues[rng.int(0, leagues.length - 1)]
  const a = lg[rng.int(0, lg.length - 1)]
  let b = a
  while (b === a) b = lg[rng.int(0, lg.length - 1)]
  const A = buildLineup(state, a, map, b)
  const B = buildLineup(state, b, map, a)
  const sim = new MapSim(map, A, B, rng)
  sim.runOut()
  const s = sim.result().score
  const aWon = s.scoreA > s.scoreB
  len.push(s.minutes!); kills.push(s.killsA! + s.killsB!)
  wk.push(aWon ? s.killsA! : s.killsB!); lk.push(aWon ? s.killsB! : s.killsA!)
  if ((aWon ? s.killsB! : s.killsA!) > (aWon ? s.killsA! : s.killsB!)) loserMore++
  if (aWon) blue++
  g15.push([s.goldAt15!, aWon])
  dragons += s.dragonsA! + s.dragonsB!; barons += s.baronsA! + s.baronsB!; towers += s.towersA! + s.towersB!
  beats += s.rounds?.length ?? 0
  const gap = state.teams[a].rating - state.teams[b].rating
  const k = Math.min(4, Math.floor(Math.abs(gap) / 3))
  byGap[k] ??= [0, 0]
  byGap[k][0] += (gap > 0) === aWon ? 1 : 0; byGap[k][1]++
}

const mean = (xs: number[]) => xs.reduce((s, v) => s + v, 0) / xs.length
const pct = (xs: number[], p: number) => xs.slice().sort((x, y) => x - y)[Math.floor(xs.length * p)]
const aheadWins = (lo: number, hi: number) => {
  const s = g15.filter(([g]) => Math.abs(g) >= lo && Math.abs(g) < hi)
  return s.length ? s.filter(([g, w]) => (g > 0) === w).length / s.length : NaN
}

const rows: [string, number, number, number, string][] = [
  // name, simulated, low, high, real
  ['局长均值（分钟）', mean(len), 30.5, 34.5, '32.6'],
  ['局长 P10', pct(len, 0.1), 24, 28.5, '26.5'],
  ['局长 P90', pct(len, 0.9), 37, 43, '39.9'],
  ['每局总击杀', mean(kills), 24.5, 31, '27.9'],
  ['胜方击杀', mean(wk), 16.5, 21, '18.9'],
  ['败方击杀', mean(lk), 7, 11, '9.0'],
  ['败方击杀更多的局', loserMore / N, 0, 0.08, '0.032'],
  ['蓝色方胜率', blue / N, 0.51, 0.56, '0.535'],
  ['15 分钟领先方胜率', aheadWins(1, 1e9), 0.66, 0.74, '0.701'],
  ['  领先 <1k', aheadWins(1, 1000), 0.50, 0.60, '0.543'],
  ['  领先 1–2.5k', aheadWins(1000, 2500), 0.67, 0.79, '0.733'],
  ['  领先 2.5–5k', aheadWins(2500, 5000), 0.79, 0.92, '0.855'],
  ['15 分钟经济差绝对值', mean(g15.map(([g]) => Math.abs(g))), 1400, 2250, '1810'],
  ['每局小龙', dragons / N, 3.6, 5.4, '4.5'],
  ['每局大龙', barons / N, 0.95, 1.7, '1.31'],
  ['每局防御塔', towers / N, 10, 13.5, '11.7'],
]

let bad = 0
console.log(`${N} 局，同联赛内随机对阵（每局约 ${(beats / N).toFixed(1)} 个节点）\n`)
console.log('指标'.padEnd(18) + '模拟'.padStart(9) + '   允许范围'.padEnd(18) + '真实')
for (const [name, v, lo, hi, real] of rows) {
  const ok = v >= lo && v <= hi
  if (!ok) bad++
  console.log(`${ok ? '✅' : '❌'} ${name.padEnd(16)} ${v.toFixed(v < 10 ? 3 : 1).padStart(9)}   ${`${lo} – ${hi}`.padEnd(14)} ${real}`)
}
console.log('\n两队总评之差 → 强的一方的单局胜率（参考，真实数据按赛段胜率差分档是 0.60 / 0.74 / 0.84 / 0.95）：')
for (const k of Object.keys(byGap).map(Number).sort()) {
  const [w, n] = byGap[k]
  console.log(`   差 ${k * 3}–${k * 3 + 3} 分: ${(w / n).toFixed(3)}（${n} 局）`)
}
console.log(bad ? `\n❌ ${bad} 项不在范围内` : '\n✅ 比赛形状与真实数据一致')
process.exit(bad ? 1 : 0)
