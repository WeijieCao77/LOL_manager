import type { RoundLog } from '../engine/types'

/**
 * The game as a timeline: the gold lead as a curve, and under it what each
 * beat was fought over and who took it.
 *
 * A scoreline says who won; this says how — a lead built in lane and held, a
 * Baron taken from behind, a fight at thirty minutes that ended it. My club is
 * above the line and theirs below, so a comeback is a curve that crosses it.
 *
 * Every mark is drawn here from plain shapes. Nothing is Riot's artwork: the
 * game's icons, map and champion images are not used anywhere in this project.
 */

const EVENT_CN: Record<RoundLog['event'], string> = {
  lane: '对线', gank: '抓人', dragon: '小龙', herald: '先锋', tower: '防御塔',
  fight: '团战', pick: '抓单', baron: '大龙', nexus: '终结',
}

export default function RoundRibbon({
  rounds, mineIsA, compact, mineTag, theirTag,
}: {
  rounds: RoundLog[]; mineIsA: boolean; compact?: boolean
  /** short club names, drawn against their own half */
  mineTag?: string; theirTag?: string
}) {
  if (!rounds.length) return null

  const w = compact ? 9 : 22
  const gap = compact ? 1 : 2
  const curveH = compact ? 22 : 56
  const markH = compact ? 0 : 22
  const labelW = compact || !mineTag ? 0 : 54
  const width = rounds.length * (w + gap) + labelW
  const height = curveH + markH + (compact ? 0 : 14)

  // my lead, whatever side of the data I am on
  const lead = (r: RoundLog) => (mineIsA ? r.gold : -r.gold)
  const peak = Math.max(3000, ...rounds.map((r) => Math.abs(lead(r))))
  const mid = curveH / 2
  const xOf = (i: number) => labelW + i * (w + gap) + w / 2
  const yOf = (g: number) => mid - (g / peak) * (mid - 2)
  const pts = [`${labelW},${mid}`, ...rounds.map((r, i) => `${xOf(i)},${yOf(lead(r))}`)]
  const area = `${labelW},${mid} ${pts.slice(1).join(' ')} ${xOf(rounds.length - 1)},${mid}`

  return (
    <div style={{ overflowX: 'auto' }}>
      <svg
        width={width} height={height} role="img"
        aria-label={`比赛走势：共 ${rounds.length} 个节点，${Math.round(rounds[rounds.length - 1].minute)} 分钟`}
        style={{ display: 'block' }}
      >
        {!compact && mineTag && (
          <>
            <text x={0} y={mid - 8} fontSize={10} fill="var(--win)" fontWeight={700}>{mineTag}</text>
            <text x={0} y={mid + 16} fontSize={10} fill="var(--loss)" fontWeight={700}>{theirTag}</text>
          </>
        )}
        {/* the lead: above the line is mine */}
        <clipPath id="rr-up"><rect x={labelW} y={0} width={width} height={mid} /></clipPath>
        <clipPath id="rr-down"><rect x={labelW} y={mid} width={width} height={mid} /></clipPath>
        <polygon points={area} fill="var(--win)" opacity={0.28} clipPath="url(#rr-up)" />
        <polygon points={area} fill="var(--loss)" opacity={0.28} clipPath="url(#rr-down)" />
        <line x1={labelW} x2={width} y1={mid} y2={mid} stroke="var(--line)" strokeWidth={1} />
        <polyline points={pts.join(' ')} fill="none" stroke="var(--text)" strokeWidth={compact ? 1 : 1.5} opacity={0.85} />

        {!compact && rounds.map((r, i) => {
          const mineWon = (r.winner === 'A') === mineIsA
          const x = labelW + i * (w + gap)
          return (
            <g key={r.n}>
              <title>{`${Math.floor(r.minute)} 分钟 · ${EVENT_CN[r.event]} · ${mineWon ? '我方拿下' : '对方拿下'} · 经济差 ${lead(r) >= 0 ? '+' : ''}${(lead(r) / 1000).toFixed(1)}k · 击杀 ${mineIsA ? r.killsA : r.killsB}:${mineIsA ? r.killsB : r.killsA}`}</title>
              <rect
                x={x} y={curveH + 3} width={w} height={markH - 4} rx={2}
                fill={mineWon ? 'var(--win)' : 'var(--loss)'} opacity={r.event === 'nexus' ? 1 : 0.8}
              />
              <EventMark event={r.event} x={x + w / 2} y={curveH + 3 + (markH - 4) / 2} />
              {(i === 0 || Math.floor(r.minute / 10) > Math.floor(rounds[i - 1].minute / 10)) && (
                <text x={x + w / 2} y={height - 2} fontSize={9} textAnchor="middle" fill="var(--faint)">
                  {Math.floor(r.minute)}′
                </text>
              )}
            </g>
          )
        })}
      </svg>
    </div>
  )
}

/** What a beat was fought over, as a plain shape: nothing here is game artwork. */
function EventMark({ event, x, y }: { event: RoundLog['event']; x: number; y: number }) {
  const ink = 'rgba(8,12,18,.9)'
  switch (event) {
    case 'dragon': // a diamond
      return <polygon points={`${x},${y - 5} ${x + 5},${y} ${x},${y + 5} ${x - 5},${y}`} fill={ink} />
    case 'baron': // a crown
      return <polygon points={`${x - 6},${y + 4} ${x - 6},${y - 3} ${x - 3},${y} ${x},${y - 5} ${x + 3},${y} ${x + 6},${y - 3} ${x + 6},${y + 4}`} fill={ink} />
    case 'herald': // a ring
      return <circle cx={x} cy={y} r={4} fill="none" stroke={ink} strokeWidth={2} />
    case 'tower': // a tower
      return <path d={`M${x - 3},${y + 5} L${x - 3},${y - 2} L${x - 5},${y - 2} L${x - 5},${y - 5} L${x + 5},${y - 5} L${x + 5},${y - 2} L${x + 3},${y - 2} L${x + 3},${y + 5} Z`} fill={ink} />
    case 'fight': // crossed blades
      return (
        <g stroke={ink} strokeWidth={2} strokeLinecap="round">
          <line x1={x - 4} y1={y - 4} x2={x + 4} y2={y + 4} />
          <line x1={x + 4} y1={y - 4} x2={x - 4} y2={y + 4} />
        </g>
      )
    case 'nexus': // a star
      return <polygon points={`${x},${y - 6} ${x + 2},${y - 2} ${x + 6},${y - 2} ${x + 3},${y + 1} ${x + 4},${y + 6} ${x},${y + 3} ${x - 4},${y + 6} ${x - 3},${y + 1} ${x - 6},${y - 2} ${x - 2},${y - 2}`} fill={ink} />
    case 'gank':
    case 'pick': // an arrow
      return <polygon points={`${x - 5},${y - 3} ${x + 1},${y - 3} ${x + 1},${y - 6} ${x + 6},${y} ${x + 1},${y + 6} ${x + 1},${y + 3} ${x - 5},${y + 3}`} fill={ink} />
    default: // lane: a dot
      return <circle cx={x} cy={y} r={2.5} fill={ink} />
  }
}

/** The key to the marks, for the full-size timeline. */
export function RibbonLegend() {
  const items: RoundLog['event'][] = ['lane', 'gank', 'dragon', 'herald', 'tower', 'fight', 'baron', 'nexus']
  return (
    <div className="row wrap tiny faint" style={{ gap: 10, marginTop: 6 }}>
      <span>曲线在横线上方：我方经济领先</span>
      {items.map((e) => (
        <span key={e} className="row" style={{ gap: 4, alignItems: 'center' }}>
          <svg width={14} height={14} aria-hidden="true">
            <rect x={0} y={0} width={14} height={14} rx={2} fill="var(--muted)" opacity={0.5} />
            <EventMark event={e} x={7} y={7} />
          </svg>
          {EVENT_CN[e]}
        </span>
      ))}
    </div>
  )
}
