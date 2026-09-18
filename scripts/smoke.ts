/**
 * Headless sanity run: play a full season and assert the world stays coherent.
 *   npx tsx scripts/smoke.ts [seasons]
 */
import { createNewGame } from '../src/engine/world'
import { squadOf } from '../src/engine/roster'
import { WORLD_TEAMS } from '../src/engine/teams'
import { advanceDay, setupSeason, SEASON_DAYS, stageName } from '../src/engine/season'
import { statLine } from '../src/engine/player'
import { ratingOf } from '../src/engine/match'
import { setCurrentRuleset } from '../src/engine/ruleset'
import type { GameState } from '../src/engine/types'

// RULESET=vct-2026 plays the season under the draw rulebook; the default is
// the classic flow the rest of the audit was written against
const rulesetEnv = process.env.RULESET
if (rulesetEnv === 'vct-2025' || rulesetEnv === 'vct-2026') setCurrentRuleset(rulesetEnv)

const seasons = Number(process.argv[2] ?? 1)
// The strongest club in the biggest league: a headless run makes no decisions at all, and a
// mid-table board sacks a manager who misses three stage targets running — which a do-nothing
// manager does. That is the game working, but it is not what this script is here to test.
const me = WORLD_TEAMS.find((t) => t.tag === 'BLG')!
const state: GameState = createNewGame(me.id, '测试经理', 12345)
setupSeason(state)
// Which league a stat line was earned in is the tier the club held when the
// season began, not the one it holds after 次级联赛总决赛. REJECT farmed a second
// division all year and then won promotion; reading their tier at the end
// filed those totals under VCT and blamed VCT's calibration for them.
const startTier = new Map(Object.values(state.teams).map((t) => [t.id, t.tier]))

console.log(`managing ${state.teams[state.myTeam].name} (${state.teams[state.myTeam].league})`)
console.log(`fixtures generated: ${state.fixtures.length}`)

const problems: string[] = []
const t0 = Date.now()
let matches = 0
const titles: string[] = []
for (let s = 0; s < seasons; s++) {
  const yearStart = state.year
  while (state.year === yearStart) {
    const before = state.fixtures.filter((f) => f.played).length
    // a draw that waits for the manager would stop the season; headless, the coaches draw
    const r = advanceDay(state, { autoResolveDrawDecisions: true })
    matches += state.fixtures.filter((f) => f.played).length - before
    if (r.stageChanged) {
      console.log(`  day ${String(state.day).padStart(3)} → ${stageName(state.stage)}`)
    }
    // snapshot international results before the season rolls over and clears them
    for (const key of ['masters1', 'masters2', 'champions']) {
      const c = state.comps[key]
      if (c?.champion && !titles.some((t) => t.startsWith(`${yearStart} ${c.name}`))) {
        titles.push(`${yearStart} ${c.name}: ${state.teams[c.champion]?.name}`)
      }
    }
    if (state.day > SEASON_DAYS + 5) throw new Error('season did not roll over')
    // a dismissed manager's clock stops (advanceDay returns at once); waiting for the year to
    // turn would spin here for ever, which is how this script once ran for ten minutes
    if (state.gameOver) { problems.push(`the manager was dismissed on day ${state.day}: ${state.gameOver}`); break }
  }
}
const elapsed = Date.now() - t0

console.log('\ninternational titles:')
if (!titles.length) console.log('  ⚠️  none — international events never concluded')
for (const t of titles) console.log('  ' + t)

console.log(`\nsimulated ${seasons} season(s), ${matches} matches in ${elapsed}ms`)

// ---- invariants
for (const t of Object.values(state.teams)) {
  const squad = squadOf(state, t.id)
  // the human club is exempt: nobody re-signed its expiring contracts in a headless run
  if (t.id !== state.myTeam) {
    if (squad.length < 5) problems.push(`${t.name} has only ${squad.length} players`)
    if (t.starters.length !== 5) problems.push(`${t.name} has ${t.starters.length} starters`)
  } else if (squad.length < 5) {
    console.log(`\n(managed club ${t.name} is down to ${squad.length} players — expected, the UI warns the manager)`)
  }
  for (const id of t.roster) {
    if (!state.players[id]) problems.push(`${t.name} references missing player ${id}`)
    else if (state.players[id].teamId !== t.id) problems.push(`${id} teamId mismatch`)
  }
}
const tierCount: Record<string, number> = {}
for (const t of Object.values(state.teams)) {
  const k = `${t.region}/T${t.tier}`
  tierCount[k] = (tierCount[k] ?? 0) + 1
}
// League sizes are whatever the real leagues are (LPL 14, LCK 10, the smaller
// regions 8) — what must hold is that a season neither loses a club nor
// invents one: every league ends the year the size the world file started it.
const worldCount: Record<string, number> = {}
for (const t of WORLD_TEAMS) {
  const k = `${t.region}/T${t.tier}`
  worldCount[k] = (worldCount[k] ?? 0) + 1
}
for (const k of new Set([...Object.keys(tierCount), ...Object.keys(worldCount)])) {
  if (k.endsWith('T1') && tierCount[k] !== worldCount[k]) {
    problems.push(`${k} has ${tierCount[k] ?? 0} teams (the world file has ${worldCount[k] ?? 0})`)
  }
}

console.log('\nleague sizes:', tierCount)

// ---- did the competitions actually conclude?
const comps = Object.values(state.comps)
console.log(`competitions this season: ${comps.length}`)

// ---- statistical realism check on last season's totals
const played = Object.values(state.players).filter((p) => p.career.maps > 10)
played.sort((a, b) => statLine(b.career).acs - statLine(a.career).acs)
console.log('\ntop 8 by career ACS:')
for (const p of played.slice(0, 8)) {
  const s = statLine(p.career)
  console.log(
    `  ${p.ign.padEnd(12)} ${state.teams[p.teamId ?? '']?.name ?? 'FA'}`.padEnd(34) +
    `OVR ${p.overall}  ACS ${s.acs.toFixed(0)}  K/D ${s.kd.toFixed(2)}  ADR ${s.adr.toFixed(0)}  ` +
    `RAT ${ratingOf(p.career).toFixed(2)}  maps ${p.career.maps}`,
  )
}

const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / (xs.length || 1)
const lines = played.map((p) => statLine(p.career))
const acsAll = lines.map((l) => l.acs)
const kdAll = lines.map((l) => l.kd)
const pct = (xs: number[], q: number) => xs.slice().sort((a, b) => a - b)[Math.floor(xs.length * q)]

console.log(
  `\nleague-wide  ACS ${avg(acsAll).toFixed(0)} avg / ${pct(acsAll, 0.95).toFixed(0)} p95 / ${Math.max(...acsAll).toFixed(0)} max` +
  `\n             K/D ${avg(kdAll).toFixed(2)} avg / ${pct(kdAll, 0.95).toFixed(2)} p95 / ${Math.max(...kdAll).toFixed(2)} max` +
  `\n             ADR ${avg(lines.map((l) => l.adr)).toFixed(0)}   KPR ${avg(lines.map((l) => l.kpr)).toFixed(2)}` +
  `   RAT ${avg(played.map((p) => ratingOf(p.career))).toFixed(2)}`,
)

// Real reference (LPL/LCK/LEC/LCS 2024–2026): 27.9 kills a game over 32.6 minutes, so a
// player takes about 0.087 kills a minute; K/D averages 1.0 by construction. The shape of a
// single game is held much more tightly by scripts/check_match_shape.ts — this only catches
// a season whose scoreboards have gone somewhere absurd.
if (avg(kdAll) < 0.85 || avg(kdAll) > 1.2) problems.push(`K/D average ${avg(kdAll).toFixed(2)} outside 0.85-1.20`)
const kpm = avg(lines.map((l) => l.kpr))
if (kpm < 0.06 || kpm > 0.115) problems.push(`kills per minute ${kpm.toFixed(3)} outside 0.060-0.115`)
const rat = avg(played.map((p) => ratingOf(p.career)))
if (rat < 0.9 || rat > 1.1) problems.push(`average rating ${rat.toFixed(2)} outside 0.90-1.10`)
const qualified = played.filter((p) => p.career.maps >= 40).map((p) => statLine(p.career).kd)
const topKd = qualified.length ? Math.max(...qualified) : 0
// the best carries on the best sides finish a year around 5–6; past 9 is a broken allocation
if (topKd > 9) problems.push(`top K/D ${topKd.toFixed(2)} over a full season is not a real scoreboard`)
console.log(`qualified (40+ games): ${qualified.length} 人, top K/D ${topKd.toFixed(2)}, kills/min ${kpm.toFixed(3)}, rating ${rat.toFixed(2)}`)
void startTier

const ovr = Object.values(state.players).map((p) => p.overall).sort((a, b) => a - b)
console.log(`overall spread: ${ovr[0]} / ${ovr[Math.floor(ovr.length / 2)]} / ${ovr[ovr.length - 1]}`)
console.log(`players in world: ${Object.keys(state.players).length}`)
console.log(`board confidence: ${state.boardConfidence.toFixed(0)}   honours: ${state.honours.length}`)

if (problems.length) {
  console.log(`\n❌ ${problems.length} problem(s):`)
  for (const p of problems.slice(0, 25)) console.log('   -', p)
  process.exit(1)
}
console.log('\n✅ all invariants held')
