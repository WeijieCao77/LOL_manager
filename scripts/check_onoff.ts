/**
 * What does it cost a club to lose a starter?
 *
 *   npx tsx scripts/check_onoff.ts [games per case]
 *
 * The target is measured (analysis/lol/onoff.py): in 355 real cases where one
 * position's starter was out and the other four were unchanged, the club's win
 * rate fell by 5.8 points on average (middle 80%: −16 … +27). And the player
 * whose value is almost all 运营 is the one the club misses most: T1 won 69%
 * with Faker in 2023 and 22% of the 18 games without him.
 *
 * So two things are held here. An ordinary starter replaced by an ordinary
 * substitute costs a few points, not twenty. And taking out the man who
 * carries the five's 运营 costs clearly more than taking out a team-mate of
 * the same overall rating — otherwise a veteran whose hands have gone is
 * worth nothing in this game, which is the opposite of what the data says.
 */
import { createNewGame } from '../src/engine/world'
import { buildLineup, MapSim } from '../src/engine/match'
import { recomputeOverall } from '../src/engine/player'
import { MAPS } from '../src/engine/content'
import { Rng } from '../src/engine/rng'
import { ATTR_KEYS } from '../src/engine/types'
import type { GameState, Player } from '../src/engine/types'

// 1500 games put a standard error of 1.7 points on the difference this asks about (> 2): it failed one run in three
const N = Number(process.argv[2] ?? 6000)
const map = MAPS[0]
const fresh = (): GameState => createNewGame('T1', 'onoff', 99)

/** win rate of `teamId` against the rest of its league, each game on a fresh seed */
function winRate(state: GameState, teamId: string, seed: number): number {
  const rng = new Rng(seed)
  const foes = Object.values(state.teams).filter((t) => t.league === state.teams[teamId].league && t.id !== teamId)
  let won = 0
  for (let i = 0; i < N; i++) {
    const foe = foes[i % foes.length].id
    const mineIsA = i % 2 === 0                                   // blue side half the time
    const A = buildLineup(state, mineIsA ? teamId : foe, map, mineIsA ? foe : teamId)
    const B = buildLineup(state, mineIsA ? foe : teamId, map, mineIsA ? teamId : foe)
    const sim = new MapSim(map, A, B, rng)
    sim.runOut()
    if ((sim.winner === 'A') === mineIsA) won++
  }
  return won / N
}

/** the same club with one starter swapped for a substitute `drop` points worse across the board */
function without(state: GameState, teamId: string, playerId: string, drop: number, subMacro: number): void {
  const team = state.teams[teamId]
  const out = state.players[playerId]
  const sub: Player = JSON.parse(JSON.stringify(out))
  sub.id = `${playerId}_sub`; sub.ign = `${out.ign} 的替补`; sub.isIgl = false
  for (const k of ATTR_KEYS) sub.attrs[k] = Math.max(30, out.attrs[k] - drop)
  sub.attrs.macro = subMacro
  recomputeOverall(sub)
  state.players[sub.id] = sub
  team.roster = team.roster.map((id) => (id === playerId ? sub.id : id))
  team.starters = team.starters.map((id) => (id === playerId ? sub.id : id))
  if (team.igl === playerId) delete team.igl
  out.teamId = null
}

let bad = 0
const check = (ok: boolean, msg: string) => { if (!ok) bad++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${msg}`) }
const tagId = (s: GameState, tag: string) => Object.values(s.teams).find((t) => t.tag === tag && t.tier === 1)!.id

// ---- 1. an ordinary starter out, across a spread of clubs
const drops: number[] = []
for (const tag of ['BLG', 'TES', 'WE', 'T1', 'KT', 'G2', 'FLY', 'UP']) {
  const base = fresh()
  const id = tagId(base, tag)
  const full = winRate(base, id, 7)
  // the median starter by 运营, so this is not the club's brain
  const five = base.teams[id].starters.map((p) => base.players[p]).sort((a, b) => a.attrs.macro - b.attrs.macro)
  const victim = five[2]
  const s = fresh()
  without(s, id, victim.id, 6, 58)
  const short = winRate(s, id, 7)
  drops.push(full - short)
  console.log(`     ${tag.padEnd(4)} 完整 ${(full * 100).toFixed(1)}%  缺 ${victim.ign}（换上差 6 分的替补）${(short * 100).toFixed(1)}%  掉 ${((full - short) * 100).toFixed(1)}`)
}
const avgDrop = drops.reduce((a, b) => a + b, 0) / drops.length
check(avgDrop > 0.03 && avgDrop < 0.12, `普通主力缺阵平均掉 ${(avgDrop * 100).toFixed(1)} 个百分点（真实 5.8，允许 3–12）`)

// ---- 2. the man who carries the 运营, against a team-mate of similar rating
{
  const base = fresh()
  const id = tagId(base, 'T1')
  const five = base.teams[id].starters.map((p) => base.players[p])
  const brain = five.slice().sort((a, b) => b.attrs.macro - a.attrs.macro)[0]
  const peer = five.filter((p) => p.id !== brain.id).sort((a, b) => Math.abs(a.overall - brain.overall) - Math.abs(b.overall - brain.overall))[0]
  const full = winRate(base, id, 11)
  const a = fresh(); without(a, id, brain.id, 6, 58)
  const b = fresh(); without(b, id, peer.id, 6, peer.attrs.macro - 6)
  const noBrain = winRate(a, id, 11), noPeer = winRate(b, id, 11)
  console.log(`     T1 完整 ${(full * 100).toFixed(1)}%；缺 ${brain.ign}（总评 ${brain.overall}，运营 ${brain.attrs.macro}）${(noBrain * 100).toFixed(1)}%；缺 ${peer.ign}（总评 ${peer.overall}，运营 ${peer.attrs.macro}）${(noPeer * 100).toFixed(1)}%`)
  check(full - noBrain > (full - noPeer) + 0.02, `缺运营核心比缺一名总评相近的队友多掉 ${(((full - noBrain) - (full - noPeer)) * 100).toFixed(1)} 个百分点（要求 > 2）`)
  check(full - noBrain < 0.3, `缺运营核心掉 ${((full - noBrain) * 100).toFixed(1)} 个百分点，没有离谱（< 30）`)
}

console.log(bad ? `\n❌ ${bad} 项不通过` : '\n✅ 主力缺阵的代价与真实数据同一量级')
process.exit(bad ? 1 : 0)
