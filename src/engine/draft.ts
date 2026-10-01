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

export type Step = { side: DraftSide; act: 'ban' | 'pick' }
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

/**
 * A draft one step at a time, so the manager can make his own side's calls.
 *
 * `autoStep` is exactly what an AI club does on the step in hand — the same
 * scoring and the same draws from the same generator in the same order — so a
 * draft run through it with nobody intervening is the draft runDraft always
 * made, and every number calibrated against it (check_match_shape,
 * check_draft) holds. `ban` and `pick` are the manager's own moves; a step he
 * leaves to his assistant is `autoStep`, which reads his pre-match sheet first.
 */
export class DraftSession {
  readonly fives: Record<DraftSide, Player[]>
  readonly picks: Record<DraftSide, Record<string, string>> = { blue: {}, red: {} }
  readonly bans: Record<DraftSide, string[]> = { blue: [], red: [] }
  readonly log: string[] = []
  /** steps taken, an index into DRAFT_ORDER */
  step = 0
  private readonly gone: Set<string>
  private readonly mix: Record<DraftSide, StyleMix> = { blue: [0, 0, 0], red: [0, 0, 0] }
  private readonly favoured: Set<string>
  private readonly exists: Set<string>

  constructor(
    state: GameState, blueFive: Player[], redFive: Player[], private readonly rng: Rng,
    private readonly opts: DraftOptions = {},
  ) {
    this.gone = new Set<string>(opts.used ?? [])
    this.fives = { blue: blueFive, red: redFive }
    this.favoured = new Set(darlings(state.patch, 6))
    // Which champions exist on this date is asked once a draft, not once a
    // candidate: it builds a Date, and a draft weighs a few thousand candidates —
    // asked inside the loop it made a simulated season sixty times slower.
    this.exists = new Set(Object.values(AGENTS).flat().filter((c) => agentAvailable(state, c)))
  }

  /** the step to be taken now, or undefined when the draft is over */
  get current(): Step | undefined { return DRAFT_ORDER[this.step] }
  get done(): boolean { return this.step >= DRAFT_ORDER.length }
  /** a champion nobody has banned or picked, in this series or this game */
  open = (c: string): boolean => this.exists.has(c) && !this.gone.has(c)
  /** champions of a man's own position still on the board */
  poolFor = (p: Player): string[] => (AGENTS[p.roles?.[0] ?? p.role] ?? []).filter(this.open)
  /** used in an earlier game of this series (无畏征召) */
  usedBefore = (c: string): boolean => [...(this.opts.used ?? [])].includes(c)
  /** what a club wants this man on this champion, before the match-up — the AI's own number */
  comfortOf = (p: Player, c: string): number => comfort(p, c, this.favoured)

  private name = (s: DraftSide) => (s === 'blue' ? '蓝色方' : '红色方')

  /** the manager bans this champion on his side's ban step */
  ban(c: string): boolean {
    const st = this.current
    if (!st || st.act !== 'ban' || !this.open(c)) return false
    this.gone.add(c)
    this.bans[st.side].push(c)
    this.log.push(`${this.name(st.side)} 禁用 ${agentCn(c)}`)
    this.step++
    return true
  }

  /** the manager puts this man on this champion on his side's pick step */
  pick(playerId: string, c: string): boolean {
    const st = this.current
    if (!st || st.act !== 'pick' || !this.open(c)) return false
    const p = this.fives[st.side].find((x) => x.id === playerId)
    if (!p || this.picks[st.side][p.id]) return false
    this.take(st.side, p, c)
    this.step++
    return true
  }

  private take(side: DraftSide, p: Player, c: string): void {
    this.picks[side][p.id] = c
    this.gone.add(c)
    this.mix[side] = add(this.mix[side], c)
    this.log.push(`${this.name(side)} 选择 ${agentCn(c)}（${p.ign}）`)
  }

  /** the step in hand, the way an AI club takes it */
  autoStep(): void {
    const step = this.current
    if (!step) return
    this.step++
    const me = step.side
    const them: DraftSide = me === 'blue' ? 'red' : 'blue'
    const { rng, picks, fives, mix } = this
    if (step.act === 'ban') {
      // take away what they play best among what is strong, for a man who has not picked yet
      let best: { c: string; v: number } | null = null
      for (const p of fives[them]) {
        if (picks[them][p.id]) continue
        for (const c of this.poolFor(p)) {
          const v = comfort(p, c, this.favoured) + rng.range(0, 14)
          if (!best || v > best.v) best = { c, v }
        }
      }
      if (!best) return
      this.gone.add(best.c)
      this.bans[me].push(best.c)
      this.log.push(`${this.name(me)} 禁用 ${agentCn(best.c)}`)
      return
    }

    // ---- a pick
    const waiting = fives[me].filter((p) => !picks[me][p.id])
    if (!waiting.length) return
    let choice: { p: Player; c: string; v: number } | null = null
    const planned = this.opts.plan?.side === me ? this.opts.plan.picks : undefined
    if (planned) {
      // the manager's sheet first: whoever's planned champion is still there, most contested first
      const ready = waiting
        .filter((p) => planned[p.id] && this.open(planned[p.id]))
        .sort((x, y) => presence(planned[y.id]) - presence(planned[x.id]))
      if (ready.length) choice = { p: ready[0], c: planned[ready[0].id], v: 0 }
    }
    if (!choice) {
      const foe = norm(mix[them])
      const lean = norm(mix[me])
      const leaning = Math.max(...lean) - Math.min(...lean) > 0.05 ? lean.indexOf(Math.max(...lean)) : -1
      for (const p of waiting) {
        for (const c of this.poolFor(p)) {
          const style = agentStyle(c)
          const fit = leaning >= 0 && style ? (style[leaning] - 1) * 5 : 0
          const matchup = Object.keys(picks[them]).length
            ? counterN(norm(add(mix[me], c)), foe) * 6 : 0
          const v = comfort(p, c, this.favoured) + fit + matchup + rng.range(0, 12)
          if (!choice || v > choice.v) choice = { p, c, v }
        }
      }
    }
    if (!choice) {
      // nothing left in his own position's pool (only ever a tiny, banned-out pool): anything open
      const p = waiting[0]
      const c = Object.values(AGENTS).flat().find((x) => this.open(x) && agentRoles(x).length > 0)
      if (!c) return
      choice = { p, c, v: 0 }
    }
    this.take(me, choice.p, choice.c)
  }

  result(): DraftResult {
    return {
      blue: this.picks.blue, red: this.picks.red,
      bansBlue: this.bans.blue, bansRed: this.bans.red, log: this.log,
    }
  }
}

export function runDraft(
  state: GameState, blueFive: Player[], redFive: Player[], rng: Rng, opts: DraftOptions = {},
): DraftResult {
  const s = new DraftSession(state, blueFive, redFive, rng, opts)
  while (!s.done) s.autoStep()
  return s.result()
}

/** The five-champion shape of a finished side, for the panels that show it. */
export const draftMix = (picks: Record<string, string>): StyleMix => styleMix(Object.values(picks))
