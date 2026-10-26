/* 玩家：AABB 碰撞、重力 / 跳跃 / 飞行、射线拾取 —— 迁移自 voxel-craft.html 第 5481-5652 行 */

import { MODE, dim, mode, rideCart, spectate } from './state.js'
import { BLOCKS, EYE, G, I, JUMP_V, PW } from './config.js'
import { DIMS } from './dims.js'
import { getEffective, isLiquid, isSolid } from './generate.js'
import { input } from './input.js'
import { die, respawn } from './survival.js'

/* ============================== 玩家 ============================== */
export const player = {
  x: 0, y: 30, z: 0,
  vx: 0, vy: 0, vz: 0,
  yaw: 0, pitch: 0,
  fly: false,
  onGround: false,
  inWater: false,
  inLava: false,
  spawn: [0, 30, 0],
  /* --- 生存模式状态（创造模式下不使用，但始终存在，UI 才不会读到 undefined） --- */
  hp: 20, maxHp: 20,
  food: 20, maxFood: 20,
  air: 10, maxAir: 10,
  dead: false,
  fallPeak: null,       // 离地后到达过的最高点，用于算坠落高度
  exhaust: 0,           // 消耗度，攒满 4 扣 1 点饥饿
  hurtFlash: 0,         // 受伤红屏剩余时间
  drownT: 0, lavaT: 0, cactusT: 0, regenT: 0, starveT: 0,
  /* 举盾格挡中。由主循环每帧维护（手持盾牌 + 按住右键），
   * survival.js 的 hurt() 读它决定要不要按盾牌比例减伤。
   * 放在 player 上而不是单独的模块变量：它和 hp/food 一样是「玩家此刻的状态」，
   * 存档时也该跟着走（读档瞬间手里正举着盾就继续举着，不必让玩家重按）。 */
  blocking: false,
};

/* 沿单轴移动并解决与方块的碰撞（AABB 扫掠的简化逐轴解法） */
/* 逐轴移动 + AABB 扫掠碰撞。玩家和生物共用同一套：
 * hw = 半宽，hh = 高度。返回 true 表示这一步撞到了东西。 */
export function moveBodyAxis(e, hw, hh, axis, amount) {
  if (amount === 0) return false;
  e[axis] += amount;

  const x0 = Math.floor(e.x - hw), x1 = Math.floor(e.x + hw - 1e-6);
  const y0 = Math.floor(e.y),      y1 = Math.floor(e.y + hh - 1e-6);
  const z0 = Math.floor(e.z - hw), z1 = Math.floor(e.z + hw - 1e-6);

  for (let y = y0; y <= y1; y++)
    for (let z = z0; z <= z1; z++)
      for (let x = x0; x <= x1; x++) {
        if (!isSolid(getEffective(x, y, z))) continue;
        // 与该方块碰撞 → 回退到贴合位置
        if (amount > 0) e[axis] = (axis === 'x' ? x : axis === 'y' ? y : z) - (axis === 'y' ? hh : hw) - 1e-4;
        else            e[axis] = (axis === 'x' ? x + 1 : axis === 'y' ? y + 1 : z + 1) + (axis === 'y' ? 0 : hw) + 1e-4;
        if (axis === 'y') { if (amount < 0) e.onGround = true; e.vy = 0; }
        else e['v' + axis] = 0;
        return true;
      }
  return false;
}
export function moveAxis(axis, amount) { return moveBodyAxis(player, PW, 1.8, axis, amount); }

export function updatePhysics(dt, input) {
  const p = player;
  /* 骑在矿车上时**整段物理让给车**：位置、朝向都由 carts.js 驱动。
   * 这里如果照旧跑一遍重力与 AABB，人会被车推着撞墙、还会不停往下滑
   * ——车在动、人在原地被反复校正，看起来就是「车上的人在抽搐」。 */
  if (rideCart) {
    player.x = rideCart.x; player.z = rideCart.z; player.y = rideCart.y + 0.05;
    player.vx = player.vy = player.vz = 0;
    player.onGround = true;
    return;
  }
  // 流体判定：脚部与头部各取一次，任一为水/岩浆都算浸泡
  const fx = Math.floor(p.x), fz = Math.floor(p.z);
  const feetId = getEffective(fx, Math.floor(p.y + 0.9), fz);
  const headId = getEffective(fx, Math.floor(p.y + EYE), fz);
  const hot = (BLOCKS[feetId] && BLOCKS[feetId].hot) || (BLOCKS[headId] && BLOCKS[headId].hot);
  p.inLava = !!hot;
  p.inWater = !hot && (feetId === I.WATER || headId === I.WATER);

  // 目标速度
  const cy = Math.cos(p.yaw), sy = Math.sin(p.yaw);
  let wishX = 0, wishZ = 0;
  if (input.f) { wishX -= sy; wishZ -= cy; }
  if (input.b) { wishX += sy; wishZ += cy; }
  if (input.l) { wishX -= cy; wishZ += sy; }
  if (input.r) { wishX += cy; wishZ -= sy; }
  const len = Math.hypot(wishX, wishZ);
  if (len > 0) { wishX /= len; wishZ /= len; }

  const sprint = input.shift && !p.fly ? 1.45 : 1;
  let speed = (p.fly ? 13 : p.inLava ? 1.7 : p.inWater ? 3.4 : 4.9) * sprint;
  if (input.sprint) speed *= 1.25;
  /* 举盾时挪不快：挡得住就打不快、走得慢，这是格挡该有的代价。
   * 取 0.42 而不是 0.2 —— 太低会让「举着盾撤退」变成原地挨打。 */
  if (p.blocking) speed *= 0.42;

  /* 旁观模式：穿墙观战飞行。和创造飞行两条区别 ——
   *   ① 不走 moveBodyAxis：不碰撞 = 穿墙，钻到地形里看矿脉专用
   *   ② 附身期间身体整个冻结：相机骑在生物身上，肉身留在原地等回来
   * 速度比创造飞行快一截：旁观者得能追上奔跑的僵尸。 */
  if (mode === MODE.SPECTATOR) {
    if (spectate) return;
    const sp = 18 * (input.sprint ? 1.4 : 1);
    p.vx += (wishX * sp - p.vx) * Math.min(1, 14 * dt);
    p.vz += (wishZ * sp - p.vz) * Math.min(1, 14 * dt);
    let vy = 0;
    if (input.jump) vy += sp * 0.8;
    if (input.shift) vy -= sp * 0.8;
    p.vy += (vy - p.vy) * Math.min(1, 14 * dt);
    p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;   // 直接积分 = 不碰撞
    p.onGround = false;
    if (p.y < -20) p.y = -20;                 // 别一路掉出世界底线
    return;
  }
  if (p.fly) {
    const accel = 14;
    p.vx += (wishX * speed - p.vx) * Math.min(1, accel * dt);
    p.vz += (wishZ * speed - p.vz) * Math.min(1, accel * dt);
    let vy = 0;
    if (input.jump) vy += speed * 0.85;
    if (input.shift) vy -= speed * 0.85;
    p.vy += (vy - p.vy) * Math.min(1, accel * dt);
  } else {
    const accel = p.onGround ? 22 : 7;
    p.vx += (wishX * speed - p.vx) * Math.min(1, accel * dt);
    p.vz += (wishZ * speed - p.vz) * Math.min(1, accel * dt);
    /* 岩浆又稠又重：下沉快、几乎跳不起来。
     * 最后乘维度重力倍率：虚空群岛 0.55、天空花园 0.72 —— 主世界是 1，
     * 所以这一行在主世界与加维度之前逐字等价。 */
    const g = (p.inLava ? 11 : p.inWater ? 6 : G) * DIMS[dim].gravity;
    p.vy -= g * dt;
    if (p.inLava) { p.vy = Math.max(p.vy, -1.2); p.vx *= 0.80; p.vz *= 0.80; }
    else if (p.inWater) { p.vy = Math.max(p.vy, -3.2); p.vx *= 0.94; p.vz *= 0.94; }
    if (input.jump && (p.onGround || p.inWater)) { p.vy = p.inWater ? 4.2 : JUMP_V; p.onGround = false; }
  }

  p.onGround = false;
  moveAxis('x', p.vx * dt);
  moveAxis('z', p.vz * dt);
  moveAxis('y', p.vy * dt);

  // 无横向边界：地形向外平铺，走多远都不会撞墙
  /* 虚空维度（voidY 非 null）必须**跳过**这个地板钳制 ——
   * 不然掉下去会被悄悄抬回 y=2，浮空岛「踩空即死」这个核心机制就没了。
   * 取而代之的是下面那条：低于 voidY 直接判死。 */
  const voidY = DIMS[dim].voidY;
  if (voidY === null && p.y < 1) { p.vy = 0; p.y = Math.max(2, p.y); }
  if (voidY !== null) {
    if (p.y < voidY) {
      // 生存模式坠入虚空=死；创造/旁观直接送回出生点（别让试玩卡在坠落里）
      if (mode === MODE.SURVIVAL) die('你坠入了虚空');
      else { p.x = p.spawn[0]; p.y = p.spawn[1]; p.z = p.spawn[2]; p.vx = p.vy = p.vz = 0; }
    }
  } else if (p.y < -6) respawn();
}

/* --------------------------- DDA 体素射线拾取 --------------------------- */
export function raycast(maxDist) {
  const p = player;
  const cy = Math.cos(p.yaw), sy = Math.sin(p.yaw);
  const cp = Math.cos(p.pitch), sp = Math.sin(p.pitch);
  const dx = -sy * cp, dy = sp, dz = -cy * cp;
  const ox = p.x, oy = p.y + EYE, oz = p.z;

  let x = Math.floor(ox), y = Math.floor(oy), z = Math.floor(oz);
  const stepX = dx > 0 ? 1 : -1, stepY = dy > 0 ? 1 : -1, stepZ = dz > 0 ? 1 : -1;
  const tDeltaX = dx !== 0 ? Math.abs(1 / dx) : Infinity;
  const tDeltaY = dy !== 0 ? Math.abs(1 / dy) : Infinity;
  const tDeltaZ = dz !== 0 ? Math.abs(1 / dz) : Infinity;
  let tMaxX = dx !== 0 ? ((dx > 0 ? x + 1 - ox : ox - x) * tDeltaX) : Infinity;
  let tMaxY = dy !== 0 ? ((dy > 0 ? y + 1 - oy : oy - y) * tDeltaY) : Infinity;
  let tMaxZ = dz !== 0 ? ((dz > 0 ? z + 1 - oz : oz - z) * tDeltaZ) : Infinity;

  let nx = 0, ny = 0, nz = 0, t = 0;
  for (let i = 0; i < 200; i++) {
    if (t > maxDist) return null;
    const id = getEffective(x, y, z);
    // 站在方块上往下看时，脚下那块要能挖；但同层的方块不能挖（否则会挖进自己身体）
    // 液体（水/岩浆）一律不可选 —— 不然射线会停在水面上，没法挖水底的方块
    if (id && !isLiquid(id) && !insideSelf(x, y, z)) return { x, y, z, nx, ny, nz, id, dist: t };
    if (tMaxX < tMaxY && tMaxX < tMaxZ) { x += stepX; t = tMaxX; tMaxX += tDeltaX; nx = -stepX; ny = 0; nz = 0; }
    else if (tMaxY < tMaxZ) { y += stepY; t = tMaxY; tMaxY += tDeltaY; nx = 0; ny = -stepY; nz = 0; }
    else { z += stepZ; t = tMaxZ; tMaxZ += tDeltaZ; nx = 0; ny = 0; nz = -stepZ; }
  }
  return null;
}

/* 判断某方块是否与玩家身体重叠。
 * 只排除「身体所在的那一层」——即方块顶面高于脚底且底面低于头顶。
 * 脚下（y = floor(p.y) - 1）的方块不满足该条件，因此可以被正常挖掘。 */
export function insideSelf(x, y, z) {
  const p = player;
  const bodyY = Math.floor(p.y);
  if (y !== bodyY) return false;
  return x + 1 > p.x - PW && x < p.x + PW && z + 1 > p.z - PW && z < p.z + PW;
}
