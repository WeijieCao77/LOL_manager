/**
 * The standing plan: what the club runs on every map in the pool, decided
 * here rather than in the two minutes before a match.
 *
 * Per map — the five agents and the four dials together — because a plan is
 * a map's plan. Scrims are played on it and the 跑图 drill rehearses it, so
 * a comp set here and left alone becomes a familiar one without the manager
 * touching it again. The general dials underneath are what any map without
 * its own setting falls back to.
 */
import { useGame } from './ctx'
import { Bar, Face, Panel, RoleTag } from './common'
import { buildLineup, poolFor, selectLineup, sheetFor, tacticsFor } from '../engine/match'
import { PREP_FLOOR, READ_FULL, heatLabel, readOf } from '../engine/scouting'
import { DIFFICULTY, difficultyOf, spec } from '../engine/difficulty'
import { COMP_STYLE_CN } from '../engine/comp'
import { familiarity } from '../engine/comp'
import { MAPS, mapCn } from '../engine/content'
import { mapReleased } from '../engine/eras'
import MapPlan, { StyleTag } from './MapPlan'
import TacticSliders from './TacticSliders'
import { PatchPanel } from './PatchNotes'

export default function Tactics() {
  const { game, commit } = useGame()
  const me = game.teams[game.myTeam]
  const pool = poolFor(game)

  const lineup = selectLineup(game, game.myTeam)
  const preview = buildLineup(game, game.myTeam, pool[0])

  return (
    <>
      <PatchPanel />
      <Panel
        title="各图预案 · 每张图的英雄阵容和战术"
        className="own"
        actions={<span className="tiny faint">训练赛和战术训练都按这里练</span>}
      >
        <p className="small muted" style={{ marginTop: 0 }}>
          定好每张图的五个英雄和四条滑杆，赛前不用再调。同一套阵容打得越多越熟，熟练度进比赛是加分。
        </p>
        <MapPlan maps={pool} mode="plan" />
      </Panel>

      <ScoutPanel />

      <div className="grid c2">
        <Panel title="通用战术 · 没单独设置的图用这个">
          <TacticSliders game={game} commit={commit} />
        </Panel>

        <Panel title="当前阵容评估">
          <div className="grid c2" style={{ gap: 10, marginBottom: 14 }}>
            <div>
              <div className="small muted">进攻端强度</div>
              <div className="row" style={{ gap: 8 }}>
                <Bar value={preview.atk} max={110} />
                <span className="mono small">{preview.atk.toFixed(1)}</span>
              </div>
            </div>
            <div>
              <div className="small muted">防守端强度</div>
              <div className="row" style={{ gap: 8 }}>
                <Bar value={preview.def} max={110} />
                <span className="mono small">{preview.def.toFixed(1)}</span>
              </div>
            </div>
            <div>
              <div className="small muted">团队默契</div>
              <div className="row" style={{ gap: 8 }}>
                <Bar value={preview.chem} />
                <span className="mono small">{preview.chem.toFixed(0)}</span>
              </div>
            </div>
            <div>
              <div className="small muted">中局应变</div>
              <div className="row" style={{ gap: 8 }}>
                {/* a swing modifier, not a 0-100 rating — show it as the ± it is */}
                <Bar value={preview.midRound + 6} max={12} />
                <span className="mono small">
                  {preview.midRound >= 0 ? '+' : ''}{preview.midRound.toFixed(1)}
                </span>
              </div>
            </div>
          </div>

          <div className="small muted" style={{ marginBottom: 6 }}>出场阵容</div>
          <div className="row wrap" style={{ gap: 8 }}>
            {lineup.map((p) => (
              <span key={p.id} className="row" style={{ gap: 5 }}>
                <RoleTag role={p.role} />
                <Face id={p.id} size={18} />
                <span className="small">{p.ign}</span>
              </span>
            ))}
          </div>
          {!lineup.some((p) => p.isIgl) && (
            <p className="small neg">⚠ 首发里没有任命队长，运营最高的人自动顶上。</p>
          )}
          <p className="tiny faint" style={{ marginBottom: 0 }}>以 {mapCn(pool[0])} 的预案计算。</p>
        </Panel>
      </div>

      <Panel title="图池一览 · 熟练度" flush>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>场地</th><th>阵容</th><th style={{ width: '32%' }}>战术磨合度</th>
                <th className="num">数值</th><th style={{ width: '22%' }}>阵容熟练度</th><th>状态</th>
              </tr>
            </thead>
            <tbody>
              {MAPS.filter((m) => pool.includes(m) || mapReleased(game, m)).map((m) => {
                const v = Math.round(me.mapPrefs[m] ?? 50)
                const inPool = pool.includes(m)
                const sheet = sheetFor(game, game.myTeam, m)
                const fam = Math.round(familiarity(game, game.myTeam, m, sheet.agents))
                return (
                  <tr key={m} style={inPool ? undefined : { opacity: 0.42 }}>
                    <td><b>{mapCn(m)}</b> <span className="tiny faint">{m}</span></td>
                    <td><StyleTag style={sheet.style} /></td>
                    <td><Bar value={v} /></td>
                    <td className="num mono">{v}</td>
                    <td>
                      <div className="row" style={{ gap: 6 }}>
                        <Bar value={fam} color={fam >= 50 ? 'var(--win)' : 'var(--accent)'} />
                        <span className="mono small">{fam}</span>
                      </div>
                    </td>
                    <td className="small muted">{inPool ? '现役图池' : '轮换出池'}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        <p className="tiny muted" style={{ padding: '10px 14px', margin: 0 }}>
          BP 会 ban 对手熟练的图、留自己擅长的。阵容熟练度看这张图预案的五个英雄，50 是中立。
        </p>
      </Panel>
    </>
  )
}

/**
 * 对手针对: how closely the league is watching, and how much of the way we play
 * it has already read. See engine/scouting.ts for the numbers.
 */
function ScoutPanel() {
  const { game } = useGame()
  const heat = Math.round(game.scout?.heat ?? 0)
  const map = poolFor(game)[0]
  const nem = game.nemesis && game.nemesis.year === game.year ? game.teams[game.nemesis.teamId] : undefined
  const max = spec(game).prepMax
  const sheet = sheetFor(game, game.myTeam, map)
  const r = readOf(game, map, sheet.agents, tacticsFor(game, game.myTeam, map))
  const prep = max * (heat / 100) * (PREP_FLOOR + (1 - PREP_FLOOR) * r.read)
  const seen = game.scout?.reads[map]
  return (
    <Panel
      title="对手针对"
      actions={<span className="tiny faint">难度：{DIFFICULTY[difficultyOf(game)].label}</span>}
    >
      <div className="row" style={{ gap: 10, alignItems: 'center' }}>
        <span className="small muted" style={{ whiteSpace: 'nowrap' }}>针对度</span>
        <Bar value={heat} color={heat >= 75 ? 'var(--accent)' : heat >= 45 ? 'var(--warn)' : 'var(--win)'} />
        <span className="mono small">{heat}</span>
        <b className="small" style={{ whiteSpace: 'nowrap' }}>{heatLabel(heat)}</b>
      </div>
      {nem && (
        <p className="small" style={{ margin: '8px 0 0' }}>
          ⚔️ 宿敌 <b>{nem.name}</b>：对我们的准备多四成，转会窗口每周都在买人。
        </p>
      )}
      {heat > 0 && (
        <div className="row wrap" style={{ gap: 6, marginTop: 10 }}>
          <span className={`chip small${r.read >= 0.6 ? ' neg' : ''}`} title="按预案这套阵容的打法和现在的滑杆算">
            被摸透 <b className="mono">{Math.round(r.read * 100)}%</b>
          </span>
          {seen && (
            <span className="chip small muted">
              他们看过的：{COMP_STYLE_CN[seen.key]?.label ?? seen.key} 连续 {Math.min(seen.nSheet, READ_FULL)} 局
            </span>
          )}
          <span className="chip small">对手额外备战 <b className="mono">+{prep.toFixed(1)}</b></span>
        </div>
      )}
      <p className="tiny muted" style={{ margin: '10px 0 0' }}>
        赢得越多，对手越研究你。他们研究的是你的<b>打法</b>（这局最后拿到的英雄合起来是前期、团战、运营还是均衡）和<b>四条滑杆</b>：
        同一种打法连打 {READ_FULL} 局就被摸透；换一种打法，或把一条滑杆拨动 10 以上，他们的准备就白做一部分。
        赢一个系列赛针对度 +3，输一个 −8，拿冠军涨得更多。训练赛不算。
      </p>
    </Panel>
  )
}
