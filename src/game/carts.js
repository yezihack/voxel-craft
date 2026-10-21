/* 矿车与铁轨：实体沿轨道跑、红石供电加速、玩家可上下车 —— 新增（2026-10-20） */

import { toast } from './uiState.js'
import { blip } from './audio.js'
import { BLOCKS, G, I } from './config.js'
import { getEffective, isSolid } from './generate.js'
import { input } from './input.js'
import { rayBox } from './mobs.js'
import { player } from './player.js'
import { rideCart, setRideCart } from './state.js'

/* ============================== 矿车 ==============================
 * 矿车是**唯一一种玩家能骑的实体**，所以它同时具备两套语义：
 *   ① 载具：沿铁轨跑，靠充能铁轨加速、靠红石块/红石火把供电
 *   ② 物件：不骑的时候就是个会滑、会掉、会撞墙的铁疙瘩
 *
 * 为什么单独一个模块而不是塞进 mobs.js / bots.js：
 *   · mobs 那侧的 mobRng 消费序列被回归测试钉死了，多一个调用点就集体漂移
 *   · bots 的语义是「行为像玩家的人」，矿车不是人
 *   · 矿车要读写 state.js 的 rideCart（= 玩家当前骑着谁），这一段耦合值得单独放
 *
 * 铁轨**不存朝向**：方块 id 只有一种（另一种只差「供电」），
 * 所以轨道走向完全由「相邻哪一格还有铁轨」现推 —— 这是纯函数式的写法，
 * 拆一格轨道，车的走向下一帧就跟着变，不需要维护任何 adjacency 表。 */

export const carts = [];
export const CART_CAP = 12;                 // 同屏上限（再多就是铁轨堵车了）

/* 碰撞箱：比玩家窄一点（0.7 宽），高 0.55 —— 矮是因为它要能从一格高的洞里穿过 */
export const CART_W = 0.70, CART_H = 0.55;
/* 车底离轨道薄板的高度。薄板画在格内 y=0.12（见 mesher 的 SHEET_PLATE），
 * 车底必须**高于**它，否则车轮会陷进板里、视觉上像是卡在铁轨中间。 */
export const CART_Y_OFF = 0.14;
export const CART_SPEED_MAX = 9.0;          // 充能铁轨能推到的最高速
export const CART_ACC = 7.0;                // 供电时的加速度
export const CART_BRAKE = 12.0;             // 未供电的充能铁轨 = 刹车带
export const CART_FRICTION = 0.55;          // 普通铁轨的自然减速
export const CART_PUSH = 6.0;               // 骑着时按 W 的助力（沿当前朝向）

/* 上一帧的跳跃键状态：下车要**边沿触发**，按住空格不该反复上下车 */
let jumpPrev = false;

/* 是不是轨道（两种都算） */
export const isRail = (id) => id === I.RAIL || id === I.RAIL_POWERED;

/* 充能铁轨有没有被供上电。
 * 供电判据刻意做得**很宽**：六邻居里任意一格是红石块或红石火把就算通了电。
 * 理由是没有「红石粉」这种可布线材料，真按 Minecraft 那套「导线连到电源」
 * 来做的话，玩家在没有导线的世界里根本点不亮任何一条轨 —— 规则漂亮但玩不了。
 * ⚠ 用 BLOCKS[id].power 而不是 id 白名单：以后再加电源方块不用回来改这里。 */
export function railPowered(x, y, z) {
  for (const [dx, dy, dz] of [[1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1], [0, -1, 0], [0, 1, 0]]) {
    const id = getEffective((x | 0) + dx, (y | 0) + dy, (z | 0) + dz);
    const B = BLOCKS[id];
    if (B && B.power) return true;
  }
  return false;
}

/* 造一辆车。(x, z) 是轨道格的格心，y 是轨道格的 y。 */
export function spawnCart(x, y, z) {
  if (carts.length >= CART_CAP) return null;
  const c = {
    x: Math.floor(x) + 0.5, y: (y | 0) + CART_Y_OFF, z: Math.floor(z) + 0.5,
    sp: 0, vy: 0,
    dir: [1, 0],             // 单位轴向：只有 ±x / ±z 四种
    yaw: 0,
    rider: null,             // 'player' 或 null
    onRail: true,
    wobble: 0,
  };
  /* 初始朝向：优先顺着相邻铁轨的方向，四周都没有就朝 +x。
   * 车放下去就「知道该往哪跑」，比一动不动等着玩家推友好得多。 */
  for (const [dx, dz] of [[1, 0], [0, 1], [-1, 0], [0, -1]]) {
    if (isRail(getEffective(Math.floor(c.x) + dx, y | 0, Math.floor(c.z) + dz))) { c.dir = [dx, dz]; break; }
  }
  carts.push(c);
  return c;
}

export function despawnAllCarts() {
  carts.length = 0;
  setRideCart(null);        // 车没了还挂着引用 → 玩家会被钉在旧坐标上
}

/* ---------------- 上下车 ---------------- */
export function boardCart(c) {
  if (!c || rideCart) return false;
  setRideCart(c);
  c.rider = 'player';
  blip(520, 0.10, 'sine', 0.05);
  toast('🛤 已上车 · W 加速 / S 刹车 / 空格下车');
  return true;
}
export function dismountCart() {
  const c = rideCart;
  if (!c) return false;
  c.rider = null;
  setRideCart(null);
  /* 下车往侧面挪一格而不是原地弹出：原地的话人还站在车里，
   * 下一帧又会被车带着走（看起来像下不来）。 */
  const side = c.dir[0] !== 0 ? [0, 1] : [1, 0];
  player.x = c.x + side[0] * 0.9;
  player.z = c.z + side[1] * 0.9;
  player.y = c.y + 0.1;
  player.vx = player.vy = player.vz = 0;
  blip(340, 0.08, 'sine', 0.05);
  return true;
}

/* 射线打矿车（右键上车用）。返回 { cart, dist } 或 null。
 * 与 bots.js 的 raycastBot 同构：AABB 用车的实际宽高，底边就是车底。 */
export function raycastCart(ox, oy, oz, dx, dy, dz, maxD) {
  let best = null;
  const hw = CART_W / 2;
  for (const c of carts) {
    const mn = [c.x - hw, c.y, c.z - hw], mx = [c.x + hw, c.y + CART_H, c.z + hw];
    const t = rayBox(ox, oy, oz, dx, dy, dz, mn, mx);
    if (t < 0 || t > maxD) continue;
    if (!best || t < best.dist) best = { cart: c, dist: t };
  }
  return best;
}

/* ---------------- 每帧推进 ---------------- */
export function updateCarts(dt) {
  /* 空格下车：边沿触发。放在这里而不是 input.js —— 上车/下车是一对，
   * 拆到两个文件里迟早会出现「上车成功但下不来」这种半边状态。 */
  if (rideCart && input.jump && !jumpPrev) dismountCart();
  jumpPrev = input.jump;

  for (let i = carts.length - 1; i >= 0; i--) {
    const c = carts[i];
    if (c.y < -8) { if (c.rider) dismountCart(); carts.splice(i, 1); continue; }
    stepCart(c, dt);
  }
  /* 骑乘同步放在**所有车推进之后**：先定车位、再定人位，
   * 渲染出来的人车才是重合的（反过来会差一帧，快速过弯时看得出分离）。 */
  if (rideCart) {
    const c = rideCart;
    player.x = c.x; player.z = c.z;
    player.y = c.y + 0.05;
    player.vx = player.vy = player.vz = 0;
    player.onGround = true;
  }
}

/* 一格铁轨能不能走（含上下坡）：返回那格的 y，不能走返回 null */
function railStepY(bx, bz, ry) {
  if (isRail(getEffective(bx, ry, bz))) return ry;
  if (isRail(getEffective(bx, ry + 1, bz))) return ry + 1;      // 上坡
  if (isRail(getEffective(bx, ry - 1, bz))) return ry - 1;      // 下坡
  return null;
}

function stepCart(c, dt) {
  const bx = Math.floor(c.x), bz = Math.floor(c.z);
  /* 轨道格 = 车底所在的那一格。车底 y = 轨道格 y + CART_Y_OFF，
   * 所以 `Math.floor(c.y)` 在「贴着轨道」时正好等于轨道格 —— 只有正在
   * 坠落/起跳的过程中才会落在别的高度上，那时 ryAt 查不到轨道，进入自由落体。 */
  const ryAt = Math.floor(c.y);
  const onRail = isRail(getEffective(bx, ryAt, bz));

  if (!onRail) {
    /* 没轨道：自由落体 + 落地。落地时顺手看看脚下是不是轨道，
     * 是的话就把车「吸」上去（放车时差半格也不会掉下去）。 */
    c.vy -= G * dt;
    c.vy = Math.max(c.vy, -32);
    const ny = c.y + c.vy * dt;
    const fy = Math.floor(ny);
    if (c.vy < 0 && isSolid(getEffective(bx, fy, bz))) {
      c.y = fy + 1;
      c.vy = 0;
      c.sp = Math.max(0, c.sp - 4 * dt);
      if (isRail(getEffective(bx, fy + 1, bz))) c.y = fy + 1 + CART_Y_OFF;
    } else {
      c.y = ny;
    }
    c.x += c.dir[0] * c.sp * dt;
    c.z += c.dir[1] * c.sp * dt;
    c.sp = Math.max(0, c.sp - 1.2 * dt);
    return;
  }

  /* ---- 在轨道上 ---- */
  c.vy = 0;
  const target = ryAt + CART_Y_OFF;
  c.y += (target - c.y) * Math.min(1, 12 * dt);       // 缓动贴合，上下坡不会瞬移
  const cur = getEffective(bx, ryAt, bz);
  const powered = cur === I.RAIL_POWERED && railPowered(bx, ryAt, bz);

  if (powered) c.sp = Math.min(CART_SPEED_MAX, c.sp + CART_ACC * dt);
  else if (cur === I.RAIL_POWERED) c.sp = Math.max(0, c.sp - CART_BRAKE * dt);
  else c.sp = Math.max(0, c.sp - CART_FRICTION * dt);

  /* 骑乘时 W / S 直接推车：没有这个的话「上车」只是换个角度看世界，
   * 玩家会以为车坏了 —— 车必须能被**驱动**。 */
  if (c.rider === 'player') {
    if (input.f) c.sp = Math.min(CART_SPEED_MAX, c.sp + CART_PUSH * dt);
    if (input.b) c.sp = Math.max(0, c.sp - CART_BRAKE * dt);
  }
  if (c.sp <= 0.001) { c.sp = 0; return; }

  /* 沿轴向推进一帧 */
  const step = c.sp * dt;
  let nx = c.x + c.dir[0] * step, nz = c.z + c.dir[1] * step;
  const nbx = Math.floor(nx), nbz = Math.floor(nz);
  const aheadY = railStepY(nbx, nbz, ryAt);
  const blocked = isSolid(getEffective(nbx, aheadY === null ? ryAt : aheadY, nbz));

  if (aheadY !== null && !blocked) {
    c.x = nx; c.z = nz;
    if (aheadY !== ryAt) c.y = aheadY + CART_Y_OFF;             // 换层（上下坡）
    // 保持在轨道中心线上：垂直于行进方向的那个轴锁死在格心
    if (c.dir[0] !== 0) c.z = Math.floor(c.z) + 0.5;
    else                c.x = Math.floor(c.x) + 0.5;
    c.wobble += c.sp * dt * 2.2;
    return;
  }

  /* ---- 前方没路：先试着拐弯，拐不了就掉头 ----
   * 拐弯必须在**当前格**里找出口，不能拿已经越界的新坐标去找 ——
   * 那样会在轨道尽头一格一格往外飘出去。 */
  for (const [dx, dz] of [[1, 0], [0, 1], [-1, 0], [0, -1]]) {
    if (dx === -c.dir[0] && dz === -c.dir[1]) continue;           // 不掉头（放最后）
    if (railStepY(bx + dx, bz + dz, ryAt) === null) continue;
    if (isSolid(getEffective(bx + dx, ryAt, bz + dz))) continue;
    c.dir = [dx, dz];
    c.x = bx + 0.5; c.z = bz + 0.5;                               // 归位到格心再转弯
    c.sp = Math.max(c.sp * 0.55, 1.2);                            // 转弯掉点速，但别停死
    return;
  }
  /* 死路：原路掉头，速度清零（再推一次才走） */
  c.dir = [-c.dir[0], -c.dir[1]];
  c.sp = 0;
}

/* 朝向（渲染用）：车头顺着行进方向。+z 是模型正面，和 AI 玩家同一套约定。 */
export const cartYaw = (c) => Math.atan2(c.dir[0], c.dir[1]);
