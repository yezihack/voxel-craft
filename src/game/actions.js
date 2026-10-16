/* 操作：挖掘 / 放置 / 进食 / 召唤 / 点燃传送门 —— 迁移自 voxel-craft.html 第 8474-8648 行 */

import { toast } from './uiState.js'
import { MODE, mode, running, setHandSwing } from './state.js'
import { blip, noiseBurst } from './audio.js'
import { BLOCKS, DIM_N, EGG_OF, H, I, ITEMS, PORTAL_BLOCK, REACH, SUMMON_OF } from './config.js'
import { DIMS } from './dims.js'
import { getEffective, isLiquid, isSolid, setBlock } from './generate.js'
import { MOB_CAP, MOB_TYPES, mobs, spawnMob, summonGolem } from './mobs.js'
import { insideSelf, player, raycast } from './player.js'
import { ignitePortal } from './portal.js'
import { collectDrop, heldId, invCount, invTake, tryEat } from './survival.js'
import { P } from './textures.js'

/* ============================== 操作 ============================== */


/* 基岩（世界底层的黑曜石）不可破坏 */
export const isBedrock = (hit) => hit.id === I.OBSIDIAN && hit.y === 0;

/* 破坏一个方块的共同收尾：清空、音效、粒子。生存模式再补上掉落进背包。 */
export function breakBlock(hit, withDrop) {
  const id = hit.id;
  const B = BLOCKS[id];
  setBlock(hit.x, hit.y, hit.z, 0);
  setHandSwing(1);
  noiseBurst(0.10, 0.09, id === I.SAND ? 2600 : id === I.GLASS ? 5200 : 1100);
  blip(120 + id * 14, 0.05, 'triangle', 0.035);
  spawnParticles(hit.x + 0.5, hit.y + 0.5, hit.z + 0.5, B.side);
  if (withDrop) collectDrop(id);
  return id;
}

/* 创造模式：一指破 */
export function doBreak() {
  if (!running) return;
  if (mode === MODE.SPECTATOR) return;      // 旁观者碰不到方块
  const hit = raycast(REACH);
  if (!hit) return;
  if (isBedrock(hit)) { blip(160, .1, 'sawtooth', .05); return; }
  breakBlock(hit, false);
}

/* 生存模式：按硬度挖满时长后才破（由主循环里的 updateDig 调用） */
export function doBreakTimed(hit) {
  if (!running || !hit) return;
  if (isBedrock(hit)) { blip(160, .1, 'sawtooth', .05); return; }
  breakBlock(hit, true);
}

export function doPlace() {
  if (!running) return;
  if (mode === MODE.SPECTATOR) return;      // 旁观者碰不到方块
  const id = heldId();
  if (!id) return;

  // 食物：右键是「吃」而不是「放」；工具/武器/弹药右键也不是「放」
  if (ITEMS[id]) {
    if (SUMMON_OF[id]) { trySummon(id); return; }
    if (EGG_OF[id]) { trySpawnEgg(id); return; }                   // 刷怪蛋：放生物
    if (ITEMS[id].core !== undefined) { tryIgnite(id); return; }   // 维度核心：点门框
    if (tryEat(id)) { noiseBurst(0.09, 0.05, 700); blip(520, 0.10, 'sine', 0.05); }
    return;
  }

  const hit = raycast(REACH);
  if (!hit) return;
  const x = hit.x + hit.nx, y = hit.y + hit.ny, z = hit.z + hit.nz;
  if (y < 0 || y >= H) return;                  // 只限制垂直范围，水平方向无限
  const cur = getEffective(x, y, z);
  if (cur !== 0 && !isLiquid(cur)) return;      // 只能放进空气或替换液体
  // 不能把方块塞进自己身体里
  if (isSolid(id) && insideSelf(x, y, z)) return;
  if (mode === MODE.SURVIVAL && !invTake(id, 1)) return;   // 生存模式：有货才放得下
  setBlock(x, y, z, id);
  noiseBurst(0.06, 0.07, 900);
  blip(300 + id * 10, 0.05, 'sine', 0.04);
}

/* 右键「傀儡核心」→ 在准星指着的方块顶上召唤一只傀儡。
 * 放置规则（脚下实心 / 头顶够高）全在 summonGolem 里，这里只管射线、
 * 扣物品与反馈 —— 那部分纯逻辑才好在无头测试里验。 */
export function trySummon(id) {
  const type = SUMMON_OF[id];
  if (!type) return false;
  if (mode === MODE.SURVIVAL && !invCount(id)) return false;
  const hit = raycast(REACH);
  if (!hit) return false;
  const x = hit.x + hit.nx, y = hit.y + hit.ny, z = hit.z + hit.nz;
  const m = summonGolem(type, x, y, z, player.yaw + Math.PI);
  if (!m) { blip(120, 0.09, 'square', 0.04); return false; }   // 放不下：给个闷响，不扣货
  if (mode === MODE.SURVIVAL) invTake(id, 1);
  spawnParticles(x + 0.5, y + 0.6, z + 0.5, [226, 230, 236]);
  noiseBurst(0.18, 0.10, 800);
  blip(150, 0.26, 'triangle', 0.07);
  return true;
}

/* 右键「刷怪蛋」→ 在准星指着的方块顶上放出一只对应生物。
 * 与傀儡核心的 summonGolem 不同：这里不查 canSummonAt —— 那是傀儡专用的放置规则。
 * 蛋对**任何**生物都成立，规则只有两条硬约束：目标格得空、脚下得实心。
 *
 * ⚠ 直接调 spawnMob，**不经过 updateMobSpawn 的昼夜总闸** —— 这正是「白天也能用」：
 * 总闸拦的是「游戏自己刷怪」，拦不到玩家亲自动手放的蛋。
 * 这也是为什么敌对蛋白天放出来也能站着 —— 白天限的是**自动刷新**，不是「存在」。 */
export function trySpawnEgg(id) {
  const type = EGG_OF[id];
  if (!type || !MOB_TYPES[type]) return false;
  const hit = raycast(REACH);
  if (!hit) { toast('准星对着要放生物的地面再按右键'); return false; }
  /* 两个候选落点：① 命中面的外侧相邻格（对着地面时就是地面顶上）；
   * ② 命中方块的正上方（对着墙/侧面时兜底，让蛋落在墙顶而不是悬空）。
   * 取第一个「格内为空 + 脚下实心」成立的；都不成立就给提示。 */
  const cands = [[hit.x + hit.nx, hit.y + hit.ny, hit.z + hit.nz], [hit.x, hit.y + 1, hit.z]];
  let x = 0, y = 0, z = 0, ok = false;
  for (const [cx, cy, cz] of cands) {
    if (cy < 1 || cy >= H) continue;
    const cur = getEffective(cx, cy, cz);
    if (cur !== 0 && !isLiquid(cur)) continue;                  // 目标格必须是空气或液体
    if (!isSolid(getEffective(cx, cy - 1, cz))) continue;       // 脚下必须实心
    x = cx; y = cy; z = cz; ok = true; break;
  }
  if (!ok) { blip(120, 0.09, 'square', 0.04); toast('得对着地面放'); return false; }
  if (mobs.length >= MOB_CAP) { toast('场上生物太多了，先清一清再放'); return false; }
  const m = spawnMob(type, x + 0.5, y, z + 0.5, player.yaw + Math.PI);
  if (!m) { blip(120, 0.09, 'square', 0.04); return false; }
  if (mode === MODE.SURVIVAL) invTake(id, 1);
  spawnParticles(x + 0.5, y + 0.6, z + 0.5, ITEMS[id].color);
  noiseBurst(0.16, 0.10, 820);
  blip(620, 0.16, 'triangle', 0.06);
  return true;
}

/* 右键「维度核心」→ 把准星指着的黑曜石门框点成一扇通往对应维度的传送门。
 * 门框的识别与点火全在生成入口段（纯逻辑，无头可测），这里只管射线、音效、提示。
 *
 * 为什么要连命中点周围一圈一起试：玩家很自然会「对着门洞里的空气按右键」，
 * 而射线会穿过空气打在门后的墙上 —— 那时真正该点的是洞口的边缘，
 * 而它就在命中点的邻格里。 */
export function tryIgnite(id) {
  const d = ITEMS[id].core;
  if (!(d >= 0 && d < DIM_N)) return false;
  const hit = raycast(REACH);
  if (!hit) { toast('准星对准黑曜石搭的门框再按右键'); return false; }
  const cands = [[hit.x, hit.y, hit.z]];
  for (const [ox, oy, oz] of [[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]])
    cands.push([hit.x + ox, hit.y + oy, hit.z + oz]);
  for (const [cx, cy, cz] of cands) {
    const hole = ignitePortal(d, cx, cy, cz);
    if (!hole) continue;
    const c = hole[0], P = BLOCKS[PORTAL_BLOCK[d]];
    spawnParticles(c[0] + 0.5, c[1] + 0.6, c[2] + 0.5, P.side);
    noiseBurst(0.22, 0.10, 700);
    blip(180, 0.30, 'triangle', 0.07);
    toast(P.name + ' 点燃 → 走进这扇门就是「' + DIMS[d].name + '」');
    return true;
  }
  blip(120, 0.09, 'square', 0.04);
  toast('没认出门框：用黑曜石围出一个 2 宽 × 3 高的门洞，再对着框点火');
  return false;
}

/* 简易粒子（CPU 端小立方体，用线框程序画点） */
export const particles = [];
export function spawnParticles(x, y, z, col) {
  for (let i = 0; i < 8; i++) {
    particles.push({
      x, y, z,
      vx: (Math.random() - .5) * 3, vy: Math.random() * 3.4 + 1, vz: (Math.random() - .5) * 3,
      life: 0.7 + Math.random() * 0.4, col,
    });
  }
}
export function updateParticles(dt) {
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.vy -= 18 * dt;
    p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
    if (isSolid(getEffective(Math.floor(p.x), Math.floor(p.y), Math.floor(p.z)))) {
      p.vy = Math.abs(p.vy) * 0.28; p.vx *= .5; p.vz *= .5;
      p.y = Math.floor(p.y) + 0.02;
    }
    p.life -= dt;
    if (p.life <= 0) particles.splice(i, 1);
  }
}
