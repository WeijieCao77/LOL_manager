/**
 * The draft: ten bans, ten picks, one champion to one side.
 *
 * In the shooter this engine came from, each club filled in its own sheet and
 * both could field the same agent, so an AI club simply took the most popular
 * agent in every role — and once the data was League's, all fifty-eight
 * tier-one clubs drafted the identical five. Here the two sides draft against
 * each other in the real order, what one takes the other cannot have, and a
 * series is played 无畏征召: a champion picked in an earlier game is gone for
 * everybody for the rest of it. That last rule is what makes a champion pool
 * worth having — by game four of a final the comfort picks are used up, and
 * the side that can still draft something it has practised is the side with
 * the deeper five.
 *
 * Order, as played: three bans each (blue first), then picks B · R R · B B · R,
 * two more bans each (red first), then picks R · B B · R.
 *
 * What an AI club weighs when it picks: how well the man plays the champion,
 * how contested the champion is this season, whether the patch favours it,
 * whether it fits the way the five is already leaning, and whether it turns
 * the match-up against what the other side has shown. When it bans, it takes
 * away what the other side plays best among what is strong.
 */
import { AGENTS, agentCn, agentRoles, presence } from './content'
import { agentStyle, counterN, darlings, styleMix } from './comp'
import type { StyleMix } from './comp'
import { agentAvailable } from './eras'
import type { Rng } from './rng'
import type { GameState, Player } from './types'

export type DraftSide = 'blue' | 'red'

export interface DraftResult {
  /** playerId -> champion, for each side */
  blue: Record<string, string>
  red: Record<string, string>
  bansBlue: string[]
  bansRed: string[]
  /** the draft as it was called, one line a step */
  log: string[]
}

type Step = { side: DraftSide; act: 'ban' | 'pick' }
const seq = (s: string): Step[] => s.split(' ').map((t) => ({
  side: t[0] === 'B' ? 'blue' : 'red', act: t[1] === 'b' ? 'ban' : 'pick',
}))
/** Bb = blue ban, Rp = red pick … */
export const DRAFT_ORDER: Step[] = seq(
  'Bb Rb Bb Rb Bb Rb Bp Rp Rp Bp Bp Rp Rb Bb Rb Bb Rp Bp Bp Rp',
)

const MAX_PRESENCE = Math.max(0.01, ...Object.values(AGENTS).flat().map(presence))

/** How much a club wants this man on this champion, before the match-up is read. */
function comfort(p: Player, champ: string, patchFavours: Set<string>): number {
  const pro = p.agentPro?.[champ] ?? 0
  return pro * 0.55 + (presence(champ) / MAX_PRESENCE) * 42 + (patchFavours.has(champ) ? 8 : 0)
}

const add = (m: StyleMix, c: string): StyleMix => {
  const v = agentStyle(c)
  return v ? [m[0] + v[0], m[1] + v[1], m[2] + v[2]] : m
}
const norm = (m: StyleMix): StyleMix => {
  const t = m[0] + m[1] + m[2]
  return t ? [m[0] / t, m[1] / t, m[2] / t] : [1 / 3, 1 / 3, 1 / 3]
}

/**
 * 无畏征召: a champion picked earlier in a series cannot be picked again by
 * either side. The professional game adopted it across the 2025 season, so a
 * career in an earlier year drafts without it.
 */
export const fearlessDraft = (state: Pick<GameState, 'year'>): boolean => state.year >= 2025

export interface DraftOptions {
  /** champions nobody may pick: used earlier in this series under 无畏征召 */
  used?: Iterable<string>
  /**
   * What the managed club intends to play, playerId -> champion. Each is taken
   * when that man's pick comes if it is still there; if it has been banned or
   * taken, the assistant coach picks for him the way an AI club would.
   */
  plan?: { side: DraftSide; picks: Record<string, string> }
}

export function runDraft(
  state: GameState, blueFive: Player[], redFive: Player[], rng: Rng, opts: DraftOptions = {},
): DraftResult {
  const gone = new Set<string>(opts.used ?? [])
  const fives: Record<DraftSide, Player[]> = { blue: blueFive, red: redFive }
  const picks: Record<DraftSide, Record<string, string>> = { blue: {}, red: {} }
  const bans: Record<DraftSide, string[]> = { blue: [], red: [] }
  const mix: Record<DraftSide, StyleMix> = { blue: [0, 0, 0], red: [0, 0, 0] }
  const log: string[] = []
  const favoured = new Set(darlings(state.patch, 6))
  const other = (s: DraftSide): DraftSide => (s === 'blue' ? 'red' : 'blue')
  // Which champions exist on this date is asked once a draft, not once a
  // candidate: it builds a Date, and a draft weighs a few thousand candidates —
  // asked inside the loop it made a simulated season sixty times slower.
  const exists = new Set(Object.values(AGENTS).flat().filter((c) => agentAvailable(state, c)))
  const open = (c: string) => exists.has(c) && !gone.has(c)
  const roleOf = (p: Player) => p.roles?.[0] ?? p.role
  const poolFor = (p: Player) => (AGENTS[roleOf(p)] ?? []).filter(open)
  const name = (s: DraftSide) => (s === 'blue' ? '蓝色方' : '红色方')

  for (const step of DRAFT_ORDER) {
    const me = step.side
    const them = other(me)
    if (step.act === 'ban') {
      // take away what they play best among what is strong, for a man who has not picked yet
      let best: { c: string; v: number } | null = null
      for (const p of fives[them]) {
        if (picks[them][p.id]) continue
        for (const c of poolFor(p)) {
          const v = comfort(p, c, favoured) + rng.range(0, 14)
          if (!best || v > best.v) best = { c, v }
        }
      }
      if (!best) continue
      gone.add(best.c)
      bans[me].push(best.c)
      log.push(`${name(me)} 禁用 ${agentCn(best.c)}`)
      continue
    }

    // ---- a pick
    const waiting = fives[me].filter((p) => !picks[me][p.id])
    if (!waiting.length) continue
    let choice: { p: Player; c: string; v: number } | null = null
    const planned = opts.plan?.side === me ? opts.plan.picks : undefined
    if (planned) {
      // the manager's sheet first: whoever's planned champion is still there, most contested first
      const ready = waiting
        .filter((p) => planned[p.id] && open(planned[p.id]))
        .sort((x, y) => presence(planned[y.id]) - presence(planned[x.id]))
      if (ready.length) choice = { p: ready[0], c: planned[ready[0].id], v: 0 }
    }
    if (!choice) {
      const foe = norm(mix[them])
      const lean = norm(mix[me])
      const leaning = Math.max(...lean) - Math.min(...lean) > 0.05 ? lean.indexOf(Math.max(...lean)) : -1
      for (const p of waiting) {
        for (const c of poolFor(p)) {
          const style = agentStyle(c)
          const fit = leaning >= 0 && style ? (style[leaning] - 1) * 5 : 0
          const matchup = Object.keys(picks[them]).length
            ? counterN(norm(add(mix[me], c)), foe) * 6 : 0
          const v = comfort(p, c, favoured) + fit + matchup + rng.range(0, 12)
          if (!choice || v > choice.v) choice = { p, c, v }
        }
      }
    }
    if (!choice) {
      // nothing left in his own position's pool (only ever a tiny, banned-out pool): anything open
      const p = waiting[0]
      const c = Object.values(AGENTS).flat().find((x) => open(x) && agentRoles(x).length > 0)
      if (!c) continue
      choice = { p, c, v: 0 }
    }
    picks[me][choice.p.id] = choice.c
    gone.add(choice.c)
    mix[me] = add(mix[me], choice.c)
    log.push(`${name(me)} 选择 ${agentCn(choice.c)}（${choice.p.ign}）`)
  }
  return { blue: picks.blue, red: picks.red, bansBlue: bans.blue, bansRed: bans.red, log }
}

/** The five-champion shape of a finished side, for the panels that show it. */
export const draftMix = (picks: Record<string, string>): StyleMix => styleMix(Object.values(picks))
