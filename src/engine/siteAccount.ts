/**
 * The site account: an id the server knows, under which endings and
 * achievements are kept across devices (engine/profile.ts).
 *
 * In VAL MANAGER this was the card mode's account — minting one built a whole
 * card collection, and this file's two calls lived in a module that imported
 * the entire card game. This game has no card mode, so what is left is the
 * part the career ever used: make an id, or check that a typed one exists.
 *
 * The id is the entire password, which is why it is 100 bits and why the
 * screens mask it (cardid.ts `maskId`).
 */
import { rememberId } from './cardid'

const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'

export function newId(): string {
  const bytes = new Uint8Array(20)
  crypto.getRandomValues(bytes)
  const body = Array.from(bytes, (b) => ALPHABET[b % 32]).join('')
  return `VM-${body.slice(0, 4)}-${body.slice(4, 8)}-${body.slice(8, 12)}-${body.slice(12, 16)}-${body.slice(16, 20)}`
}

/**
 * Read back whatever the player pasted.
 *
 * Mirrors the server exactly. The four letters the alphabet leaves out are
 * the four people mistype, so O becomes 0 and I becomes 1 rather than being
 * rejected — someone typing an id off a photograph should not be told it is
 * wrong when it is only ambiguous.
 */
export function normalizeId(raw: string): string | null {
  const s = raw.toUpperCase().replace(/[^0-9A-Z]/g, '')
    .replace(/O/g, '0').replace(/I/g, '1').replace(/L/g, '1').replace(/U/g, 'V')
  const body = s.startsWith('VM') ? s.slice(2) : s
  if (body.length !== 20) return null
  if ([...body].some((c) => !ALPHABET.includes(c))) return null
  return `VM-${body.slice(0, 4)}-${body.slice(4, 8)}-${body.slice(8, 12)}-${body.slice(12, 16)}-${body.slice(16, 20)}`
}

// guarded the way dossier.ts is, so a check script can import this file
const BASE = typeof import.meta.env !== 'undefined' ? import.meta.env.BASE_URL : '/'
const api = (path: string) => `${BASE}api/card/${path}`.replace(/([^:])\/\//g, '$1/')

export type CreateResult = { ok: true; id: string } | { ok: false; why: string }
export type LoadResult = { ok: true; id: string } | { ok: false; reason: 'bad' | 'missing' | 'offline' }

export async function createAccount(name: string): Promise<CreateResult> {
  const clean = name.trim().slice(0, 20) || '经理'
  for (let attempt = 0; attempt < 3; attempt++) {
    const id = newId()
    try {
      const r = await fetch(api('claim'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, name: clean }),
      })
      const j = await r.json()
      // 100 bits does not collide; the retry is here so that if it ever did,
      // the newcomer gets a fresh id instead of a stranger's account
      if (j?.taken) continue
      if (!j?.ok) {
        return { ok: false, why: j?.offline ? '服务器暂时不可用，建不了账号。' : '服务器没接受，等会儿再试。' }
      }
      rememberId(id)
      return { ok: true, id }
    } catch {
      return { ok: false, why: '连不上服务器，建账号需要联网。' }
    }
  }
  return { ok: false, why: '生成账号失败，再试一次。' }
}

export async function loadAccount(rawId: string): Promise<LoadResult> {
  const id = normalizeId(rawId)
  if (!id) return { ok: false, reason: 'bad' }
  try {
    const r = await fetch(api('load'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    })
    const j = await r.json()
    if (j?.ok) return { ok: true, id }
    if (j?.missing) return { ok: false, reason: 'missing' }
  } catch { /* fall through */ }
  return { ok: false, reason: 'offline' }
}
