/**
 * Nobody is two people, and nobody on a bench is on the market.
 *
 *   npx tsx scripts/check_identity.ts
 *
 * VAL MANAGER, 2026-09-25: a player who took a coaching job was still being
 * offered as a free agent (its `nowCoach`). Here the same thing happened to
 * Smiley — the Swedish bot laner was in the free-agent pool while Leaguepedia
 * has him coaching at Vivo Keyd Stars. scripts/lol/build_world.py and
 * build_prospects.py now leave out anybody whose record says coach or analyst.
 *
 * What this holds: every name that appears both on a coaching staff and among
 * the players is a homonym somebody has checked — listed below with who each
 * of them is. A new collision fails until it is checked and either fixed in
 * the pipeline or added here.
 */
import { readFileSync } from 'node:fs'

const world = JSON.parse(readFileSync(new URL('../src/data/world.json', import.meta.url), 'utf8'))
const prospects = JSON.parse(readFileSync(new URL('../src/data/prospects.json', import.meta.url), 'utf8')).players
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '')

/** staff name @ club tag → why the player of the same name is somebody else (Leaguepedia, 2026-10-01) */
const HOMONYMS: Record<string, string> = {
  'cube@DSC': '教练 Cube 是韩国的 Kim Chang-seong；选手 Cube 是 WE 的戴逸',
  'doran@NERD': '教练 Doran 是巴西的 Eduardo Correa；选手 Doran 是 T1 的崔贤畯',
  'artemis@WU': '教练 Artemis 是美国的 Connor Doyle；选手 Artemis 是 GAM 的 Trần Quốc Hưng',
  'spawn@TL': '教练 Spawn 是澳大利亚的 Jake Tiberi；选手 Spawn 是加拿大的 Trevor Kerr-Taylor',
  'hype@GAM': 'GAM 的 Hype 是越南的 Trần Hữu Toàn（分析师）；新秀 Hype 是韩国的边正贤',
}

const staff: [string, string][] = []
for (const t of world.teams) {
  if (!t.coach) continue
  for (const n of [t.coach.name, ...(t.coach.assistants ?? [])]) staff.push([n, t.tag])
}
for (const a of world.meta.analysts ?? []) {
  const club = world.teams.find((t: { name: string }) => t.name === a.from)
  staff.push([a.name, club?.tag ?? a.from])
}
const people = new Set([...world.players.map((p: { ign: string }) => norm(p.ign)), ...prospects.map((r: { ign: string }) => norm(r.ign))])

let bad = 0
let known = 0
for (const [name, tag] of staff) {
  if (!people.has(norm(name))) continue
  const key = `${norm(name)}@${tag}`
  if (HOMONYMS[key]) { known++; continue }
  bad++
  console.log(`FAIL ${name}（${tag} 教练组）和一名选手同名，没核实过是不是同一个人`)
}
for (const k of Object.keys(HOMONYMS)) {
  const [n, tag] = k.split('@')
  if (!staff.some(([name, t]) => norm(name) === n && t === tag)) console.log(`     （${k} 已不在教练组里，这条可以删）`)
}
const smiley = world.players.find((p: { ign: string }) => norm(p.ign) === 'smiley')
if (smiley) { bad++; console.log('FAIL Smiley 在 Vivo Keyd Stars 当教练，不该在选手池里') }
console.log(bad ? `\n❌ ${bad} 处` : `\n✅ 教练组和选手池没有同一个人（${known} 处同名已核实是不同的人）`)
process.exit(bad ? 1 : 0)
