/* 运输装置：传送带 / 传送板 / 传送珠 —— 新增（2026-10-20） */

import { toast } from './uiState.js'
import { blip, noiseBurst } from './audio.js'
import { spawnParticles } from './actions.js'
import { BOT_H, BOT_W, bots } from './bots.js'
import { DIM_N, H, I } from './config.js'
import { EKEY, getEffective, isSolid } from './generate.js'
import { MOB_TYPES, mobs } from './mobs.js'
import { moveAxis, moveBodyAxis, player, raycast } from './player.js'
import { dim, rideCart } from './state.js'

/* ============================== 运输装置 ==============================
 * 三件套，各自解决「怎么把东西从 A 弄到 B」的一半：
 *   传送带  连续、短距、沿地面 —— 走的是**位置**而不是速度
 *   传送板  离散、长距、点对点 —— 两块板配对，踩上去互传
 *   传送珠  离散、短距、随手打 —— 右键瞬移到准星落点
 *
 * 共同的一条设计线：**方块 id 不带状态**，所以凡是需要方向 / 配对的，
 * 都在本模块里另建一张按维度分表的 Map（与 dimEdits 同构）。
 * 为什么不把方向编码进 id（比如「朝东的传送带」单独一个 id）：
 *   4 个方向 × 每种方块 = 方块表爆炸，而贴图集和物品栏是按方块枚举的，
 *   创造模式的方块库会瞬间多出几十个看不出差别的条目。 */

/* ---------------- 每张表都按维度分开 ----------------
 * 和 edits 覆盖层同一个道理：主世界铺的传送带不能「借」给异界的同一个坐标。
 * 切维度时 switchDim 只换 edits，这两张表按 dim 索引，天然跟着换。 */
const beltDirs = [];
const pads = [];
for (let i = 0; i < DIM_N; i++) { beltDirs.push(new Map()); pads.push(new Map()); }

/* ---------------- 传送带 ---------------- */
export const BELT_SPEED = 3.6;               // 格/秒，比走路（4.9）慢一点，推着走很明显

/* 放置时记下朝向。dir 取**轴向**（±x / ±z 四种），不存任意角度 ——
 * 传送带是方格世界里的东西，斜着推会让人卡在两个方块的接缝上。 */
export function setBeltDir(x, y, z, dir) {
  beltDirs[dim].set(EKEY(x | 0, y | 0, z | 0), dir);
}
export function beltDirAt(x, y, z) {
  return beltDirs[dim].get(EKEY(x | 0, y | 0, z | 0)) || null;
}
export function clearBelt(x, y, z) { beltDirs[dim].delete(EKEY(x | 0, y | 0, z | 0)); }

/* 从玩家朝向推出一个轴向：yaw=0 面向 -z（见 updatePhysics 的 wish 向量） */
export function axisFromYaw(yaw) {
  const dx = -Math.sin(yaw), dz = -Math.cos(yaw);
  return Math.abs(dx) >= Math.abs(dz) ? [Math.sign(dx) || 1, 0] : [0, Math.sign(dz) || 1];
}

/* 站在传送带上就把人/怪/AI 玩家往前推一格不到。
 *
 * ⚠ 用**位移**（moveBodyAxis）而不是给速度：主循环的 updatePhysics 每帧都会把
 * 玩家速度朝「按键目标」插值，凭空加进去的速度会被那一句吃掉大半 ——
 * 实测加速度写法只能推出 0.6 格/秒，人站在带子上几乎看不出在动。
 * 位移走的是同一套 AABB 扫掠，撞墙照旧停住，不会把人推进石头里。
 *
 * 判据是「脚下一格是传送带」：传送带是**实心**方块，人站在它顶上，
 * 所以脚所在格是空气、脚下一格才是带子（和铁轨那种薄板相反）。 */
export function applyBelts(dt) {
  const step = BELT_SPEED * dt;
  if (!rideCart && !player.dead) {
    const d = beltUnder(player.x, player.y, player.z);
    if (d) { if (d[0]) moveAxis('x', d[0] * step); if (d[1]) moveAxis('z', d[1] * step); }
  }
  for (const m of mobs) {
    if (m.dead) continue;
    const d = beltUnder(m.x, m.y, m.z);
    if (!d) continue;
    const D = MOB_TYPES[m.type];
    const hw = (D.w || 0.6) / 2;
    if (d[0]) moveBodyAxis(m, hw, D.h, 'x', d[0] * step);
    if (d[1]) moveBodyAxis(m, hw, D.h, 'z', d[1] * step);
  }
  for (const b of bots) {
    if (b.dead) continue;
    const d = beltUnder(b.x, b.y, b.z);
    if (!d) continue;
    const hw = BOT_W / 2;
    if (d[0]) moveBodyAxis(b, hw, BOT_H, 'x', d[0] * step);
    if (d[1]) moveBodyAxis(b, hw, BOT_H, 'z', d[1] * step);
  }
}

function beltUnder(x, y, z) {
  const id = getEffective(Math.floor(x), Math.floor(y) - 1, Math.floor(z));
  if (id !== I.BELT) return null;
  return beltDirAt(Math.floor(x), Math.floor(y) - 1, Math.floor(z)) || [1, 0];
}

/* ---------------- 传送板 ----------------
 * 配对规则刻意做成**按顺序两两成对**：放第一块时它等着，放第二块时两者互连，
 * 第三块又开始新的一对。
 * 为什么不做「右键点两块来连线」：那需要一套选择交互 + 高亮 + 取消，
 * 而「两两成对」只需要记住「哪块还在等」，玩家的操作量是零 ——
 * 在他看来就是「放两块，就能互相传」。 */
export const PAD_CD = 1.4;                   // 传送后的冷却（秒）

export function registerPad(x, y, z) {
  const t = pads[dim];
  const key = EKEY(x | 0, y | 0, z | 0);
  t.delete(key);                              // 同一格重放：先抹掉旧记录
  /* 找一块还在等的板（Map 的插入顺序就是放置顺序，取第一个 = 最早放的） */
  let wait = null;
  for (const [k, v] of t) if (!v.link) { wait = k; break; }
  if (wait === null) { t.set(key, { link: null }); return 'wait'; }
  const w = wait.split(',').map(Number);
  t.set(wait, { link: [x | 0, y | 0, z | 0] });
  t.set(key, { link: w });
  return 'linked';
}
export function padAt(x, y, z) { return pads[dim].get(EKEY(x | 0, y | 0, z | 0)) || null; }
export function clearPad(x, y, z) {
  const t = pads[dim];
  const key = EKEY(x | 0, y | 0, z | 0);
  const rec = t.get(key);
  if (rec && rec.link) {
    /* 拆掉一块 → 对面的那一块重新变成「等待配对」，而不是留下一条指到空气的链接 */
    const other = t.get(rec.link.join(','));
    if (other) t.set(rec.link.join(','), { link: null });
  }
  t.delete(key);
}
/* 目标还站得住吗（对面的板被挖了 / 被方块埋了就不传） */
function padUsable(x, y, z) {
  return getEffective(x, y, z) === I.PAD &&
         !isSolid(getEffective(x, y + 1, z)) && !isSolid(getEffective(x, y + 2, z));
}

/* 每帧检查：谁踩在板上就传到对面。
 * 玩家 / 生物 / AI 玩家都吃这一套 —— 传送板是「装置」不是「玩家特权」，
 * 看着一群 AI 玩家被板子吸走再在对面冒出来，比只传自己有意思得多。 */
export function updatePads(dt) {
  tickCd(player, dt);
  if (!rideCart && !player.dead) tryPadTeleport(player, dt, true);
  for (const m of mobs) { if (m.dead) continue; tickCd(m, dt); tryPadTeleport(m, dt, false); }
  for (const b of bots) { if (b.dead) continue; tickCd(b, dt); tryPadTeleport(b, dt, false); }
}
function tickCd(e, dt) { if (e.padCd > 0) e.padCd = Math.max(0, e.padCd - dt); }

function tryPadTeleport(e, dt, isPlayer) {
  if (e.padCd > 0) return;
  const x = Math.floor(e.x), y = Math.floor(e.y), z = Math.floor(e.z);
  const rec = padAt(x, y, z);
  if (!rec || !rec.link) return;
  const [tx, ty, tz] = rec.link;
  if (!padUsable(tx, ty, tz)) return;
  const ox = e.x, oy = e.y, oz = e.z;
  e.x = tx + 0.5; e.y = ty + (isPlayer ? 0.05 : 0); e.z = tz + 0.5;
  e.padCd = PAD_CD;
  if (isPlayer) {
    e.vy = Math.max(e.vy, 0);
    blip(760, 0.16, 'sine', 0.05);
    noiseBurst(0.10, 0.05, 1500);
  }
  spawnParticles(ox, oy + 0.6, oz, [132, 224, 248]);
  spawnParticles(e.x, e.y + 0.6, e.z, [132, 224, 248]);
}

/* ---------------- 传送珠 ----------------
 * 右键瞬移到准星落点。刻意**不飞出去再落地**（那是一枚投掷物，要一整套
 * 飞行/碰撞/落点判定的代码）：直接按射线落点传，判定只有一句「那儿站得住吗」，
 * 和传送板共用同一个「不把人塞进石头里」的约束。 */
export const BLINK_RANGE = 26;
export const BLINK_CD = 0.7;
let blinkCd = 0;

export function tryBlink() {
  if (blinkCd > 0) return false;
  const hit = raycast(BLINK_RANGE);
  if (!hit) { toast('准星对着想去的位置再按右键'); return false; }
  const x = hit.x + hit.nx, y = hit.y + hit.ny, z = hit.z + hit.nz;
  if (y < 1 || y + 2 >= H) { toast('那儿站不住'); return false; }
  if (isSolid(getEffective(x, y, z)) || isSolid(getEffective(x, y + 1, z))) { toast('那儿站不住'); return false; }
  if (!isSolid(getEffective(x, y - 1, z))) { toast('那儿站不住（脚下是空的）'); return false; }
  spawnParticles(player.x, player.y + 0.8, player.z, [150, 110, 246]);
  player.x = x + 0.5; player.y = y; player.z = z + 0.5;
  player.vx = player.vy = player.vz = 0;
  player.fallPeak = null;
  spawnParticles(player.x, player.y + 0.8, player.z, [150, 110, 246]);
  blip(880, 0.14, 'sine', 0.05);
  noiseBurst(0.09, 0.05, 1800);
  blinkCd = BLINK_CD;
  return true;
}
export function tickBlink(dt) { if (blinkCd > 0) blinkCd = Math.max(0, blinkCd - dt); }
