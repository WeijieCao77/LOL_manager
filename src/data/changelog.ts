/**
 * What changed, in the words of someone playing it.
 *
 * Not a commit log. Every line here is something a player can see happen in
 * front of them, written from their side of the screen — a fix says what was
 * going wrong, not which function was wrong. Anything that only mattered to
 * the code does not belong in this file at all.
 *
 * Newest first. `kind` colours the line: 新增 is a thing that was not there
 * before, 调整 changes how something already works, 修复 is a bug the group
 * ran into — and most of these were reported there, which is worth showing.
 */
export type ChangeKind = '新增' | '调整' | '修复'

export interface ChangeEntry {
  /** YYYY-MM-DD, as it will be shown */
  date: string
  title: string
  changes: { kind: ChangeKind; text: string }[]
  /**
   * Shown first whatever its date. The list stays in date order here so
   * LATEST — what re-lights the dot on the button — is still the newest
   * entry, not the pinned one.
   */
  pinned?: boolean
}

export const CHANGELOG: ChangeEntry[] = [
  {
    date: '2026-09-18',
    title: '英雄联盟电竞经理：开发中',
    changes: [
      { kind: '新增', text: '<b>六大赛区的真实战队与选手。</b>LPL、LCK、LEC、LCS、LCP、CBLOL 和五个二级联赛，101 支战队、625 名选手，全部来自 2024–2026 的真实比赛数据，没有一个虚构的人。' },
      { kind: '新增', text: '<b>八项能力：对线、操作、团战、发育、意识、心态、协同、运营。</b>每一项都由真实统计在同位置、同联赛内换算；「运营」是他在场时队伍 15 分钟之后多赢多少。' },
      { kind: '新增', text: '<b>173 个英雄。</b>打什么位置、哪年登场、版本强度、偏前期还是后期，全部读自职业比赛。' },
    ],
  },
]

export const LATEST = CHANGELOG[0]?.date ?? ''
