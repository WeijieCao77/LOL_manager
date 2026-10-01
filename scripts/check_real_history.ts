/**
 * A historical career grows towards history, but is not forced into it (engine/realHistory.ts).
 *
 *   npx tsx scripts/check_real_history.ts [startYear=2016] [seasons=3]
 *
 * Plays a historical career headless and asks, each winter:
 *   - did the year's real newcomers arrive — at their real age, with a ceiling
 *     that is what they later became (Chovy, Knight, Canyon…)?
 *   - how much do the AI clubs' fives look like the real ones of that year?
 *     Too little and the world is not history; all of it and the manager has
 *     no room (策划稿: check_era_world — the band is set from what this prints).
 *   - did nobody vanish: every club still fields five.
 */
import { createNewGame } from '../src/engine/world'
import { advanceDay, continuePastFive, setupSeason, HEADLESS } from '../src/engine/season'
import { loadWorld } from '../src/engine/eras'
import { entrantsFor, ensureHistory } from '../src/engine/realHistory'
import history from '../src/data/history.json'
import type { GameState } from '../src/engine/types'

HEADLESS.noDismissal = true
const START = Number(process.argv[2] ?? 2016)
const SEASONS = Number(process.argv[3] ?? 3)
let bad = 0
const check = (ok: boolean, what: string, detail = '') => {
  if (!ok) bad++
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${detail ? ` — ${detail}` : ''}`)
}

const H = history as unknown as { rosters: Record<string, Record<string, string[]>> }

/** share of AI tier-one starters who were in that club's real roster that year */
function overlap(g: GameState): { share: number; n: number } {
  const real = H.rosters[String(g.year)] ?? {}
  let hit = 0, n = 0
  for (const t of Object.values(g.teams)) {
    if (t.id === g.myTeam || t.tier !== 1 || !t.oeName || !real[t.oeName]) continue
    const set = new Set(real[t.oeName])
    for (const id of t.starters) {
      const p = g.players[id]
      if (!p) continue
      n++
      if (p.hkey && set.has(p.hkey)) hit++
    }
  }
  return { share: n ? hit / n : 0, n }
}

async function main() {
  await ensureHistory()
  const world = await loadWorld(START)
  check(!!world, `${START} 年的世界能加载`)
  if (!world) process.exit(1)
  const me = world.teams.find((t) => t.tier === 1 && t.region === 'LCK')!
  const g = createNewGame(me.id, '审计', 20261003, undefined, { world, year: START })
  setupSeason(g)
  check(g.year === START && g.startYear === START, `开局在 ${START} 年`, `${g.year}`)
  const first = overlap(g)
  console.log(`     ${START} 开局：AI 一级首发与真实名单重合 ${(first.share * 100).toFixed(0)}%（${first.n} 人）`)

  for (let s = 0; s < SEASONS; s++) {
    const y = g.year
    let guard = 0
    while (g.year === y && guard++ < 420) {
      if (g.midReview) continuePastFive(g)
      advanceDay(g, { autoResolveDrawDecisions: true })
    }
    check(g.year === y + 1, `${y} 年走完`)
    const want = entrantsFor(g, g.year)
    const arrived = want.filter((k) => Object.values(g.players).some((p) => p.hkey === k))
    check(arrived.length === want.length && want.length > 0, `${g.year} 年的真实新人都进来了`, `${arrived.length}/${want.length}`)
    const ov = overlap(g)
    console.log(`     ${g.year} 开季：AI 一级首发与当年真实名单重合 ${(ov.share * 100).toFixed(0)}%（${ov.n} 人）`)
    check(ov.share > 0.3, `${g.year} 年的世界像历史（重合 > 30%）`, `${(ov.share * 100).toFixed(0)}%`)
    const short = Object.values(g.teams).filter((t) => t.id !== g.myTeam && t.roster.length < 5).length
    check(short === 0, `${g.year} 年每支 AI 俱乐部都凑得齐五人`, `${short} 支不足`)
    for (const k of ['Chovy|mid', 'Knight|mid', 'Canyon|jng', 'Viper|bot']) {
      const p = Object.values(g.players).find((x) => x.hkey === k)
      if (p) console.log(`       ${p.ign.padEnd(7)} ${p.age} 岁 能力 ${p.overall} 潜力 ${p.potential} · ${p.teamId ? g.teams[p.teamId]?.name : '自由人'}`)
    }
  }
  console.log(bad ? `\n❌ ${bad} 项不通过` : '\n✅ 历史档向历史生长，但没有被钉死')
  process.exit(bad ? 1 : 0)
}
void main()
