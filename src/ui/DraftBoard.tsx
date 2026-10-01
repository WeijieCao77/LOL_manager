import { useEffect, useMemo, useState } from 'react'
import { useGame } from './ctx'
import { AgentIcon, Crest, Face, RoleTag } from './common'
import { DRAFT_ORDER } from '../engine/draft'
import type { DraftSession, DraftSide } from '../engine/draft'
import { AGENTS, agentCn, draftLine } from '../engine/content'
import { STYLE_CN, agentStyle, compStyle, COMP_STYLE_CN } from '../engine/comp'
import type { Player } from '../engine/types'

/** how long an opponent's step stays on screen before the next one */
const AI_STEP_MS = 420

const sideCn = (s: DraftSide) => (s === 'blue' ? '蓝色方' : '红色方')
const leanOf = (c: string): string => {
  const m = agentStyle(c)
  if (!m) return ''
  const i = m.indexOf(Math.max(...m))
  return m[i] > 1.12 ? STYLE_CN[i] : '均衡'
}

/**
 * The draft, one step at a time (engine/draft.ts DraftSession).
 *
 * Ten bans and ten picks in the real order. The other side's steps play
 * themselves, a beat apart, the way the AI always drafts; on ours the manager
 * bans and picks, or hands the step — or the rest of the draft — to his
 * assistant, who follows the pre-match sheet first. Under 无畏征召 a champion
 * picked earlier in the series is gone for both sides and does not appear.
 */
export default function DraftBoard({
  session, mySide, blueTeam, redTeam, game: gameNo, onDone,
}: {
  session: DraftSession; mySide: DraftSide; blueTeam: string; redTeam: string; game: number; onDone: () => void
}) {
  const { game } = useGame()
  const [, bump] = useState(0)
  const rerender = () => bump((x) => x + 1)
  const [who, setWho] = useState<string | null>(null)
  const [q, setQ] = useState('')
  const [auto, setAuto] = useState(false)
  const cur = session.current
  const mine = !!cur && cur.side === mySide && !auto
  const them: DraftSide = mySide === 'blue' ? 'red' : 'blue'

  // the other side's steps — and ours once handed over — play themselves
  useEffect(() => {
    if (!cur || mine) return
    const id = window.setTimeout(() => { session.autoStep(); rerender() }, auto && cur.side === mySide ? 120 : AI_STEP_MS)
    return () => window.clearTimeout(id)
  })

  const waiting = cur?.act === 'pick' && cur.side === mySide
    ? session.fives[mySide].filter((p) => !session.picks[mySide][p.id]) : []
  const picker = waiting.find((p) => p.id === who) ?? waiting[0]

  const options = useMemo(() => {
    if (!cur || !mine) return []
    const all = Object.values(AGENTS).flat().filter((c, i, a) => a.indexOf(c) === i && session.open(c))
    const find = q.trim().toLowerCase()
    const match = (c: string) => !find || agentCn(c).toLowerCase().includes(find) || c.toLowerCase().includes(find)
    if (cur.act === 'ban') {
      // what they would most like to play, among what they have not picked yet
      const foes = session.fives[them].filter((p) => !session.picks[them][p.id])
      return all.filter(match).map((c) => {
        let top: { p: Player; v: number } | null = null
        for (const p of foes) {
          if (!session.poolFor(p).includes(c)) continue
          const v = session.comfortOf(p, c)
          if (!top || v > top.v) top = { p, v }
        }
        return { c, v: top?.v ?? -1, note: top ? `${top.p.ign} 熟练 ${Math.round(top.p.agentPro?.[c] ?? 0)}` : '' }
      }).sort((a, b) => b.v - a.v).slice(0, find ? 40 : 24)
    }
    if (!picker) return []
    const own = new Set(session.poolFor(picker))
    return all.filter((c) => match(c) && (find ? true : own.has(c))).map((c) => ({
      c, v: session.comfortOf(picker, c) + (own.has(c) ? 0 : -60),
      note: `熟练 ${Math.round(picker.agentPro?.[c] ?? 0)}${own.has(c) ? '' : ' · 非本位置'}`,
    })).sort((a, b) => b.v - a.v).slice(0, 30)
  }, [cur?.act, cur?.side, mine, q, picker?.id, session.step])

  const choose = (c: string) => {
    const ok = cur?.act === 'ban' ? session.ban(c) : picker ? session.pick(picker.id, c) : false
    if (ok) { setQ(''); setWho(null); rerender() }
  }

  const column = (side: DraftSide) => {
    const team = side === 'blue' ? blueTeam : redTeam
    const t = game.teams[team]
    const live = cur?.side === side
    return (
      <div className={`draft-side ${side}${live ? ' live' : ''}`}>
        <div className="row" style={{ gap: 6, alignItems: 'center', marginBottom: 6 }}>
          <Crest id={team} size={18} /><b>{t?.tag}</b>
          <span className="tiny muted">{sideCn(side)}{side === mySide ? ' · 我方' : ''}</span>
        </div>
        <div className="row wrap" style={{ gap: 3, marginBottom: 8, minHeight: 22 }}>
          {session.bans[side].map((c) => (
            <span key={c} style={{ opacity: 0.55, filter: 'grayscale(1)' }} title={`禁用 ${agentCn(c)}`}><AgentIcon name={c} size={20} /></span>
          ))}
          {Array.from({ length: 5 - session.bans[side].length }, (_, i) => <span key={i} className="draft-slot" />)}
        </div>
        {session.fives[side].map((p) => {
          const c = session.picks[side][p.id]
          return (
            <div key={p.id} className={`draft-row${side === mySide && picker?.id === p.id && mine ? ' on' : ''}`}
              onClick={() => side === mySide && !c && mine && cur?.act === 'pick' && setWho(p.id)}>
              <RoleTag role={p.role} /><Face id={p.id} size={18} />
              <span className="nm">{p.ign}</span>
              <span style={{ flex: 1 }} />
              {c ? <><AgentIcon name={c} size={20} /><span className="small">{agentCn(c)}</span></> : <span className="tiny faint">—</span>}
            </div>
          )
        })}
      </div>
    )
  }

  const done = session.done
  const style = (side: DraftSide) => {
    const picks = Object.values(session.picks[side])
    return picks.length === 5 ? COMP_STYLE_CN[compStyle(picks)].label : ''
  }

  return (
    <div>
      <div className="row" style={{ gap: 8, alignItems: 'center', marginBottom: 10 }}>
        <b>第 {gameNo} 局 BP</b>
        <span className="tiny muted">第 {Math.min(session.step + 1, DRAFT_ORDER.length)} / {DRAFT_ORDER.length} 手</span>
        <span style={{ flex: 1 }} />
        {!done && cur && (
          <span className={`tag${cur.side === mySide ? ' t1' : ''}`}>
            {sideCn(cur.side)} · {cur.act === 'ban' ? '禁用' : '选择'}{cur.side === mySide ? (auto ? '（助教代选中）' : '（轮到你）') : ''}
          </span>
        )}
      </div>
      <div className="draft-board">
        {column('blue')}
        {column('red')}
      </div>

      {mine && cur && (
        <div className="panel own" style={{ marginTop: 10 }}>
          <div className="panel-head">
            <h2>{cur.act === 'ban' ? '禁用一个英雄' : `给 ${picker?.ign ?? ''} 选英雄`}</h2>
            <div className="spacer" style={{ flex: 1 }} />
            <input placeholder="搜英雄（中文或英文）" value={q} onChange={(e) => setQ(e.target.value)} style={{ width: 170 }} />
          </div>
          <div className="panel-body">
            <p className="tiny faint" style={{ marginTop: 0 }}>
              {cur.act === 'ban'
                ? '按对面还没选的人最想玩的排序：他们自己的熟练度、这赛季的热度和版本。'
                : '按他的熟练度、这赛季的热度和版本排序；搜索可以选非本位置的英雄（打得会差一截）。'}
              {' '}无畏征召：本系列赛已经选过的英雄不再出现。
            </p>
            <div className="draft-options">
              {options.map(({ c, note }) => (
                <button key={c} className="draft-opt" onClick={() => choose(c)} title={draftLine(c)}>
                  <AgentIcon name={c} size={22} />
                  <span className="small"><b>{agentCn(c)}</b> <span className="tiny faint">{leanOf(c)}</span></span>
                  <span className="tiny muted">{note}{draftLine(c) ? ` · ${draftLine(c)}` : ''}</span>
                </button>
              ))}
              {!options.length && <p className="tiny muted">没有符合的英雄。</p>}
            </div>
            <div className="row" style={{ gap: 8, marginTop: 10 }}>
              <button className="sm" onClick={() => { session.autoStep(); rerender() }}>助教代选这一手</button>
              <button className="sm ghost" onClick={() => setAuto(true)}>剩下的都交给助教</button>
            </div>
          </div>
        </div>
      )}

      {done ? (
        <div style={{ marginTop: 12 }}>
          <p className="small center" style={{ margin: '0 0 8px' }}>
            {game.teams[blueTeam]?.tag} {style('blue')} 对 {game.teams[redTeam]?.tag} {style('red')}
          </p>
          <div className="row" style={{ justifyContent: 'center' }}>
            <button className="primary" onClick={onDone}>开始第 {gameNo} 局</button>
          </div>
        </div>
      ) : (
        <details style={{ marginTop: 10 }}>
          <summary className="tiny muted" style={{ cursor: 'pointer' }}>BP 记录（{session.log.length}）</summary>
          <div className="tiny faint" style={{ marginTop: 6, lineHeight: 1.7 }}>{session.log.join(' · ')}</div>
        </details>
      )}
    </div>
  )
}
