/**
 * The extra real players, and the world they keep alive.
 *
 * These used to arrive as a youth intake, ten to fifteen a season from 2027.
 * They do not any more: they are simply the rest of the professional scene,
 * in the pool from day one like anybody else without a club. What still has to
 * hold is why they were scraped in the first place — a world of 518 that only
 * ages runs out of people, and a ten-year career has nobody left to sign.
 *
 *     npx tsx scripts/check_prospects.ts
 */
import { createNewGame } from '../src/engine/world'
import { squadOf } from '../src/engine/roster'
import { WORLD_TEAMS } from '../src/engine/teams'
import { setupSeason, advanceDay, continuePastFive } from '../src/engine/season'
import { ageIn, makeProspect, PROSPECTS } from '../src/engine/prospects'
import type { GameState } from '../src/engine/types'

let bad = 0
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? '  — ' + detail : ''}`)
  if (!ok) bad++
}
const mk = (tag = 'BLG'): GameState => {
  const g = createNewGame(WORLD_TEAMS.find((t) => t.tag === tag)!.id, '审计', 20260828)
  setupSeason(g)
  return g
}

// ---- they are in the world from the start, as ordinary free agents
{
  const g = mk()
  const all = Object.values(g.players)
  const added = all.filter((p) => p.id.startsWith('Y'))
  check('抓到的选手全部进入了世界', added.length === PROSPECTS.length,
    `${added.length}/${PROSPECTS.length}`)
  check('他们开局都没有球队，就是普通自由人', added.every((p) => p.teamId === null))
  check('没有人和已有选手重名顶替',
    new Set(all.map((p) => p.id)).size === all.length)

  // real birthdates, so real ages — nobody is aged to be convenient
  const ages = added.map((p) => p.age)
  check('年龄来自真实生日，没有被凑数',
    added.every((p) => p.age === ageIn(PROSPECTS.find((r) => r.id === p.id)!, 2026)),
    `${Math.min(...ages)}~${Math.max(...ages)} 岁`)
  // A birthday that could not be found is not made up: he is in the pool at an
  // estimated age and the UI says so (「年龄为估算」). What must never happen is
  // an estimate passing for a record, or a record being ignored.
  const dated = added.filter((p) => !!p.birth).length
  check('有生日的用生日，查不到的标「年龄为估算」，没有第三种', added.every((p) => !!p.birth !== !!p.ageEstimated), `有生日 ${dated} / ${added.length}`)
  check('查得到生日的占多数', dated >= added.length * 0.7, `${dated} / ${added.length}`)
}

// ---- unproven, and the ceiling closes with age
{
  // over the whole pool, not the first row: one man's draw can be the floor
  // (+2) at nineteen already, and then there is nothing left for ten years to close
  const head = (p: { potential: number; overall: number }) => p.potential - p.overall
  const mean = (year: number) => PROSPECTS.reduce((s, r) => s + head(makeProspect(r, year)), 0) / PROSPECTS.length
  const never = PROSPECTS.every((r) => head(makeProspect(r, 2036)) <= head(makeProspect(r, 2026)))
  check('同一批人十年后被发掘，成长空间更小', never && mean(2036) < mean(2026) - 4,
    `2026 年平均 +${mean(2026).toFixed(1)}，2036 年平均 +${mean(2036).toFixed(1)}`)

  const teens = PROSPECTS.filter((r) => ageIn(r, 2026) <= 20).map((r) => makeProspect(r, 2026))
  check('真正的年轻人仍有很宽的上限',
    teens.length > 0 && teens.some((p) => p.potential - p.overall >= 10),
    `${teens.length} 人，最高 +${Math.max(0, ...teens.map((p) => p.potential - p.overall))}`)

  const all = PROSPECTS.map((r) => makeProspect(r, 2026))
  check('没有一个人一进来就是现成的首发',
    all.every((p) => p.overall <= 80),
    `最高 ${Math.max(...all.map((p) => p.overall))}`)
}

// ---- the whole point: a ten-year world still has people in it
{
  const g = mk()
  let guard = 0
  while (!g.gameOver && g.year < 2036 && guard++ < 4200) {
    g.boardConfidence = 80
    g.onNotice = false
    if (g.midReview) continuePastFive(g)
    advanceDay(g)
  }
  const end = Object.values(g.players)
  const thin = Object.values(g.teams).filter((t) => t.roster.length < 5).length
  check('十年之后世界上还有自由人可签', end.filter((p) => !p.teamId).length > 0,
    `${g.year} 年，${end.filter((p) => !p.teamId).length} 名自由人`)
  check('十年之后几乎没有球队凑不出五个人', thin <= 2, `${thin} 支不足 5 人`)
  // Not an assertion about our own squad: this run never signs anybody, and
  // ensureMinimumRosters deliberately skips the managed club because keeping
  // five men is the manager's job. It reaches 2036 with an empty roster and
  // does not throw, which is the thing worth knowing.
  console.log(`     （无人管理的自家阵容最终 ${squadOf(g, g.myTeam).length} 人，`
    + '这是设计使然：补人是经理的工作，引擎不代劳）')
  check('世界仍能供给：还有能打的球队', 
    Object.values(g.teams).filter((t) => t.roster.length >= 5).length >= 70,
    `${Object.values(g.teams).filter((t) => t.roster.length >= 5).length}/78 支满员`)
}

console.log(bad ? `\n${bad} failed` : '\nall held')
process.exit(bad ? 1 : 0)
