/**
 * A reload mid-season must not hand out fixture ids that are already on the calendar.
 *
 *   npx tsx scripts/check_reload_ids.ts
 *
 * Fixture ids come from a counter in module memory. A page reload used to start
 * it at F0 again while F0…Fn were still booked, so a scrim booked after the
 * reload shared an id — and the random stream, and the list key — with a league
 * match. (VAL MANAGER, 2026-09-24.) Also: a cover signing arrives on fresh terms
 * and is in the five the same day.
 */
import { createNewGame } from '../src/engine/world'
import { WORLD_TEAMS } from '../src/engine/teams'
import { advanceDay, ensureMinimumRosters, setupSeason, HEADLESS } from '../src/engine/season'
import { exportSave, importSave } from '../src/engine/save'
import { Rng } from '../src/engine/rng'
import { makeFixture, resetFixtureSeq } from '../src/engine/league'

HEADLESS.noDismissal = true
let bad = 0
const check = (ok: boolean, msg: string) => { if (!ok) bad++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${msg}`) }

const g0 = createNewGame(WORLD_TEAMS.find((t) => t.tag === 'BLG')!.id, '审计', 77)
setupSeason(g0)
for (let i = 0; i < 40; i++) advanceDay(g0, { autoResolveDrawDecisions: true })
const packed = exportSave(g0)
resetFixtureSeq(0)                 // a fresh page: the counter in module memory starts over
const g = importSave(packed)
const before = new Set(g.fixtures.map((f) => f.id))
const a = g.teams[g.myTeam], b = Object.values(g.teams).find((t) => t.id !== g.myTeam && t.league === a.league)!
const fresh = makeFixture(a.id, b.id, g.day + 3, 'league', '测试', 1)
check(!before.has(fresh.id), `读档后新建的比赛编号 ${fresh.id} 不和日程上的 ${before.size} 场撞号`)
const ids = g.fixtures.map((f) => f.id)
check(new Set(ids).size === ids.length, '存档里的比赛编号没有重复')

// a cover signing: wipe an AI club's roster down to four and let the winter refill it
const t = Object.values(g.teams).find((x) => x.id !== g.myTeam && x.tier === 1)!
const gone = g.players[t.roster[0]]
gone.teamId = null; t.roster = t.roster.slice(1); t.starters = t.starters.filter((id) => id !== gone.id)
const free = Object.values(g.players).find((p) => !p.teamId && p.id !== gone.id)!
free.contract = { ...free.contract!, releaseClause: 123_456 } as typeof free.contract
free.expiredYear = 2020
ensureMinimumRosters(g, new Rng(5))
const signed = g.players[t.roster[t.roster.length - 1]]
check(t.roster.length === 5, `${t.tag} 补回了五人`)
check(signed.expiredYear === undefined && signed.contract?.releaseClause !== 123_456, `补进来的 ${signed.ign} 不带上一家的解约金和到期标记`)
check(t.starters.length === 5, `${t.tag} 当天就有五个首发`)

console.log(bad ? `\n❌ ${bad} 项不通过` : '\n✅ 读档后的编号与补位签约都对')
process.exit(bad ? 1 : 0)
