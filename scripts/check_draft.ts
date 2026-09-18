/**
 * The draft keeps its own rules.
 *
 *   npx tsx scripts/check_draft.ts
 *
 * Everything here is something a player would see at once if it broke: the
 * same champion on both sides, a banned champion picked anyway, a top laner
 * handed a support, a BO5 in 2026 where game four repeats game one's mid
 * laner, or a career started in 2016 drafting a champion released in 2022.
 */
import { createNewGame } from '../src/engine/world'
import { MatchSim, selectLineup } from '../src/engine/match'
import { DRAFT_ORDER, fearlessDraft, runDraft } from '../src/engine/draft'
import { agentRoles, championOf } from '../src/engine/content'
import { Rng } from '../src/engine/rng'

let bad = 0
const check = (ok: boolean, msg: string) => { if (!ok) bad++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${msg}`) }

const state = createNewGame('T1', 'draft', 7)
const t1 = Object.values(state.teams).filter((t) => t.tier === 1)
const rng = new Rng(7)

check(DRAFT_ORDER.filter((s) => s.act === 'ban').length === 10 && DRAFT_ORDER.filter((s) => s.act === 'pick').length === 10,
  '十禁十选')
check(DRAFT_ORDER.slice(0, 6).every((s) => s.act === 'ban') && DRAFT_ORDER[6].side === 'blue' && DRAFT_ORDER[19].side === 'red',
  '前六手是禁用，蓝色方第一个选，红色方最后一个选')

// ---- a few hundred single drafts
let dup = 0, bannedPicked = 0, offRole = 0, holes = 0, picksSeen = 0
const firstPicks: Record<string, number> = {}
for (let i = 0; i < 400; i++) {
  const a = t1[rng.int(0, t1.length - 1)], b = t1[rng.int(0, t1.length - 1)]
  if (a.id === b.id) continue
  const fa = selectLineup(state, a.id), fb = selectLineup(state, b.id)
  const d = runDraft(state, fa, fb, rng)
  const all = [...Object.values(d.blue), ...Object.values(d.red)]
  if (new Set(all).size !== all.length) dup++
  const banned = new Set([...d.bansBlue, ...d.bansRed])
  if (all.some((c) => banned.has(c))) bannedPicked++
  if (Object.keys(d.blue).length !== fa.length || Object.keys(d.red).length !== fb.length) holes++
  for (const [five, picks] of [[fa, d.blue], [fb, d.red]] as const) {
    for (const p of five) {
      picksSeen++
      if (!agentRoles(picks[p.id] ?? '').includes(p.role)) offRole++
    }
  }
  const first = d.log.find((l) => l.includes('选择'))?.replace(/（.*$/, '').replace(/^.*选择 /, '') ?? ''
  firstPicks[first] = (firstPicks[first] ?? 0) + 1
}
check(dup === 0, `同一个英雄不会两边都有（${dup} 次）`)
check(bannedPicked === 0, `被禁的英雄不会被选（${bannedPicked} 次）`)
check(holes === 0, `每个人都选到了英雄（${holes} 次没选满）`)
check(offRole / picksSeen < 0.01, `拿到的是自己位置的英雄：${picksSeen - offRole} / ${picksSeen}`)
const distinctFirst = Object.keys(firstPicks).length
check(distinctFirst >= 6, `一选不是千篇一律：400 次里出现过 ${distinctFirst} 个不同的一选`)

// ---- fearless across a series
{
  const a = t1.find((t) => t.tag === 'BLG')!, b = t1.find((t) => t.tag === 'GEN')!
  let repeats = 0, games = 0
  for (let i = 0; i < 40; i++) {
    const r = new MatchSim(state, a.id, b.id, 5, new Rng(100 + i)).runOut()
    const seen = new Set<string>()
    for (const m of r.maps) {
      games++
      for (const c of Object.values(m.agents ?? {})) { if (seen.has(c)) repeats++; seen.add(c) }
    }
  }
  check(fearlessDraft(state) && repeats === 0, `2026 年无畏征召：40 个 BO5（${games} 局）里没有一个英雄在同一个系列赛里被选两次（${repeats} 次）`)
}
{
  const old = createNewGame('T1', 'draft', 7)
  old.year = 2022
  check(!fearlessDraft(old), '2022 年没有无畏征召')
  const a = t1[0], b = t1[1]
  let repeats = 0
  for (let i = 0; i < 20; i++) {
    const r = new MatchSim(old, a.id, b.id, 5, new Rng(300 + i)).runOut()
    const seen = new Set<string>()
    for (const m of r.maps) for (const c of Object.values(m.agents ?? {})) { if (seen.has(c)) repeats++; seen.add(c) }
  }
  check(repeats > 0, `没有无畏征召时，系列赛里会重复选同一个英雄（20 个 BO5 里 ${repeats} 次）`)
}

// ---- a champion that does not exist yet cannot be drafted
{
  const past = createNewGame('T1', 'draft', 7)
  past.year = 2016; past.day = 30
  let tooNew = 0, n = 0
  for (let i = 0; i < 120; i++) {
    const a = t1[rng.int(0, t1.length - 1)], b = t1[rng.int(0, t1.length - 1)]
    if (a.id === b.id) continue
    const d = runDraft(past, selectLineup(past, a.id), selectLineup(past, b.id), rng)
    for (const c of [...Object.values(d.blue), ...Object.values(d.red), ...d.bansBlue, ...d.bansRed]) {
      n++
      if ((championOf(c)?.since ?? '0') > '2016-02-01') tooNew++
    }
  }
  check(tooNew === 0, `2016 年 1 月的 BP 里没有出现之后才上线的英雄（${n} 次选禁里 ${tooNew} 次）`)
}

console.log(bad ? `\n❌ ${bad} 项不通过` : '\n✅ BP 守住了自己的规则')
process.exit(bad ? 1 : 0)
