/**
 * The right face on the right person in a career started in the past (careerAssets.ts).
 *
 *   npx tsx scripts/check_career_assets.ts
 *
 * Photos and crests are filed under the 2026 world's ids, and a past world
 * reuses those ids for other people. Held here:
 *   - a 2016 player gets a photo only if the 2026 man filed under it is the same
 *     person (same ign|position, no conflicting real name)
 *   - P1 of 2016 (not Flandre) never shows Flandre's photo
 *   - a 2016 club shows a crest only if it is the same organisation (Oracle's
 *     Elixir name), and the 2026 career is untouched
 *   - the 2026 captain list is not laid over a past world
 */
import { createNewGame, syncCallersWithWorld, WORLD_PLAYERS } from '../src/engine/world'
import { WORLD_TEAMS } from '../src/engine/teams'
import { loadWorld } from '../src/engine/eras'
import { ensureHistory } from '../src/engine/realHistory'
import { bindCareerAssets } from '../src/engine/careerAssets'
import { DOSSIER, crestUrl, dossierOf } from '../src/engine/dossier'
import { exportSave, importSave, repairPastNames } from '../src/engine/save'

let bad = 0
const check = (ok: boolean, what: string, detail = '') => {
  if (!ok) bad++
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${detail ? ` — ${detail}` : ''}`)
}

async function main() {
  await ensureHistory()
  const w26 = new Map((WORLD_PLAYERS as unknown as { id: string; hkey?: string; ign: string }[]).map((p) => [p.id, p]))
  const t26 = new Map((WORLD_TEAMS as unknown as { id: string; oeName?: string; name: string }[]).map((t) => [t.id, t]))

  const g26 = createNewGame(WORLD_TEAMS.find((t) => t.region === 'LPL' && t.tier === 1)!.id, '审计', 1)
  bindCareerAssets(g26)
  const flandre = dossierOf('P1')
  check(!!flandre?.img && flandre === DOSSIER.players.P1, '2026 档按原 id 取照片', `${w26.get('P1')?.ign} → ${flandre?.img}`)

  for (const year of [2016, 2022]) {
    const world = (await loadWorld(year))!
    const g = createNewGame(world.teams.find((t) => t.tier === 1 && t.region === 'LCK')!.id, '审计', 2, undefined, { world, year })
    bindCareerAssets(g)
    let faces = 0, wrong = 0
    for (const p of Object.values(g.players)) {
      const d = dossierOf(p.id)
      if (!d?.img) continue
      faces++
      const owner = Object.entries(DOSSIER.players).find(([, e]) => e === d)?.[0]
      if (!owner || w26.get(owner)?.hkey !== p.hkey) wrong++
    }
    check(wrong === 0, `${year}：每张照片都是本人的`, `${faces} 人有照片，${wrong} 张对错了人`)
    check(faces >= 10, `${year}：还在 2026 年世界里的人有照片`, `${faces}`)
    const p1 = g.players.P1
    const p1face = dossierOf('P1')
    check(p1face !== DOSSIER.players.P1 || w26.get('P1')?.hkey === p1.hkey, `${year}：P1（${p1.ign}）不会顶着 2026 年 P1（${w26.get('P1')?.ign}）的照片`)
    let crests = 0, wrongCrest = 0
    for (const t of Object.values(g.teams)) {
      const url = crestUrl(t.id)
      if (!url) continue
      crests++
      const id26 = /logos\/(T\d+)\.webp/.exec(url)?.[1]
      if (!id26 || t26.get(id26)?.oeName !== t.oeName) wrongCrest++
    }
    check(wrongCrest === 0 && crests > 10, `${year}：队标只给同一家俱乐部`, `${crests} 队有队标，${wrongCrest} 个错`)
    check(syncCallersWithWorld(g).length === 0, `${year}：不把 2026 年的队长名单套到过去的世界上`)
    const names = Object.values(g.teams).map((t) => `${t.id}:${t.name}:${t.tag}`).join('|')
    const back = importSave(exportSave(g))
    const after = Object.values(back.teams).map((t) => `${t.id}:${t.name}:${t.tag}`).join('|')
    check(after === names, `${year}：存档读回来，俱乐部还是原来的名字`, back.teams[g.myTeam]?.name)
    // a save that was loaded before the fix: 2026 names over the past world's ids
    for (const t of Object.values(back.teams)) { const w = t26.get(t.id); if (w) t.name = w.name }
    const fixed = repairPastNames(back, world)
    check(Object.values(back.teams).map((t) => `${t.id}:${t.name}:${t.tag}`).join('|') === names, `${year}：被 2026 年队名盖掉的旧存档能修回来`, `${fixed} 队`)
  }
  bindCareerAssets(g26)
  console.log(bad ? `\n❌ ${bad} 项不通过` : '\n✅ 历史档里每张脸、每个队标都是本人的')
  process.exit(bad ? 1 : 0)
}
void main()
