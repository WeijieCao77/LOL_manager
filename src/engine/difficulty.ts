/**
 * 难度 — how hard the rest of the world pushes back.
 *
 * Ported from VAL MANAGER (2026-09-23). Its group said 「把数值练满了后期就无脑玩了」,
 * and measured, a stand-in manager who never touched a slider won 89% of his
 * series there; with the five trained out, 99% and every trophy. Nothing in
 * the world answered a club that strong. The same engine underneath, the same
 * answer here — scripts/measure_late_game.ts measures it on this world.
 *
 * Every knob the difficulty turns lives in this one table, so a check can read
 * the same numbers the engine plays with. 普通 is what every save without a
 * choice runs — the old saves too — and it is already harder than the game
 * was: opponents study tape at every level (engine/scouting.ts). 困难 and 职业
 * add a stronger world and a flatter top of the rating curve.
 *
 * A career can move UP a level from the 存档 page at any time, never down: a
 * level you can drop before a final is not a level.
 */
import type { GameState } from './types'

export type Difficulty = 'normal' | 'hard' | 'pro'

export interface DifficultySpec {
  label: string
  blurb: string
  /** the most strength points a fully prepared opponent adds against us */
  prepMax: number
  /**
   * Above this weighted player rating, each further point is worth `topSlope`
   * of a point. Both sides, every club — a flatter top of the curve, so a
   * five of 99s is a favourite, not a certainty. `topSlope` 1 turns it off.
   */
  topKnee: number
  topSlope: number
  /**
   * The same for the five's 运营. Its scale sits higher than overall at the
   * top (Faker 95 on a 76 overall), and the knee for overall would flatten
   * exactly the number that makes an old shotcaller worth his place —
   * check_onoff caught it: Faker's absence went from costing 3.9 points more
   * than a teammate's to 1.3. So 普通 leaves every real player alone and only
   * a trained-out macro meets it.
   */
  macroKnee: number
  /** what an AI club trains an attribute up to */
  aiPolishStop: number
  /** the ceiling on `state.rivalry` wherever the world reads it */
  rivalryCap: number
  /** how well an AI club knows the style it plays (neutral is 50) */
  aiFamiliarity: number
  /** weekly grievance from a pay demand left unanswered */
  payGrievance: number
}

/**
 * VAL's table was 6 / 8 / 10 prep and knees at 90 / 88 / 86. Copied as it was,
 * it barely touched this world: the strongest club here is GEN at 86, so a knee
 * at 90 compressed nobody but a trained-out five, and six points of prep moved a
 * BLG that never touched a slider from about 88% of series to 85%. Re-fitted on
 * this engine to land where VAL landed (scripts/measure_late_game.ts, two seeds ×
 * two seasons, BLG, series won):
 *
 *            as found   trained out     VAL after its change
 *   普通       82%         98%            79% / 96%
 *   困难       78%         94%
 *   职业       75%         86%            73% / 82%
 */
export const DIFFICULTY: Record<Difficulty, DifficultySpec> = {
  normal: {
    label: '普通',
    blurb: '对手会研究你的比赛录像。',
    prepMax: 12, topKnee: 84, topSlope: 0.6, macroKnee: 96,
    aiPolishStop: 97, rivalryCap: 2, aiFamiliarity: 50, payGrievance: 2,
  },
  hard: {
    label: '困难',
    blurb: 'AI 练得更满、打得更熟，顶尖数值的收益变小。',
    prepMax: 16, topKnee: 82, topSlope: 0.5, macroKnee: 92,
    aiPolishStop: 99, rivalryCap: 3, aiFamiliarity: 62, payGrievance: 3,
  },
  pro: {
    label: '职业',
    blurb: '全世界都在针对你。练满也不保证赢。',
    prepMax: 20, topKnee: 80, topSlope: 0.4, macroKnee: 90,
    aiPolishStop: 99, rivalryCap: 4, aiFamiliarity: 70, payGrievance: 4,
  },
}

export const DIFFICULTY_ORDER: Difficulty[] = ['normal', 'hard', 'pro']

export const difficultyOf = (state: Pick<GameState, 'difficulty'>): Difficulty =>
  state.difficulty && DIFFICULTY[state.difficulty] ? state.difficulty : 'normal'

export const spec = (state: Pick<GameState, 'difficulty'>): DifficultySpec => DIFFICULTY[difficultyOf(state)]

/** The provocation a title leaves, read through this career's ceiling. */
export const rivalryOf = (state: Pick<GameState, 'difficulty' | 'rivalry'>): number =>
  Math.min(Math.max(state.rivalry ?? 0, 0), spec(state).rivalryCap)

/** The flatter top of the rating curve. */
export function flattenTop(state: Pick<GameState, 'difficulty'>, base: number): number {
  const { topKnee, topSlope } = spec(state)
  return base <= topKnee ? base : topKnee + (base - topKnee) * topSlope
}

/** The flatter top for 运营, at its own knee and the level's slope. */
export function flattenMacro(state: Pick<GameState, 'difficulty'>, macro: number): number {
  const { macroKnee, topSlope } = spec(state)
  return macro <= macroKnee ? macro : macroKnee + (macro - macroKnee) * topSlope
}

/** A career may go up a level, never down. Returns the refusal, or null. */
export function raiseDifficulty(state: GameState, to: Difficulty): string | null {
  const from = DIFFICULTY_ORDER.indexOf(difficultyOf(state))
  const next = DIFFICULTY_ORDER.indexOf(to)
  if (next < 0) return '没有这个难度。'
  if (next <= from) return '难度只能往上调。'
  state.difficulty = to
  state.news.push({ day: state.day, kind: 'club', important: true, text: `难度调到「${DIFFICULTY[to].label}」。` })
  return null
}
