/* AI 玩家头顶名字标签。
 *
 * 复用 DOM 而不是画进 GL：文字要缩放不糊、要有圆角和描边，GL 里得再写一套
 * 位图字体，成本不对等。做法是每帧把世界坐标用 **viewProj** 投影到屏幕。
 *
 * ⚠ 用 vp（proj × view）而不是 proj、view 分开乘：M4.mul(a,b) 的约定是
 * 「先 b 后 a」，写成 M4.mul(view, proj) 会得到把投影当世界矩阵的结果，
 * 表现为所有标签全跑到屏幕外或者全部堆在角落 —— 投影顺序错了不会有报错。
 *
 * 分工（性能取舍）：
 *   · 语义部分（有谁、叫什么、血量、说话内容）→ 写进响应式的 ui.tags，交给 Vue 渲染；
 *   · 纯视觉的投影坐标（每帧都变、且最多十来个）→ 写进非响应式的 tagPos，
 *     由 NameTags.vue 直接改 CSS 变量，不走 diff。 */
import { bots } from './bots.js'
import { applyTagPos, tagPos, ui } from './uiState.js'

const TAG_MAX_DIST = 46            // 超过这个距离不画标签

export function updateNameTags(vp, eye, vw, vh) {
  /* 画布是 devicePixelRatio 缩放过的，投影出来的坐标在「画布像素」里，
   * 而标签是普通 DOM（CSS 像素）。两者差一个 scale —— 忘了除，
   * 标签会整体偏到视口右下角（Retina 上偏得更狠）。 */
  const sx = window.innerWidth / vw, sy = window.innerHeight / vh
  const live = []
  tagPos.length = 0

  for (const b of bots) {
    const dx = b.x - eye.x, dz = b.z - eye.z
    const dist2 = dx * dx + dz * dz
    if (dist2 > TAG_MAX_DIST * TAG_MAX_DIST) continue
    /* 视锥剔除：用 x/y 三个分量的符号判「在相机后面」，比算完整裁剪便宜 */
    const X = vp[0] * b.x + vp[4] * (b.y + 2.15) + vp[8] * b.z + vp[12]
    const Y = vp[1] * b.x + vp[5] * (b.y + 2.15) + vp[9] * b.z + vp[13]
    const Wc = vp[3] * b.x + vp[7] * (b.y + 2.15) + vp[11] * b.z + vp[15]
    if (Wc <= 0.05) continue                                  // 在相机背后 / 太贴脸
    const ndcX = X / Wc, ndcY = Y / Wc
    if (ndcX < -1.25 || ndcX > 1.25 || ndcY < -1.25 || ndcY > 1.25) continue

    const dist = Math.max(2, Math.sqrt(dist2))
    const scale = Math.max(0.62, Math.min(1.12, 16 / dist))
    tagPos.push({
      id: b.id,
      tx: ((ndcX * 0.5 + 0.5) * vw * sx).toFixed(1),
      ty: ((-ndcY * 0.5 + 0.5) * vh * sy).toFixed(1),
      sc: scale.toFixed(3),
      /* 越远越淡，避免八个人在 40 格外糊成一堵字墙 */
      op: Math.max(0.15, Math.min(1, 1.35 - dist / 34)).toFixed(2),
    })
    live.push({
      id: b.id,
      name: b.name,
      hpPct: Math.max(0, Math.min(100, b.hp / b.maxHp * 100)),
      speak: b.speak > 0 ? (b.speakMsg || '') : '',
    })
  }

  /* 语义部分：能原地改就原地改（避免每帧换数组触发 v-for 重建），
   * 只有「谁在场」变了才整体替换。 */
  if (ui.tags.length !== live.length || live.some((t, i) => ui.tags[i].id !== t.id)) {
    ui.tags = live
  } else {
    for (let i = 0; i < live.length; i++) {
      const cur = ui.tags[i], next = live[i]
      if (cur.name !== next.name) cur.name = next.name
      if (cur.hpPct !== next.hpPct) cur.hpPct = next.hpPct
      if (cur.speak !== next.speak) cur.speak = next.speak
    }
  }
  applyTagPos()
}
