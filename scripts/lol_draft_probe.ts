import { createNewGame } from '../src/engine/world'
import { MatchSim } from '../src/engine/match'
import { compStyle, COMP_STYLE_CN } from '../src/engine/comp'
import { agentCn } from '../src/engine/content'
import { Rng } from '../src/engine/rng'
const state = createNewGame('T1', 'probe', 5)
const tag = (id: string) => state.teams[id].tag
const find = (t: string) => Object.values(state.teams).find((x) => x.tag === t)!.id
const sim = new MatchSim(state, find('BLG'), find('GEN'), 5, new Rng(11))
const r = sim.runOut()
console.log(`BLG ${r.mapsWonA}:${r.mapsWonB} GEN`)
r.maps.forEach((m, i) => {
  const ign = (id: string) => state.players[id].ign
  const side = (ids: string[]) => ids.map((id) => `${agentCn(m.agents![id])}`).join(' ')
  console.log(`第${i + 1}局 蓝=${m.blue === 'A' ? 'BLG' : 'GEN'} ${m.scoreA > m.scoreB ? 'BLG胜' : 'GEN胜'} ${m.killsA}-${m.killsB} ${m.minutes}分钟`)
  console.log(`   BLG [${COMP_STYLE_CN[compStyle(r.lineups!.a.map((id) => m.agents![id]))].label}] ${side(r.lineups!.a)}   禁: ${m.bans!.a.map(agentCn).join(' ')}`)
  console.log(`   GEN [${COMP_STYLE_CN[compStyle(r.lineups!.b.map((id) => m.agents![id]))].label}] ${side(r.lineups!.b)}   禁: ${m.bans!.b.map(agentCn).join(' ')}`)
  void ign
})
const all = r.maps.flatMap((m) => Object.values(m.agents!))
console.log('五局 50 个选人里不重复的英雄数：', new Set(all).size, '（无畏征召下应为', all.length, '）')
// distribution of styles across a round of league games
const count: Record<string, number> = {}
const rng = new Rng(3)
const t1 = Object.values(state.teams).filter((t) => t.tier === 1)
for (let i = 0; i < 300; i++) {
  const a = t1[rng.int(0, t1.length - 1)], b = t1[rng.int(0, t1.length - 1)]
  if (a.id === b.id) continue
  const s = new MatchSim(state, a.id, b.id, 1, rng); const res = s.runOut()
  for (const ids of [res.lineups!.a, res.lineups!.b]) { const k = COMP_STYLE_CN[compStyle(ids.map((id) => res.maps[0].agents![id]))].label; count[k] = (count[k] ?? 0) + 1 }
}
console.log('300 场 BO1 里双方阵容的打法分布：', count)
void tag
