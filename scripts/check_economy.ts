/**
 * The economy has two failure modes, and both were reported in one message:
 * a manager who pitched every fortnight compounded to forty deals and money
 * that stopped mattering, while one who never found the button starved on two
 * starting contracts. Five sponsor slots, pitches priced off the club rather
 * than off existing deals, sponsors who knock on their own, streaming that
 * fluctuates and spikes when the team wins, and prize money that moves a
 * balance sheet.
 */
import { createNewGame } from '../src/engine/world'
import { squadOf } from '../src/engine/roster'
import { WORLD_TEAMS } from '../src/engine/teams'
import { setupSeason } from '../src/engine/season'
import {
  dropSponsor, pitchSponsor, resolveSponsorTalks, signSponsor, SPONSOR_MAX, streamWeek,
} from '../src/engine/commercial'
import { prizeTable } from '../src/engine/prizes'
import { Rng } from '../src/engine/rng'
import type { GameState } from '../src/engine/types'

let bad = 0
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? '  — ' + detail : ''}`)
  if (!ok) bad++
}
const mk = (): GameState => {
  const g = createNewGame(WORLD_TEAMS.find((t) => t.tag === 'DKC')!.id, '审计', 20260828)
  setupSeason(g)
  return g
}

// ---- five slots, and the pitch says so
{
  const g = mk()
  const me = g.teams[g.myTeam]
  while (me.sponsors.length < SPONSOR_MAX) {
    me.sponsors.push({ name: `T${me.sponsors.length}`, perSeason: 100000, bonusPlacement: 4, bonus: 20000 })
  }
  check('a full book refuses a sixth pitch', pitchSponsor(g).includes('栏位已满'))
  // addressed by row index, not by name: two contracts with the same partner
  // used to make "end this one" ambiguous and it always ended the first
  check('walking away frees the slot',
    dropSponsor(g, me.sponsors.length - 1).includes('解约') && me.sponsors.length === SPONSOR_MAX - 1)
  check('and the pitch resumes', !pitchSponsor(g).includes('栏位已满'))
}

// ---- pitches are priced off the club, not off the deals it already holds
{
  const poor = mk()
  poor.teams[poor.myTeam].sponsors = []
  pitchSponsor(poor)
  const rich = mk()
  rich.teams[rich.myTeam].sponsors = Array.from({ length: 4 }, (_, i) =>
    ({ name: `巨头${i}`, perSeason: 5_000_000, bonusPlacement: 4, bonus: 500000 }))
  pitchSponsor(rich)
  const a = poor.sponsorTalks![0].base
  const b = rich.sponsorTalks![0].base
  check('an empty book and a stacked one are quoted alike', b < a * 2 && a < b * 2,
    `空手 $${a} vs 满手 $${b}`)
}

// ---- sponsors knock on their own for a club light on deals
{
  const g = mk()
  g.teams[g.myTeam].sponsors = g.teams[g.myTeam].sponsors.slice(0, 1)
  const rng = new Rng(21)
  let knocked = false
  for (let d = 0; d < 250 && !knocked; d++) {
    g.day += 1
    resolveSponsorTalks(g, rng)
    knocked = (g.sponsorTalks ?? []).some((t) => t.id.startsWith('SPIN') && t.answer === 'offer')
  }
  check('within a season, someone comes to the door', knocked)
}

// ---- streaming fluctuates, and wins fill the gift feed
{
  const g = mk()
  const p = squadOf(g, g.myTeam)[0]
  p.stream = { platform: '虎牙', fee: 480000, nights: 2, months: 12, until: g.day + 300 }
  const rng = new Rng(31)
  const weeks: number[] = []
  for (let w = 0; w < 12; w++) {
    const before = g.finances.balance
    streamWeek(g, rng, [])
    weeks.push(g.finances.balance - before)
  }
  check('stream income moves week to week', new Set(weeks).size > 1,
    `${Math.min(...weeks)}~${Math.max(...weeks)}`)
  const noGift = g.finances.log.some((l) => l.label.includes('直播礼物'))
  check('no wins, no gifts', !noGift)
  g.fixtures.push({
    id: 'W1', day: g.day - 2, stage: g.stage, comp: '次级联赛 China', teamA: g.myTeam,
    teamB: Object.keys(g.teams).find((id) => id !== g.myTeam)!, bo: 3, label: '测试',
    played: true, result: { mapsWonA: 2, mapsWonB: 0 } as never,
  } as never)
  streamWeek(g, rng, [])
  check('a win brings gifts', g.finances.log.some((l) => l.label.includes('直播礼物') && l.amount > 0))
}

// ---- trophies move a balance sheet
// ---- what the real events paid (prizes.ts, 决定 D77)
{
  const at = (year: number, stage: string, region?: string) => prizeTable({ year }, { stage, region } as never)
  check('Worlds 2026 pays its champion 40% of $5M', at(2026, 'champions')[0] === 2_000_000, `${at(2026, 'champions')[0]}`)
  check('Worlds 2016 pays $2.03M, MSI 2016 its real $250k', at(2016, 'champions')[0] === 2_028_000 && at(2016, 'masters2')[0] === 250_000,
    `${at(2016, 'champions')[0]} / ${at(2016, 'masters2')[0]}`)
  check('an LPL Split 3 title is CNY 1.7M of its 4.0M', Math.abs(at(2026, 'stage2', 'LPL')[0] - 1_700_000 / 7.1) < 2, `${at(2026, 'stage2', 'LPL')[0]}`)
  check('an LCP split is a small pool: $80k in all', Math.abs(at(2026, 'stage1', 'LCP').reduce((a, b) => a + b, 0) - 80_000) < 5)
  for (const year of [2016, 2022, 2026]) {
    const regional = Math.max(...(['LPL', 'LCK', 'LEC', 'LCS', 'LCP', 'CBLOL'] as const).map((r) => at(year, 'stage2', r)[0] ?? 0))
    // Worlds is always the biggest; MSI is not always above a league title (MSI 2022's whole pool was $250k)
    check(`${year}: Worlds pays more than MSI and any league title`,
      at(year, 'champions')[0] > at(year, 'masters2')[0] && at(year, 'champions')[0] > regional,
      `${at(year, 'champions')[0]} > ${at(year, 'masters2')[0]}, ${regional}`)
  }
  check('a qualifier pays nothing', prizeTable({ year: 2026 }, { stage: 'stage2', region: 'LPL', minor: true } as never).length === 0)
}

console.log(bad ? `\n${bad} failed` : '\nall held')
process.exit(bad ? 1 : 0)
