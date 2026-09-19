/**
 * Do players age the way real ones do — and does the world hold its level?
 *
 *   npx tsx scripts/check_aging.ts [seasons]
 *
 * The shape comes from 405 professionals' year-on-year change
 * (docs/调研-选手数值与年龄曲线.md §2): 对线 turns down at twenty-two, 操作 and
 * 发育 at twenty-four, 意识 barely moves before the late twenties, and 运营
 * does not go with the hands. This runs an untouched world for several seasons
 * and reads the same thing off the simulated players: each winter's change in
 * each ability, filed by age.
 *
 * It also holds the league's level. The per-attribute curve fades faster than
 * the single curve it replaced; if training and the young do not make that
 * back, every league sinks a point a year and nobody notices until 2032.
 */
import { createNewGame } from '../src/engine/world'
import { advanceDay, continuePastFive, setupSeason, HEADLESS } from '../src/engine/season'
import { WORLD_TEAMS } from '../src/engine/teams'
import { ATTR_CN, ATTR_KEYS } from '../src/engine/types'
import type { Attrs } from '../src/engine/types'

const SEASONS = Number(process.argv[2] ?? 6)
HEADLESS.noDismissal = true        // this is about the world, not about the manager
const me = WORLD_TEAMS.find((t) => t.tag === 'BLG')!
const state = createNewGame(me.id, 'aging', 424242)
setupSeason(state)                 // createNewGame alone books no fixtures: the first year would pass without a match

let bad = 0
const check = (ok: boolean, msg: string) => { if (!ok) bad++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${msg}`) }

const band = (age: number) => (age <= 20 ? '≤20' : age <= 23 ? '21–23' : age <= 26 ? '24–26' : age <= 29 ? '27–29' : '30+')
const BANDS = ['≤20', '21–23', '24–26', '27–29', '30+']
const delta: Record<string, Record<keyof Attrs, number[]>> = {}
for (const b of BANDS) delta[b] = Object.fromEntries(ATTR_KEYS.map((k) => [k, [] as number[]])) as Record<keyof Attrs, number[]>
const level: number[] = []
const pool: string[] = []
const shortTeams: number[] = []
const starterAge: number[] = []

const tier1Starters = () => Object.values(state.teams).filter((t) => t.tier === 1)
  .flatMap((t) => t.starters.map((id) => state.players[id]).filter(Boolean))

for (let s = 0; s < SEASONS; s++) {
  const st = tier1Starters()
  level.push(st.reduce((a, p) => a + p.overall, 0) / st.length)
  starterAge.push(st.reduce((a, p) => a + p.age, 0) / st.length)
  {
    const all = Object.values(state.players)
    const short = Object.values(state.teams).filter((t) => t.roster.length < 5).length
    const free = all.filter((p) => !p.teamId)
    pool.push(`${state.year}: 在世 ${all.length}，有队 ${all.length - free.length}，自由人 ${free.length}（其中 ≤22 岁 ${free.filter((p) => p.age <= 22).length}），不足五人的队 ${short}，一级首发里 ≤21 岁 ${st.filter((p) => p.age <= 21).length}`)
    shortTeams.push(short)
  }
  const before = new Map(Object.values(state.players).filter((p) => p.teamId).map((p) => [p.id, { age: p.age, attrs: { ...p.attrs } }]))
  const y = state.year
  let guard = 0
  while (state.year === y && !state.gameOver && guard++ < 420) {
    // the mid-term review stops the clock until the manager answers; nobody is here to answer
    if (state.midReview) continuePastFive(state)
    advanceDay(state, { autoResolveDrawDecisions: true })
  }
  if (state.year === y && !state.gameOver) { console.log(`FAIL 第 ${s + 1} 季走了 420 天还没过年——世界停了`); process.exit(1) }
  if (state.gameOver) { console.log(`（第 ${s + 1} 季被解雇，停在这里：${state.gameOver}）`); break }
  for (const [id, b] of before) {
    const p = state.players[id]
    if (!p) continue
    for (const k of ATTR_KEYS) delta[band(b.age + 1)][k].push(p.attrs[k] - b.attrs[k])
  }
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0)
console.log(`\n每个赛季的变化（训练 + 冬天的年龄结算），按年龄段：`)
console.log('年龄     人次  ' + ATTR_KEYS.map((k) => ATTR_CN[k].padStart(5)).join(' '))
for (const b of BANDS) {
  console.log(`${b.padEnd(7)} ${String(delta[b].laning.length).padStart(5)}  ` + ATTR_KEYS.map((k) => mean(delta[b][k]).toFixed(2).padStart(6)).join(' '))
}
const m = (b: string, k: keyof Attrs) => mean(delta[b][k])

check(m('≤20', 'laning') > 0 && m('≤20', 'mechanics') > 0, '20 岁以下：对线和操作都在涨')
check(m('24–26', 'laning') < 0 && m('27–29', 'laning') < m('21–23', 'laning'), '对线 24 岁之后在掉，而且越老掉得越快')
check(m('21–23', 'mechanics') > m('21–23', 'laning'), '21–23 岁：操作还撑得住的时候，对线已经先开始走下坡（研究：对线 22 岁、操作 24 岁）')
check(m('27–29', 'mechanics') < -0.3, `27–29 岁操作每年掉 ${(-m('27–29', 'mechanics')).toFixed(2)}（要求 > 0.3）`)
check(m('27–29', 'awareness') > m('27–29', 'mechanics') + 0.5, '27–29 岁：意识掉得比操作慢得多')
check(m('27–29', 'macro') >= 0, `27–29 岁：运营不掉（${m('27–29', 'macro').toFixed(2)}）`)
check(m('30+', 'macro') > m('30+', 'laning') + 1, '30 岁以上：对线在垮，运营还在——老将就是这个样子')

const drift = level[level.length - 1] - level[0]
console.log(`\n一级联赛首发的平均总评：${level.map((v) => v.toFixed(1)).join(' → ')}`)
console.log(`一级联赛首发的平均年龄：${starterAge.map((v) => v.toFixed(1)).join(' → ')}`)
for (const line of pool) console.log(line)
check(Math.abs(drift) < 2.5, `${level.length - 1} 个赛季里联盟水平漂了 ${drift >= 0 ? '+' : ''}${drift.toFixed(1)}（允许 ±2.5）`)
// The pool is closed: every player is a real person and nobody is invented to
// replace the ones who leave, so the world cannot stay 23.7 years old the way
// the real one does — by 2035 the youngest man alive is 26. What CAN be held:
// clubs still field five all the way to the end, and the starting fives age
// slower than the calendar (the young do take places from the old).
const perYear = (starterAge[starterAge.length - 1] - starterAge[0]) / Math.max(1, starterAge.length - 1)
check(perYear < 0.95, `首发平均年龄每年 +${perYear.toFixed(2)} 岁（封闭的真人池子：日历是 +1.00，真实世界是 0）`)
check(starterAge.length < 4 || starterAge[3] < 26.5, `前三个赛季首发平均年龄 ${starterAge.slice(0, 4).map((v) => v.toFixed(1)).join(' → ')}（第四年开局要求 < 26.5）`)
// the managed club is nobody's job here, so one short club is ours
check(Math.max(...shortTeams) <= 1, `每个赛季开局，凑不齐五个人的俱乐部最多 ${Math.max(...shortTeams)} 支（自己那支没人管，算 1）`)

console.log(bad ? `\n❌ ${bad} 项不通过` : '\n✅ 年龄曲线和联盟水平都站得住')
process.exit(bad ? 1 : 0)
