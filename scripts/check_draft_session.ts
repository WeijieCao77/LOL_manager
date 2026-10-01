/**
 * The draft step by step (engine/draft.ts DraftSession) and the series around it.
 *
 *   npx tsx scripts/check_draft_session.ts
 *
 * What has to hold:
 *   - left alone, a session is the draft runDraft always made: same picks, same
 *     bans, from the same generator state (the calibrated numbers rest on it)
 *   - the manager's own moves obey the draft: only on his side's step, only a
 *     champion still on the board, only for a man of his side who has not picked
 *   - in a series, a draft opened ahead of a game (to make by hand) is the one
 *     the game is built from, and 无畏征召 takes that game's picks off the board
 *   - steps he leaves to the assistant follow his pre-match sheet
 */
import { createNewGame } from '../src/engine/world'
import { WORLD_TEAMS } from '../src/engine/teams'
import { setupSeason } from '../src/engine/season'
import { DraftSession, DRAFT_ORDER, runDraft } from '../src/engine/draft'
import { MatchSim, selectLineup } from '../src/engine/match'
import { Rng } from '../src/engine/rng'

let bad = 0
const check = (ok: boolean, what: string, detail = '') => {
  if (!ok) bad++
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${detail ? ` — ${detail}` : ''}`)
}

const g = createNewGame(WORLD_TEAMS.find((t) => t.tag === 'BLG')!.id, '审计', 20261002)
setupSeason(g)
const foe = Object.values(g.teams).find((t) => t.tag === 'TES')!.id
const blue = selectLineup(g, g.myTeam)
const red = selectLineup(g, foe)

// ---- left alone, the same draft
{
  const a = runDraft(g, blue, red, new Rng(7))
  const s = new DraftSession(g, blue, red, new Rng(7))
  while (!s.done) s.autoStep()
  const b = s.result()
  check(JSON.stringify(a) === JSON.stringify(b), '没人插手时，逐手 BP 和一次跑完的结果逐字相同')
  check(s.step === DRAFT_ORDER.length && Object.keys(b.blue).length === 5 && Object.keys(b.red).length === 5, '二十手走完，两边各五人')
}

// ---- the manager's moves obey the draft
{
  const s = new DraftSession(g, blue, red, new Rng(9))
  check(s.current?.side === 'blue' && s.current.act === 'ban', '第一手是蓝色方禁用')
  check(!s.pick(blue[0].id, 'Ahri'), '禁用的那一手不能选人')
  check(s.ban('Ahri'), '能禁阿狸')
  check(!s.ban('Ahri'), '同一个英雄不能再禁一次')
  while (s.current && !(s.current.side === 'blue' && s.current.act === 'pick')) s.autoStep()
  check(!s.pick(blue[0].id, 'Ahri'), '被禁的英雄不能选')
  check(!s.pick(red[0].id, 'Orianna'), '蓝色方的这一手不能给红色方的人选')
  const champ = s.poolFor(blue[0])[0]
  check(s.pick(blue[0].id, champ), `蓝色方第一选 ${blue[0].ign} 拿 ${champ}`)
  while (s.current && !(s.current.side === 'blue' && s.current.act === 'pick')) s.autoStep()
  check(!s.pick(blue[0].id, s.poolFor(blue[1])[0]), '已经选过的人不能再选')
  while (!s.done) s.autoStep()
  const r = s.result()
  const all = [...Object.values(r.blue), ...Object.values(r.red)]
  check(new Set(all).size === 10 && !all.includes('Ahri'), '十个英雄互不相同，被禁的没有出现')
  check(r.blue[blue[0].id] === champ, '手选的那一个进了阵容')
}

// ---- the series: a draft made ahead is the one played, and 无畏征召 takes its picks away
{
  const fixture = g.fixtures.find((f) => f.teamA === g.myTeam || f.teamB === g.myTeam)!
  const sim = new MatchSim(g, fixture.teamA, fixture.teamB, 3, new Rng(11))
  const s = sim.openDraft()!
  check(sim.openDraft() === s, '同一局的 BP 只开一次')
  while (!s.done) s.autoStep()
  const made = s.result()
  sim.nextMap()
  check(JSON.stringify(sim.lastDraft) === JSON.stringify(made), '这一局按开好的 BP 打')
  sim.current!.runOut()
  sim.closeMap()
  const s2 = sim.openDraft()!
  const first = [...Object.values(made.blue), ...Object.values(made.red)]
  check(first.every((c) => !s2.open(c)), '第二局：第一局两边选过的英雄都不能再选（无畏征召）')
  check([...made.bansBlue, ...made.bansRed].some((c) => s2.open(c)), '第一局被禁而没被选的英雄，第二局还在')
  check(sim.nextBlue !== 'a', '第二局换边')
}

// ---- the assistant drafts from the sheet
{
  const sheet = { [blue[0].id]: blue[0].agentPool[0] ?? 'Aatrox' }
  const s = new DraftSession(g, blue, red, new Rng(13), { plan: { side: 'blue', picks: sheet } })
  while (!s.done) s.autoStep()
  const want = sheet[blue[0].id]
  const banned = [...s.bans.blue, ...s.bans.red].includes(want) || Object.values(s.picks.red).includes(want)
  check(banned || s.picks.blue[blue[0].id] === want, '助教代选时先按预案：预案英雄还在就拿', `${blue[0].ign} → ${s.picks.blue[blue[0].id]}（预案 ${want}）`)
}

console.log(bad ? `\n❌ ${bad} 项不通过` : '\n✅ 逐手 BP 守住了规则，没人插手时与原来一模一样')
process.exit(bad ? 1 : 0)
