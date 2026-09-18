import { createNewGame } from '../src/engine/world'
import { sheetFor } from '../src/engine/match'
import { styleMix, styleCounter, stylePurity, styleName, compStyle, COMP_STYLE_CN } from '../src/engine/comp'
import { MAPS, agentCn, AGENTS } from '../src/engine/content'
import { Rng } from '../src/engine/rng'
import { ROLES } from '../src/engine/types'
const state = createNewGame('T1', 'probe', 5)
const sheets = Object.values(state.teams).filter((t) => t.tier === 1).map((t) => ({ t, picks: Object.values(sheetFor(state, t.id, MAPS[0]).agents) }))
const count: Record<string, number> = {}
for (const s of sheets) { const k = COMP_STYLE_CN[compStyle(s.picks)].label; count[k] = (count[k] ?? 0) + 1 }
console.log('一级队默认阵容的打法分布:', count)
for (const s of sheets.slice(0, 6)) console.log(' ', s.t.tag.padEnd(5), s.picks.map(agentCn).join(' / '), '→', styleName(styleMix(s.picks)), styleMix(s.picks).map((v) => v.toFixed(2)).join(' '), 'purity', stylePurity(styleMix(s.picks)).toFixed(2))
// random legal fives from each role's pool, weighted to the contested picks
const rng = new Rng(9)
const five = () => ROLES.map((r) => { const pool = AGENTS[r].slice(0, 28); return pool[rng.int(0, pool.length - 1)] })
const mixes = Array.from({ length: 4000 }, () => styleMix(five()))
const cs: number[] = []
for (let i = 0; i + 1 < mixes.length; i += 2) cs.push(Math.abs(styleCounter(mixes[i], mixes[i + 1])))
cs.sort((a, b) => a - b)
const pur = mixes.map(stylePurity).sort((a, b) => a - b)
console.log('随机合法阵容：|克制| 中位', cs[cs.length >> 1].toFixed(3), 'P95', cs[Math.floor(cs.length * .95)].toFixed(3), '；纯度 中位', pur[pur.length >> 1].toFixed(3), 'P95', pur[Math.floor(pur.length * .95)].toFixed(3))
const lean = mixes.map((m) => Math.max(...m) - Math.min(...m)).sort((a, b) => a - b)
console.log('最强角 − 最弱角：P25', lean[lean.length >> 2].toFixed(3), '中位', lean[lean.length >> 1].toFixed(3), 'P75', lean[Math.floor(lean.length * .75)].toFixed(3))
