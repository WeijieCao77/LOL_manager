/**
 * The real 2026 year, played through (engine/formats.ts, programs2026.ts).
 *
 *   npx tsx scripts/check_formats.ts [seed]
 *
 * One season headless on the lol-2026 rulebook, then held against
 * docs/调研-2026赛制.md: every tier-one region finishes three stages in their
 * real windows; the phases happen in their order with the right number of
 * teams and best-ofs; First Stand has 8, MSI 11, Worlds 19 with the slot
 * chain (MSI runner-up's region +1, the champion's summer bracket); LPL drops
 * two after Split 2 and LCK carries its Rounds 1-2 records; nobody plays two
 * games on one day; the year ends and the next one opens seeded from it.
 */
import { createNewGame } from '../src/engine/world'
import { WORLD_TEAMS } from '../src/engine/teams'
import { advanceDay, continuePastFive, setupSeason, HEADLESS } from '../src/engine/season'
import { setCurrentRuleset } from '../src/engine/ruleset'
import { T1_REGIONS, worldsSlots } from '../src/engine/programs2026'
import type { Fixture, GameState } from '../src/engine/types'
import { qualification, upcomingInternational } from '../src/engine/qualify'

HEADLESS.noDismissal = true
setCurrentRuleset('lol-2026')
const SEED = Number(process.argv[2] ?? 20261001)
const g: GameState = createNewGame(WORLD_TEAMS.find((t) => t.tag === 'BLG')!.id, '审计', SEED)
setupSeason(g)

let bad = 0
const check = (ok: boolean, what: string, detail = '') => {
  if (!ok) bad++
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${detail ? ` — ${detail}` : ''}`)
}
const tag = (id: string) => g.teams[id]?.tag ?? id
const date = (d: number) => { const x = new Date(Date.UTC(2026, 0, 1 + d)); return `${x.getUTCMonth() + 1}/${x.getUTCDate()}` }

check(g.rulesetId === 'lol-2026', '新档用 2026 真实赛制', g.rulesetId)

// play the year, keeping a copy of every fixture as it is played (old ones get pruned)
const seen = new Map<string, Fixture>()
let guard = 0
const year = g.year
let snap: GameState | null = null
const seenQual: { day: number; headline: string; upcoming: string | null; fst: string[] }[] = []
while (g.year === year && guard++ < 420) {
  if (g.midReview) continuePastFive(g)
  advanceDay(g, { autoResolveDrawDecisions: true })
  for (const f of g.fixtures) if (f.played && !seen.has(f.id)) seen.set(f.id, { ...f })
  if (g.comps.champions?.champion && !snap) snap = JSON.parse(JSON.stringify(g))
  if (g.comps['kickoff:LPL']?.champion && !seenQual.length) {
    const q = qualification(g), up = upcomingInternational(g)
    seenQual.push({ day: g.day, headline: q?.headline ?? '', upcoming: up ? `${up.name} ${up.how} @${up.day}` : g.comps.masters1 ? '（已建）' : null, fst: g.comps['kickoff:LPL'].finished.slice(0, 2) })
  }
}
check(g.year === year + 1, '一年走完，进入下一年', `${g.year}`)
const S = snap ?? g
const fx = [...seen.values()]

for (const r of T1_REGIONS) {
  const line: string[] = []
  for (const slot of ['kickoff', 'stage1', 'stage2'] as const) {
    const c = S.comps[`${slot}:${r}`]
    if (!c) { check(false, `${r} ${slot} 存在`); continue }
    const games = fx.filter((f) => f.comp === c.key)
    const days = games.map((f) => f.day)
    const phases = c.prog ? Object.keys(c.prog.res) : []
    line.push(`${slot}: ${date(Math.min(...days))}–${date(Math.max(...days))} ${games.length} 场 [${phases.join('→')}] 冠军 ${tag(c.champion ?? '?')}`)
    check(!!c.champion, `${r} ${c.name} 打完了`, c.champion ? '' : `停在第 ${c.prog?.phase} 阶段`)
  }
  console.log(`     ${r}\n       ${line.join('\n       ')}`)
}

// LPL: Split 3 is twelve
{
  const s2 = S.comps['stage1:LPL'], s3 = S.comps['stage2:LPL']
  const out = s2?.finished.slice(12) ?? []
  const s3games = fx.filter((f) => f.comp === 'stage2:LPL')
  check(out.length === 2 && out.every((id) => !s3games.some((f) => f.teamA === id || f.teamB === id)),
    'LPL 第二赛段 Nirvana 末两名不打第三赛段', out.map(tag).join(' '))
  check((s3?.prog?.groups.rr ?? []).reduce((n, gr) => n + gr.teams.length, 0) === 12, 'LPL 第三赛段 12 队')
  const asc = s2?.prog?.groups.rr?.[0]
  check(asc?.name === 'Ascend' && asc.teams.length === 8, 'LPL 第二赛段按第一赛段名次分组：前八 Ascend')
}
// LCK: records carried
{
  const s3 = S.comps['stage2:LCK']
  const gamesR34 = fx.filter((f) => f.comp === 'stage2:LCK' && f.ph === 'r34')
  const anyone = s3?.prog?.groups.r34?.[0].teams[0]
  const row = anyone ? s3!.standings[anyone] : undefined
  const r34 = anyone ? gamesR34.filter((f) => f.teamA === anyone || f.teamB === anyone).length : 0
  check(!!row && row.w + row.l > r34, 'LCK 第三赛段带入了前两轮的战绩', row ? `${row.w}-${row.l}，其中 Rounds 3-4 ${r34} 场` : '')
  const gb = fx.filter((f) => f.comp === 'kickoff:LCK' && f.ph === 'gb')
  const sameGroup = gb.filter((f) => S.comps['kickoff:LCK']!.groups!.some((gr) => gr.includes(f.teamA) && gr.includes(f.teamB)))
  check(gb.length === 25 && !sameGroup.length, 'LCK Cup 组间对抗：25 场，只打对面组', `${gb.length} 场，组内 ${sameGroup.length}`)
  check(gb.filter((f) => f.bo === 5).length === 5, 'LCK Cup 超级周 5 场 BO5')
}
// LEC Versus is best of one
check(fx.filter((f) => f.comp === 'kickoff:LEC' && f.ph === 'rr').every((f) => f.bo === 1), 'LEC Versus 常规赛 BO1')
check(fx.filter((f) => f.comp === 'kickoff:LCS' && f.ph === 'sw').length === 12, 'LCS Lock-In 瑞士轮 3 轮 12 场')

// internationals
{
  const fst = S.comps.masters1, msi = S.comps.masters2, w = S.comps.champions
  check(fst?.teams.length === 8, 'First Stand 8 队', String(fst?.teams.length))
  check(msi?.teams.length === 11, 'MSI 11 队', String(msi?.teams.length))
  const slots = worldsSlots(S)
  const total = Object.values(slots).reduce((a, b) => a + b, 0)
  check(w?.teams.length === total && total === 19, `全球总决赛 ${total} 队`, `${w?.teams.length}；${T1_REGIONS.map((r) => `${r} ${slots[r]}`).join(' ')}`)
  for (const c of [fst, msi, w]) {
    if (!c) continue
    const games = fx.filter((f) => f.comp === c.key)
    console.log(`     ${c.name}（${c.city}）${date(Math.min(...games.map((f) => f.day)))}–${date(Math.max(...games.map((f) => f.day)))} ${games.length} 场 冠军 ${tag(c.champion ?? '?')}，名次 ${c.finished.slice(0, 4).map(tag).join(' ')}`)
  }
  const wsw = fx.filter((f) => f.comp === 'champions' && f.ph === 'sw')
  check(wsw.length > 0 && wsw.every((f) => f.bo === 1 || f.bo === 3), '全球总决赛瑞士轮只有 BO1 和 BO3', `${wsw.length} 场`)
  const qual = S.comps['qual:LPL']
  check(!!qual?.champion, 'LPL 区域资格赛打完了', qual ? `${qual.teams.map(tag).join(' ')} → ${qual.finished.map(tag).join(' ')}` : '没有')
  check(!g.honours.some((h) => h.title === 'LPL 区域资格赛'), '区域资格赛不算冠军头衔')
}

// the screens agree with the field: our own club, once Split 1 is over and First Stand is not yet built
{
  const q = seenQual[0]
  const going = !!q && q.fst.includes(g.myTeam)
  check(!!q && (going ? q.headline.includes('已锁定 First Stand') && !!q.upcoming : q.headline.includes('无缘 First Stand') && !q.upcoming),
    '晋级形势和「下一个国际赛」与 First Stand 名单一致', q ? `${q.headline} · ${q.upcoming ?? '无'}` : '没取到')
}

// nobody plays twice a day
{
  const byDay = new Map<string, number>()
  for (const f of fx) for (const id of [f.teamA, f.teamB]) {
    const k = `${f.day}:${id}`
    byDay.set(k, (byDay.get(k) ?? 0) + 1)
  }
  const twice = [...byDay.entries()].filter(([, n]) => n > 1)
  check(!twice.length, '没有队伍一天打两场', twice.slice(0, 4).map(([k]) => k).join(' '))
}

// the next year
check(!!g.prevRank?.LPL?.length && g.prevRank.LPL[0] === S.comps['stage2:LPL']?.champion, '新赛季按上一年排名开局（LPL 第一是第三赛段冠军）',
  g.prevRank?.LPL?.slice(0, 3).map(tag).join(' '))
check(Object.values(g.comps).filter((c) => c.format === 'program').length === 18, '新赛季重新建好 18 个赛段')

console.log(bad ? `\n❌ ${bad} 项不通过` : '\n✅ 2026 真实赛制走通了一整年')
process.exit(bad ? 1 : 0)
