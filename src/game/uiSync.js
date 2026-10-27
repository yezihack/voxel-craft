/* 每帧把引擎里的数值同步进响应式 ui。
 * 原来这些是 renderVitals() / syncHurt() / `$('stat').textContent = ...`，
 * 直接改 DOM；现在只写 ui 上的字段，由 Vue 去渲染。
 * 刷新频率沿用原版：生存数值每 6 帧一次。
 *
 * 左上角那两行状态 / 帮助文字已经整块移除（玩家反馈遮挡视野），
 * 所以这里不再有 syncHud —— 生命 / 饥饿 / 氧气仍由 Vitals 用心形与鸡腿表达，
 * 这些是图形而不是文字，不占视野。 */
import { player } from './player.js'
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
