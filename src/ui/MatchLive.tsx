import { useCallback, useEffect, useRef, useState } from 'react'
import { CompBoard } from './CompBoard'
import { useGame } from './ctx'
import { Crest, Face, Modal, OvrBadge, RoleTag, Roles } from './common'
import RoundRibbon, { RibbonLegend } from './RoundRibbon'
import DraftBoard from './DraftBoard'
import TacticSliders from './TacticSliders'
import { squadOf } from '../engine/roster'
import MapPlan from './MapPlan'
import { MatchSim } from '../engine/match'
import { mapCn } from '../engine/content'
import type { Side } from '../engine/match'
import { commitFixture, fixtureRng } from '../engine/season'
import type { Fixture } from '../engine/types'
import { track } from '../engine/telemetry'

type Phase = 'choose' | 'draft' | 'between' | 'watching' | 'timeout' | 'done'

const TICK_MS = 420

/**
 * Playing out one of the manager's own matches.
 *
 * Skipping runs the same MatchSim straight to the end, so watching costs you
 * nothing but time and gains you the two tactical timeouts a real team gets.
 */
export default function MatchLive({
  fixture, onDone,
}: { fixture: Fixture; onDone: (watched: boolean) => void }) {
  const { game, commit, toast } = useGame()
  const simRef = useRef<MatchSim | null>(null)
  const [, bump] = useState(0)
  const [phase, setPhase] = useState<Phase>('choose')
  // 亲自 BP: each game's draft is the manager's to make; off, the assistant drafts from the sheet
  const [manualBp, setManualBp] = useState(true)
  const rerender = useCallback(() => bump((x) => x + 1), [])

  if (!simRef.current) {
    simRef.current = new MatchSim(game, fixture.teamA, fixture.teamB, fixture.bo, fixtureRng(game, fixture), fixture.scrim, fixture.label)
  }
  const sim = simRef.current
  const mySide: Side | null = sim.sideOf(game.myTeam)
  const manual = manualBp && !!mySide && !fixture.scrim
  const a = game.teams[fixture.teamA]
  const b = game.teams[fixture.teamB]

  const finishUp = useCallback((watched: boolean) => {
    const result = sim.finish()
    // Watching is the showpiece — the round ribbon, live timeouts, hundreds of
    // lines of it. Whether anyone actually uses it, or skips to the score every
    // time, decides whether that investment is worth continuing.
    track(watched ? 'match_watched' : 'match_skipped', {
      day: game.day, stage: game.stage, bo: fixture.bo,
      won: fixture.teamA === game.myTeam
        ? result.mapsWonA > result.mapsWonB
        : result.mapsWonB > result.mapsWonA,
      scrim: fixture.comp === 'scrim',
    })
    // finishing a match can conclude the whole competition; those lines belong
    // to the manager, not to the floor
    const notes: string[] = []
    commitFixture(game, fixture, result, notes)
    for (const n of notes) toast(n)
    commit()
    setPhase('done')
    onDone(watched)
  }, [sim, game, fixture, commit, onDone])

  // 观战 and 跳过剩余 render at the same spot on a phone, so a double-tap on
  // 观战 would start the watch and instantly skip it. A skip in the first
  // moments of watching cannot be a considered choice; swallow it.
  const watchedAt = useRef(0)
  const skip = useCallback(() => {
    if (watchedAt.current && Date.now() - watchedAt.current < 1200) return
    // finish whatever is in flight, then run the rest out
    if (sim.current) {
      sim.current.runOut()
      sim.closeMap()
    }
    while (!sim.decided && sim.nextMap()) {
      sim.current!.runOut()
      sim.closeMap()
    }
    finishUp(false)
  }, [sim, finishUp])

  /** on to the next game: its draft if the manager makes it, else straight in */
  const toNextGame = useCallback(() => {
    if (!sim.hasNextMap) { finishUp(true); return }
    if (manual) { sim.openDraft(); setPhase('draft'); return }
    sim.nextMap()
    setPhase('watching')
    rerender()
  }, [sim, manual, finishUp, rerender])

  const step = useCallback(() => {
    const m = sim.current
    if (!m) {
      if (!sim.hasNextMap) { finishUp(true); return }
      if (manual) { sim.openDraft(); setPhase('draft'); return }
      sim.nextMap()
      rerender()
      return
    }
    if (m.over) {
      sim.closeMap()
      if (!sim.hasNextMap) { finishUp(true); return }
      // between games of a series: change the five or the dials before the next draft
      if (mySide && !fixture.scrim) { setPhase('between'); rerender(); return }
      rerender()
      return
    }
    m.playRound()
    rerender()
  }, [sim, finishUp, rerender, manual, mySide, fixture.scrim])

  useEffect(() => {
    if (phase !== 'watching') return
    const id = window.setInterval(step, TICK_MS)
    return () => window.clearInterval(id)
  }, [phase, step])

  const map = sim.current
  const canTimeout = !!mySide && !!map && map.canTimeout(mySide)

  const callTimeout = (kind: 'rush' | 'steady' | 'focus', playerId?: string) => {
    if (!mySide || !map) return
    if (map.callTimeout(mySide, { kind, playerId })) {
      const label = kind === 'rush' ? '强攻' : kind === 'steady' ? '稳守' : '打核心'
      toast(`临场调整：${label}（接下来约 6 分钟）`)
      setPhase('watching')
      rerender()
    }
  }

  // ---------------------------------------------------------------- the draft
  if (phase === 'draft') {
    const session = sim.openDraft()
    if (session && mySide) {
      const blueIsA = sim.nextBlue === 'a'
      return (
        <Modal wide title={`${game.comps[fixture.comp]?.name ?? ''} · BO${fixture.bo} · 大比分 ${sim.wonA} - ${sim.wonB}`} onClose={skip} onBgClose={() => {}}>
          <DraftBoard
            session={session}
            mySide={(mySide === 'a') === blueIsA ? 'blue' : 'red'}
            blueTeam={blueIsA ? fixture.teamA : fixture.teamB}
            redTeam={blueIsA ? fixture.teamB : fixture.teamA}
            game={sim.played.length + 1}
            onDone={() => { sim.nextMap(); setPhase('watching'); rerender() }}
          />
        </Modal>
      )
    }
  }

  // ---------------------------------------------------------------- between games
  if (phase === 'between' && mySide) {
    const last = sim.played[sim.played.length - 1]
    const me = game.teams[game.myTeam]
    const squad = squadOf(game, game.myTeam)
    const ourWin = last && (mySide === 'a' ? last.scoreA > last.scoreB : last.scoreB > last.scoreA)
    const swap = (from: string, to: string) => {
      me.starters = me.starters.map((x) => (x === from ? to : x))
      commit()
      rerender()
    }
    return (
      <Modal wide title={`第 ${sim.played.length} 局结束 · 大比分 ${sim.wonA} - ${sim.wonB}`} onClose={skip} onBgClose={() => {}}>
        {last && (
          <p className="center small" style={{ marginTop: 0 }}>
            {ourWin ? '拿下' : '输掉'}这一局：{Math.round(last.minutes ?? 0)} 分钟，击杀（我方在前）{mySide === 'a' ? `${last.killsA ?? 0} : ${last.killsB ?? 0}` : `${last.killsB ?? 0} : ${last.killsA ?? 0}`}。
          </p>
        )}
        <div className="panel own">
          <div className="panel-head"><h2>局间调整</h2></div>
          <div className="panel-body">
            <p className="tiny faint" style={{ marginTop: 0 }}>
              下一局按这里的五个人和滑杆打。换人只能同位置换；无畏征召下，这个系列赛已经选过的英雄两边都不能再用。
            </p>
            {me.starters.map((id) => {
              const p = game.players[id]
              if (!p) return null
              const same = squad.filter((x) => x.role === p.role && (x.id === id || !me.starters.includes(x.id)))
              return (
                <div key={id} className="row" style={{ gap: 8, alignItems: 'center', margin: '4px 0' }}>
                  <RoleTag role={p.role} />
                  <select value={id} onChange={(e) => swap(id, e.target.value)} disabled={same.length < 2}>
                    {same.map((x) => <option key={x.id} value={x.id}>{x.ign}（{x.overall}）{x.fatigue >= 60 ? ' 疲劳' : ''}</option>)}
                  </select>
                </div>
              )
            })}
            <div style={{ marginTop: 10 }}>
              <TacticSliders game={game} commit={commit} compact map={sim.maps[0]} />
            </div>
          </div>
        </div>
        <div className="row" style={{ gap: 10, justifyContent: 'center', marginTop: 14 }}>
          <button className="primary" onClick={toNextGame}>
            {manual ? `进入第 ${sim.played.length + 1} 局 BP` : `开始第 ${sim.played.length + 1} 局`}
          </button>
          <button onClick={skip}>快进剩下的</button>
        </div>
      </Modal>
    )
  }

  if (phase === 'choose') {
    return (
      <Modal title={`${game.comps[fixture.comp]?.name ?? fixture.comp} · BO${fixture.bo}`} onClose={skip} onBgClose={() => {}}>
        <div className="score-line">
          <div className="t a" title={a?.name}><Crest id={fixture.teamA} size={30} /><span>{a?.tag}</span></div>
          <div className="s muted" style={{ fontSize: 22 }}>VS</div>
          <div className="t" title={b?.name}><Crest id={fixture.teamB} size={30} /><span>{b?.tag}</span></div>
        </div>
        <p className="center small muted" style={{ marginTop: -6 }}>
          {fixture.label.replace(/^KO:\d+:/, '')}
        </p>
        {!fixture.scrim && mySide && (
          <label className="row small" style={{ gap: 8, marginTop: 14, cursor: 'pointer', alignItems: 'flex-start' }}>
            <input type="checkbox" checked={manualBp} onChange={(e) => setManualBp(e.target.checked)} style={{ width: 16, marginTop: 2 }} />
            <span>
              <b>观战时每局亲自 BP</b>
              <span className="muted"> — 十禁十选，轮到我方时你来禁、你来选，也可以随时交给助教。
                不勾的话助教按下面的预案代选：预案里的英雄还在就拿，被禁或被拿走了他自己挑。</span>
            </span>
          </label>
        )}

        {/* one plan per map: the five agents and the four dials together,
            with the opponent's likely shape beside them. Anything changed
            here is tonight's sheet and the map's new default. */}
        <div className="panel own" style={{ marginTop: 12 }}>
          <div className="panel-head">
            <h2>各图预案 · 英雄与战术</h2>
            <div className="spacer" style={{ flex: 1 }} />
            <span className="tiny faint">改了就记住，下次这张图直接用</span>
          </div>
          <div className="panel-body">
            <MapPlan
              maps={[...new Set(simRef.current!.maps)]} mode="match"
              opp={fixture.teamA === game.myTeam ? fixture.teamB : fixture.teamA}
            />
          </div>
        </div>

        <div className="row" style={{ gap: 10, justifyContent: 'center', marginTop: 18 }}>
          <button className="primary" onClick={() => {
            watchedAt.current = Date.now()
            if (manual) { sim.openDraft(); setPhase('draft') } else setPhase('watching')
          }}>
            观战（可临场调整 2 次）
          </button>
          <button onClick={skip}>快进到结果</button>
        </div>
        <p className="tiny faint center" style={{ marginTop: 14, marginBottom: 0 }}>
          观战与快进结果相同。每局可临场调整 2 次。
        </p>
      </Modal>
    )
  }

  if (phase === 'done') return null

  // ---------------------------------------------------------------- watching
  const mineIsA = fixture.teamA === game.myTeam
  const scoreA = map ? map.a : sim.wonA
  const scoreB = map ? map.b : sim.wonB

  // `round` counts rounds completed, so it reads 0 in the moment before the
  // first one is played — and "第 0 回合" is not a thing that exists

  return (
    <Modal wide title={map ? `第 ${sim.played.length + 1} 局 · ${Math.floor(map.minute)} 分钟 · 击杀 ${map.a} : ${map.b}` : '下一局 BP 中'} onClose={skip} onBgClose={() => {}}>
      <div className="row" style={{ gap: 8, justifyContent: 'center', marginBottom: 6 }}>
        {sim.played.map((m, i) => (
          <span key={i} className="tag">
            {mapCn(m.map)} {m.scoreA}-{m.scoreB}
          </span>
        ))}
        <span className="tag t1">大比分 {sim.wonA} - {sim.wonB}</span>
      </div>

      <div className="score-line" style={{ padding: '10px 0' }}>
        <div className={`t a ${scoreA > scoreB ? 'win' : ''}`} title={a?.name}>
          <Crest id={fixture.teamA} size={26} /><span>{a?.tag}</span></div>
        <div className="s">{scoreA} : {scoreB}</div>
        <div className={`t ${scoreB > scoreA ? 'win' : ''}`} title={b?.name}>
          <Crest id={fixture.teamB} size={26} /><span>{b?.tag}</span></div>
      </div>

      {map && map.rounds.length > 0 && (
        <div style={{ marginBottom: 12 }}>
          <RoundRibbon
            rounds={map.rounds} mineIsA={mineIsA}
            mineTag={(mineIsA ? a : b)?.tag} theirTag={(mineIsA ? b : a)?.tag}
          />
          <div style={{ marginTop: 8 }}>
            <RibbonLegend />
          </div>
        </div>
      )}

      {phase === 'timeout' && map && mySide ? (
        <div className="panel own">
          <div className="panel-head"><h2>临场调整 · 剩余 {map.timeouts[mySide]} 次</h2></div>
          <div className="panel-body">
            {/* 先给他看清楚两边排了什么 —— 没有这个，下面那三个按钮只能靠猜 */}
            <CompBoard
              mine={mySide === 'a' ? map.A : map.B}
              theirs={mySide === 'a' ? map.B : map.A}
            />
            <p className="small muted" style={{ marginTop: 0 }}>选择接下来三个节点（约 6 分钟）的打法：</p>
            <div className="row wrap" style={{ gap: 8, marginBottom: 14 }}>
              <button onClick={() => callTimeout('rush')}>
                强攻 <span className="tiny faint">主动开团抢资源，赢了滚雪球，输了被反打</span>
              </button>
              <button onClick={() => callTimeout('steady')}>
                稳守 <span className="tiny faint">少接团、稳住经济，适合领先或等后期</span>
              </button>
            </div>
            {/* The four dials used to sit here, set to the NEXT map — which
                nobody read that way: 「放在这里很容易误解以为是做这张图的调
                整」. They live in 赛前「各图预案」, one sheet per map, where
                the map being edited is the one written above the sliders. */}
            <p className="tiny faint" style={{ marginTop: 0, marginBottom: 14 }}>
              战术滑杆在赛前的预案里；临场调整只管接下来三个节点。
            </p>
            <div className="small muted" style={{ marginBottom: 6 }}>或者围绕一名选手打：</div>
            <div className="row wrap" style={{ gap: 6 }}>
              {(mySide === 'a' ? map.A : map.B).players.map((p) => (
                <button key={p.id} className="sm" onClick={() => callTimeout('focus', p.id)}>
                  <Face id={p.id} size={16} />{p.ign} <OvrBadge value={p.overall} />
                </button>
              ))}
            </div>
            <div style={{ marginTop: 12 }}>
              {/* 「取消」 read as "discard something" — there is nothing here to
                  discard. A timeout is only spent by the three calls above, so
                  looking at the two sheets and leaving costs nothing. */}
              <button className="ghost sm" onClick={() => setPhase('watching')}>直接继续比赛</button>
              <p className="tiny faint" style={{ marginTop: 6, marginBottom: 0 }}>
                只看一眼不花次数，选了打法才用掉一次。
              </p>
            </div>
          </div>
        </div>
      ) : (
        <div className="row" style={{ gap: 10, justifyContent: 'center' }}>
          <button
            className="primary"
            disabled={!canTimeout}
            onClick={() => setPhase('timeout')}
          >
            临场调整{map && mySide ? `（${map.timeouts[mySide]}）` : ''}
          </button>
          <button onClick={skip}>跳过剩余</button>
        </div>
      )}

      {map && mySide && map.calls[mySide] && (
        <p className="center small" style={{ color: 'var(--accent)', marginBottom: 0 }}>
          战术生效中：
          {map.calls[mySide]!.kind === 'rush' ? '强攻'
            : map.calls[mySide]!.kind === 'steady' ? '稳守'
            : `围绕 ${game.players[map.calls[mySide]!.playerId!]?.ign} 打`}
          （还剩 {map.calls[mySide]!.roundsLeft} 个节点）
        </p>
      )}

      {map && (
        <div className="row wrap tiny faint" style={{ gap: 10, justifyContent: 'center', marginTop: 10 }}>
          {(mySide === 'a' ? map.A : map.B).players.map((p) => (
            <span key={p.id} className="row" style={{ gap: 4 }}>
              <Roles p={p} /><Face id={p.id} size={16} /><span>{p.ign}</span>
            </span>
          ))}
        </div>
      )}
    </Modal>
  )
}
