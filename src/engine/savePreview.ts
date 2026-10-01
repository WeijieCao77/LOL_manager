import { savePrefix } from './saveKeys'
import { decodeSave } from './saveCodec'
import { assertCareerSave } from './saveShape'
import { HOME_CLUBS } from './homeClubs'

export interface CareerPreview { club: string | null; clubId: string; year: number; over: boolean }

/** Read the resume label only. Loading/migrating the actual career happens on entry. */
export function readCareerPreview(): CareerPreview | null {
  try {
    const raw = localStorage.getItem(`${savePrefix()}autosave`)
    if (!raw) return null
    let s: unknown = JSON.parse(decodeSave(raw))
    assertCareerSave(s)
    // A trial day resumes from its parked career just as loadGame does, but
    // reading a home-page label must never consume that recovery snapshot.
    if (s.tutorialDay) {
      const parked = localStorage.getItem('valmgr.tutorial.snapshot')
      if (parked) {
        try { const saved: unknown = JSON.parse(decodeSave(parked)); assertCareerSave(saved); s = saved } catch { /* show current career */ }
      }
    }
    assertCareerSave(s)
    // a career started in the past numbers its clubs on its own: T12 is not the 2026 T12,
    // so its name comes from the save and it has no 2026 crest to borrow
    const past = (s.startYear ?? 2026) < 2026
    return { club: s.teams[s.myTeam]?.name ?? (past ? null : HOME_CLUBS[s.myTeam]?.name ?? null),
      clubId: past ? '' : s.myTeam, year: s.year, over: !!s.gameOver }
  } catch { return null }
}
