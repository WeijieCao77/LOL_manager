/**
 * Whose photo and whose crest, in a career started in the past.
 *
 * The photos and crests (dossier.json, public/faces, public/logos) are filed
 * under the 2026 world's ids. A historical world numbers its people and clubs
 * on its own — P1 is Flandre in 2026 and Mouse in 2016 — so looking a 2016
 * player up by id would put somebody else's face on him, the worst mistake a
 * game of real people can make.
 *
 * So a historical career looks its people up by who they are: the person key
 * (`ign|position`, the same key history.json uses) and Oracle's Elixir's club
 * name, which is the organisation's name across renames. A man who is not in
 * the 2026 world, or whose real name disagrees with the 2026 man's, has no
 * photo rather than a wrong one.
 */
import { setDossierAlias } from './dossier'
import { WORLD_PLAYERS } from './world'
import { WORLD_TEAMS } from './teams'
import { startYearOf } from './eras'
import type { GameState } from './types'

export function bindCareerAssets(state: GameState): void {
  if (startYearOf(state) >= 2026) { setDossierAlias(null); return }
  const byKey = new Map<string, { id: string; real?: string | null }>()
  for (const w of WORLD_PLAYERS as unknown as { id: string; hkey?: string; realName?: string | null }[]) {
    if (w.hkey) byKey.set(w.hkey, { id: w.id, real: w.realName })
  }
  const byOe = new Map<string, string>()
  for (const t of WORLD_TEAMS as unknown as { id: string; oeName?: string }[]) if (t.oeName) byOe.set(t.oeName, t.id)
  // read off the live career, so a real newcomer who arrives in a later year has his photo too
  setDossierAlias({
    player: (id) => {
      const p = state.players[id]
      const hit = p?.hkey ? byKey.get(p.hkey) : undefined
      return hit && (!hit.real || !p!.realName || hit.real === p!.realName) ? hit.id : null
    },
    team: (id) => {
      const oe = state.teams[id]?.oeName
      return (oe && byOe.get(oe)) || null
    },
  })
}
