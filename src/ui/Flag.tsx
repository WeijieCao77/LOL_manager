import { useState } from 'react'
import { FLAG_AS, natName } from '../engine/nat'

/**
 * Whether this browser draws flag emoji at all.
 *
 * Windows Chrome does not — it renders a regional-indicator pair as two letter
 * boxes, so anything that leans on the emoji shows a grey rectangle where the
 * nationality should be, and a large part of this game's audience is on
 * Windows. Measured once: a supported flag is drawn as one glyph and is
 * narrower than the two letters side by side.
 */
const flagsRender = (() => {
  try {
    const c = document.createElement('canvas').getContext('2d')
    if (!c) return false
    c.font = '32px sans-serif'
    const pair = c.measureText('\u{1F1E8}\u{1F1F3}').width
    const single = c.measureText('\u{1F1E8}').width
    return pair < single * 1.9
  } catch { return false }
})()

/**
 * The nationality mark: a real flag where the platform has one, the country
 * code where it does not. Never a blank box — an empty flag slot looks broken,
 * and the code is a perfectly good answer.
 */
export function flagEmoji(nat: string | null | undefined): string {
  if (!nat || nat.length !== 2) return '🏴'
  const up = (FLAG_AS[nat.toLowerCase()] ?? nat).toUpperCase()
  if (!flagsRender) return up
  const base = 0x1f1e6
  const a = up.charCodeAt(0) - 65
  const b = up.charCodeAt(1) - 65
  if (a < 0 || a > 25 || b < 0 || b > 25) return up
  return String.fromCodePoint(base + a, base + b)
}

export { natName }

/** The flag beside a name. A code renders as a chip so it does not read as a typo. */
export function Flag({ nat }: { nat: string | null | undefined }) {
  return (
    <span className={flagsRender ? 'cf-flag' : 'cf-flag code'} title={natName(nat)}>
      {flagEmoji(nat)}
    </span>
  )
}

/**
 * The stand-in when there is no photograph. Initials read as a placeholder
 * for a name rather than for a person; a plain bust is what the eye skips
 * over. Drawn rather than loaded so it costs nothing and inherits the colour
 * around it.
 */
function Silhouette() {
  return (
    <svg className="cf-sil" viewBox="0 0 64 64" aria-hidden="true" focusable="false">
      <circle cx="32" cy="23" r="11.5" />
      <path d="M32 37c-11 0-19.5 6.6-21.6 16.4A2 2 0 0 0 12.4 56h39.2a2 2 0 0 0 2-2.6C51.5 43.6 43 37 32 37Z" />
    </svg>
  )
}

/** The photograph, with the silhouette behind it for the people no source has a picture of. */
export function Face({ src, alt }: { src: string | null; alt: string }) {
  const [failed, setFailed] = useState(false)
  if (src && !failed) {
    return (
      <img
        className="cf-photo"
        src={src}
        alt={alt}
        loading="lazy"
        decoding="async"
        onError={() => setFailed(true)}
      />
    )
  }
  return <div className="cf-photo cf-noface"><Silhouette /></div>
}
