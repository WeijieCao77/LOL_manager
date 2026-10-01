/**
 * How a save is stored: deflated, fifteen bits to a character.
 *
 * localStorage is counted in UTF-16 code units — 5MB on iOS Safari is 2.5
 * million characters for everything the site keeps — and a League save is big:
 * 885 people, 173 champions to be graded on, a season of scoreboards, and a
 * historical career's whole world. Plain JSON peaked at 2.1 million characters,
 * so one autosave and one manual save no longer fitted (现状对比 step 6).
 *
 * Deflate takes that JSON to about a sixth of its bytes, and fifteen bits of
 * deflate go into each character (U+4000–U+BFFF: no surrogates, no control
 * characters, nothing a storage engine has to escape), so a stored save is
 * about a tenth of the characters it was — measured 2,042 KB → 197 KB at the
 * level used here, in ~80 ms to write and ~40 ms to read.
 *
 * A stored string starts with its marker and the byte length; anything else is
 * read as the plain JSON every save before this was, so old saves, dev saves
 * and the tutorial's parked copy all still load.
 */
import { deflateSync, inflateSync, strFromU8, strToU8 } from 'fflate'

const MARK = 'LZD1:'
const BASE = 0x4000

export const isEncodedSave = (raw: string): boolean => raw.startsWith(MARK)

/** JSON text → the stored string */
export function encodeSave(json: string): string {
  const bytes = deflateSync(strToU8(json), { level: 3 })
  const out: string[] = []
  let acc = 0, bits = 0
  let chunk: number[] = []
  for (let i = 0; i < bytes.length; i++) {
    acc = (acc << 8) | bytes[i]
    bits += 8
    if (bits >= 15) {
      bits -= 15
      chunk.push(BASE + ((acc >>> bits) & 0x7fff))
      acc &= (1 << bits) - 1
      if (chunk.length >= 8192) { out.push(String.fromCharCode(...chunk)); chunk = [] }
    }
  }
  if (bits > 0) chunk.push(BASE + ((acc << (15 - bits)) & 0x7fff))
  out.push(String.fromCharCode(...chunk))
  return `${MARK}${bytes.length}:${out.join('')}`
}

/** the stored string (either shape) → JSON text */
export function decodeSave(raw: string): string {
  if (!raw.startsWith(MARK)) return raw
  const colon = raw.indexOf(':', MARK.length)
  const n = Number(raw.slice(MARK.length, colon))
  if (!Number.isInteger(n) || n <= 0) throw new Error('存档已损坏：长度不对。')
  const bytes = new Uint8Array(n)
  let acc = 0, bits = 0, k = 0
  for (let i = colon + 1; i < raw.length && k < n; i++) {
    acc = (acc << 15) | ((raw.charCodeAt(i) - BASE) & 0x7fff)
    bits += 15
    while (bits >= 8 && k < n) {
      bits -= 8
      bytes[k++] = (acc >>> bits) & 0xff
    }
    acc &= (1 << bits) - 1
  }
  if (k !== n) throw new Error('存档已损坏：数据不完整。')
  return strFromU8(inflateSync(bytes))
}
