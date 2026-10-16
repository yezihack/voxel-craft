/* 每帧把引擎里的数值同步进响应式 ui。
 * 原来这些是 renderVitals() / syncHurt() / `$('stat').textContent = ...`，
 * 直接改 DOM；现在只写 ui 上的字段，由 Vue 去渲染。
 * 刷新频率沿用原版：生存数值每 6 帧一次，状态行每 12 帧一次。 */
import { bots } from './bots.js'
import { DIMS } from './dims.js'
import { MOB_TYPES } from './mobs.js'
import { player } from './player.js'
import { MODE, dim, mode, spectate } from './state.js'
import { ui } from './uiState.js'

export function syncVitals() {
  const p = player
  ui.hp = p.hp; ui.maxHp = p.maxHp
  ui.food = p.food; ui.maxFood = p.maxFood
  ui.air = p.air; ui.maxAir = p.maxAir
  ui.airVisible = p.air < p.maxAir - 0.01
}

export function syncHurt() {
  ui.hurt = player.hurtFlash > 0
}

export function syncHud(fps, drawn, total, tris) {
  const bits = [
    `${DIMS[dim].icon} ${DIMS[dim].name}`,
    `${fps} FPS`,
    `区块 ${drawn}/${total}`,
    `三角面 ${(tris / 1000).toFixed(1)}k`,
    `坐标 ${player.x.toFixed(1)}, ${player.y.toFixed(1)}, ${player.z.toFixed(1)}`,
  ]
  if (mode === MODE.SURVIVAL) bits.push(`❤ ${player.hp}/${player.maxHp}`, `🍖 ${player.food}/${player.maxFood}`)
  if (mode === MODE.SPECTATOR) bits.push(spectate ? `👁 附身 ${MOB_TYPES[spectate.type].name}` : '👁 旁观中')
  if (player.inLava) bits.push('岩浆中')
  else if (player.inWater) bits.push('水中')
  if (player.fly) bits.push('飞行')
  if (bots.length) bits.push(`👥 ${bots.length}`)
  ui.stat = bits.join(' · ')
}
