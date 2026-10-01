/**
 * The optional import rule: two players from outside the region, per club.
 *
 * Chosen at career start (or toggled in 系统), and binding on everyone — the
 * AI shops under the same rule the player does. It gates acquisitions only:
 * a squad already over the line keeps its players and simply cannot add more.
 * Origin is nationality; a player with none recorded counts as native, because
 * a rule should punish squad-building, never missing data.
 */
import { createNewGame } from '../src/engine/world'
import { squadOf } from '../src/engine/roster'
import { WORLD_TEAMS } from '../src/engine/teams'
import { advanceDay, setupSeason } from '../src/engine/season'
import { doTransfer, resolveMyOffer } from '../src/engine/transfer'
import { IMPORT_MAX, STARTER_IMPORT_MAX, fiveBlock, importBlock, importCount, importsIn, isImport } from '../src/engine/imports'
import { autoStarters } from '../src/engine/world'
import { selectLineup } from '../src/engine/match'
import { Rng } from '../src/engine/rng'
import type { GameState, Player } from '../src/engine/types'

let bad = 0
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? '  — ' + detail : ''}`)
  if (!ok) bad++
}
const mk = (tag: string, limit: boolean, seed = 20260825): GameState => {
  const g = createNewGame(WORLD_TEAMS.find((t) => t.tag === tag)!.id, '审计', seed)
  g.importLimit = limit
  setupSeason(g)
  return g
}
const bid = (g: GameState, p: Player) => {
  g.finances.balance = 90_000_000
  const o = {
    id: `T${p.id}`, playerId: p.id, fromTeam: p.teamId, toTeam: g.myTeam,
    fee: 5_000_000, salary: p.salary, years: 2, day: g.day, respondOn: g.day,
    status: 'pending' as const,
    terms: { salary: p.salary * 4, years: 2, signingBonus: 0, bonusShare: 0,
      releaseClause: 0, promisedRole: 'star' },
  }
  g.offers.push(o as never)
  return resolveMyOffer(g, o as never, new Rng(3))
}

// ---- with the rule OFF, a fourth import signs like anyone else
{
  const g = mk('EDG', false)
  const me = g.teams[g.myTeam]
  const foreigners = Object.values(g.players)
    .filter((p) => !p.teamId && isImport(p, me)).slice(0, 3)
  check('enough foreign free agents to test with', foreigners.length === 3)
  for (const p of foreigners) {
    p.teamId = g.myTeam
    me.roster.push(p.id)
  }
  check('rule off: three imports live on one roster untouched',
    importCount(g, g.myTeam) >= 3, `${importCount(g, g.myTeam)} 名外援`)
  const fourth = Object.values(g.players).find((p) => p.teamId && p.teamId !== g.myTeam && isImport(p, me))!
  check('rule off: a fourth import is nobody\'s business',
    importBlock(g, g.myTeam, fourth) === null)
}

// ---- with the rule ON, the third import is refused by name
{
  const g = mk('EDG', true)
  const me = g.teams[g.myTeam]
  // relative to what the real roster already holds — EDG signed stew, a
  // Korean, in September 2026, and the world is rebuilt from real rosters
  const base = importCount(g, g.myTeam)
  const foreigners = Object.values(g.players)
    .filter((p) => !p.teamId && isImport(p, me)).slice(0, IMPORT_MAX - base)
  for (const p of foreigners) { p.teamId = g.myTeam; me.roster.push(p.id) }
  check('two imports fit', importCount(g, g.myTeam) === IMPORT_MAX, `${base} 已有 + ${foreigners.length}`)

  const third = Object.values(g.players).find((p) => p.teamId && p.teamId !== g.myTeam && isImport(p, me))!
  const msg = bid(g, third)
  check('the third is refused, and the message says why',
    third.teamId !== g.myTeam && msg.includes('外援名额已满'), `"${msg}"`)

  const native = Object.values(g.players).find((p) =>
    p.teamId && p.teamId !== g.myTeam && !isImport(p, me) && squadOf(g, p.teamId!).length > 5)!
  check('a native signs straight past the quota', importBlock(g, g.myTeam, native) === null)

  // jakee's case: no nationality on record, but his card says 美洲 — the rule
  // must agree with the screen, so his region stands in for his origin.
  //
  // Built by hand rather than found in the world. It used to search for a real
  // player with `nat` missing, and the dossier scrape filled in all 518
  // nationalities — so the sample vanished and the fallback it guards went
  // untested. The fallback still has to work: an imported save, or a future
  // player the scrape misses, can still arrive without one.
  const anyForeign = Object.values(g.players).find((p) => p.region !== me.region)!
  const jakeeLike = { ...anyForeign, nat: undefined }
  check('no nationality but a foreign region card counts as an import',
    isImport(jakeeLike, me), `${jakeeLike.ign}（${jakeeLike.region}，国籍留空）`)
  const anyHome = Object.values(g.players).find((p) => p.region === me.region)!
  const homegrown = { ...anyHome, nat: undefined }
  check('no nationality and a home region card counts as native',
    !isImport(homegrown, me), `${homegrown.ign}（${homegrown.region}，国籍留空）`)
}

// ---- grandfathering: turning the rule on never breaks an existing squad
{
  const g = mk('EDG', false)
  const me = g.teams[g.myTeam]
  const base = importCount(g, g.myTeam)
  const foreigners = Object.values(g.players)
    .filter((p) => !p.teamId && isImport(p, me)).slice(0, Math.max(0, 3 - base))
  for (const p of foreigners) { p.teamId = g.myTeam; me.roster.push(p.id) }
  g.importLimit = true
  check('three imports survive the rule turning on beneath them',
    importCount(g, g.myTeam) === 3 && me.roster.length === squadOf(g, g.myTeam).length,
    `${importCount(g, g.myTeam)} 名外援`)
  const another = Object.values(g.players).find((p) => p.teamId && p.teamId !== g.myTeam && isImport(p, me))!
  check('but a fourth cannot join', importBlock(g, g.myTeam, another) !== null)
}

// ---- the AI plays TWO seasons inside the rule, across three worlds
for (const seed of [7, 71, 717]) {
  const g = mk('TES', true, seed)
  const before = new Map(Object.values(g.teams).map((t) => [t.id, importCount(g, t.id)]))
  const rng = new Rng(seed + 1)
  let guard = 0
  while (!g.gameOver && guard++ < 800 && g.year <= 2027) advanceDay(g, rng)
  const over = Object.values(g.teams)
    .filter((t) => importCount(g, t.id) > Math.max(IMPORT_MAX, before.get(t.id) ?? 0))
    .map((t) => `${t.tag}:${importCount(g, t.id)}(初始${before.get(t.id)})`)
  check(`seed ${seed}: two seasons, no AI club buys over the line`,
    over.length === 0, over.slice(0, 5).join(' '))
  // the manager's own club is nobody's to run in this script: its contracts simply lapse
  const short = Object.values(g.teams).filter((t) => t.id !== g.myTeam && squadOf(g, t.id).length < 5)
  check(`seed ${seed}: and no AI club is short of five`, short.length === 0,
    short.map((t) => t.tag).join(' '))
}

// ---- doTransfer itself is the wall, whatever path reaches it
{
  const g = mk('EDG', true)
  const me = g.teams[g.myTeam]
  const foreigners = Object.values(g.players)
    .filter((p) => !p.teamId && isImport(p, me)).slice(0, 2)
  for (const p of foreigners) { p.teamId = g.myTeam; me.roster.push(p.id) }
  const third = Object.values(g.players).find((p) => !p.teamId && isImport(p, me))!
  const moved = doTransfer(g, third, g.myTeam, 0,
    { salary: 50000, years: 1, signingBonus: 0, bonusShare: 0, releaseClause: 0, promisedRole: 'starter' } as never)
  check('doTransfer refuses the over-quota signing outright', moved === false && !third.teamId)
}

// ---- the real rule, always on: at most two non-residents in the starting five
{
  const g = mk('BLG', false)
  const me = g.teams[g.myTeam]
  // three strong imports, one per position, over the residents who play there
  const natives = squadOf(g, g.myTeam).filter((p) => !isImport(p, me))
  const roles = natives.slice(0, 3).map((p) => p.role)
  const added: Player[] = []
  for (const role of roles) {
    const p = Object.values(g.players).find((x) => !x.teamId && x.role === role && isImport(x, me) && !added.includes(x))
    if (!p) continue
    p.teamId = g.myTeam; p.overall = 95; p.injuredUntil = 0; me.roster.push(p.id); added.push(p)
  }
  check('three imports on the roster, all better than the residents', added.length === 3, added.map((p) => `${p.ign}/${p.role}`).join(' '))
  const auto = autoStarters(g, g.myTeam).map((id) => g.players[id])
  check(`自动首发最多 ${STARTER_IMPORT_MAX} 名外援`, importsIn(me, auto) <= STARTER_IMPORT_MAX, auto.map((p) => `${p.ign}${isImport(p, me) ? '*' : ''}`).join(' '))
  const benched = added.find((p) => !auto.includes(p))
  const cover = benched && auto.find((p) => p.role === benched.role)
  check('被换下的外援由同位置的本赛区选手顶上', !!cover && !isImport(cover, me), `${benched?.ign} → ${cover?.ign}`)
  // the manager insists on all three: the screen says no, and the referee fields a legal five anyway
  const illegal = [...added.map((p) => p.id), ...natives.filter((p) => !roles.includes(p.role)).map((p) => p.id)].slice(0, 5)
  check('排首发时第三名外援被拦下，理由写明', !!fiveBlock(me, illegal.map((id) => g.players[id])), fiveBlock(me, illegal.map((id) => g.players[id])) ?? '')
  me.starters = illegal
  const fielded = selectLineup(g, g.myTeam)
  check('比赛时照样只上两名外援', importsIn(me, fielded) <= STARTER_IMPORT_MAX && fielded.length === 5, fielded.map((p) => `${p.ign}${isImport(p, me) ? '*' : ''}`).join(' '))
  check('两名外援的首发是合法的', fiveBlock(me, [...added.slice(0, 2), ...natives.slice(2, 5)]) === null)
}

// ---- and across a season every club fields a legal five whenever it can
{
  const g = mk('TES', false, 99)
  const rng = new Rng(100)
  let looked = 0
  const bad5: string[] = []
  for (let d = 0; d < 200; d++) {
    advanceDay(g, rng)
    if (d % 10) continue
    for (const t of Object.values(g.teams)) {
      const five = selectLineup(g, t.id)
      looked++
      const spare = squadOf(g, t.id).filter((p) => !five.includes(p) && !isImport(p, t)).length
      if (importsIn(t, five) > STARTER_IMPORT_MAX && spare) bad5.push(`${t.tag}@${g.day}`)
    }
  }
  check('一个赛季里每次排出的五人都合法（有本赛区替补时）', bad5.length === 0, `${looked} 次排阵，${bad5.length} 次违规 ${bad5.slice(0, 4).join(' ')}`)
}

console.log(bad ? `\n❌ ${bad} 项不通过` : '\n✅ 外援规则：首发最多两名非本赛区居民')
process.exit(bad ? 1 : 0)
