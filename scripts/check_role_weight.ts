/**
 * The two copies of the position weights must be the same table.
 *
 *   npx tsx scripts/check_role_weight.ts
 *
 * Every player's opening rating is computed in Python (scripts/lol/build_world.py
 * ROLE_WEIGHT) and recomputed in TypeScript (engine/player.ts ROLE_WEIGHT) the
 * first time anything touches him — training, ageing. If the tables differ,
 * that first recompute quietly re-rates the whole world. It has happened to
 * this engine before: 94 of 515 players moved three points or more.
 *
 * build_world writes its table into world.json (meta.roleWeight), so this can
 * hold the two against each other, and then hold every player's stored rating
 * against what the engine makes of his attributes.
 */
import { readFileSync } from 'node:fs'
import { ROLE_WEIGHT } from '../src/engine/player'
import { ATTR_KEYS, ROLES } from '../src/engine/types'
import type { Attrs, Role } from '../src/engine/types'

const world = JSON.parse(readFileSync(new URL('../src/data/world.json', import.meta.url), 'utf8'))
const py = world.meta.roleWeight as Record<Role, Record<keyof Attrs, number>>
let bad = 0
const fail = (msg: string) => { bad++; console.log('FAIL', msg) }

for (const role of ROLES) {
  if (!py[role]) { fail(`管线里没有「${role}」的权重`); continue }
  let sum = 0
  for (const k of ATTR_KEYS) {
    const a = ROLE_WEIGHT[role][k], b = py[role][k]
    sum += a
    if (Math.abs(a - b) > 1e-9) fail(`${role}.${k}: 引擎 ${a} ≠ 管线 ${b}`)
  }
  if (Math.abs(sum - 1) > 1e-9) fail(`${role} 的权重加起来是 ${sum.toFixed(3)}，不是 1`)
}
console.log(bad ? '' : 'ok   五个位置 × 八项，两边逐项相同，每个位置加起来是 1')

let moved = 0, worst = 0
for (const p of world.players as { ign: string; role: Role; attrs: Attrs; overall: number }[]) {
  const v = Math.round(Math.min(99, Math.max(30, ATTR_KEYS.reduce((s, k) => s + p.attrs[k] * ROLE_WEIGHT[p.role][k], 0))))
  const d = Math.abs(v - p.overall)
  if (d >= 1) moved++
  worst = Math.max(worst, d)
}
// rounding of the eight attributes before and after the weighted sum can differ by one
if (worst > 1) fail(`有选手的总评在引擎里重算后差了 ${worst} 分`)
else console.log(`ok   ${world.players.length} 名选手：引擎重算的总评与世界文件里的一致（差 1 分的 ${moved} 人，来自取整）`)

console.log(bad ? `\n❌ ${bad} 项不通过` : '\n✅ 位置权重两边一致')
process.exit(bad ? 1 : 0)
