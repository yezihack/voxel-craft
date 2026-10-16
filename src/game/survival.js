import { reactive } from 'vue'

/* 生存模式：背包 Map、挖掘计时、饥饿 / 氧气 / 摔落伤害 —— 迁移自 voxel-craft.html 第 5653-5919 行 */

import { BLOCKS, EYE, HOTBAR, I, ITEMS, PW, breakTime, dropCountOf, dropOf, setHeldIdReader } from './config.js'
import { getEffective } from './generate.js'
import { input } from './input.js'
import { clamp } from './math.js'
import { player } from './player.js'
import { MODE, mode, onDeath, onHurt, selected } from './state.js'

/* ============================== 生存模式 ============================== */
/* 这一节是纯逻辑：不碰 DOM、不碰 WebGL，所以能整段抽到 Node 里跑测试。
 * 与界面相关的一切都通过 onHurt / onDeath 两个钩子回调出去
 * （无头测试里它们保持为 null，于是完全解耦）。 */
/* 三种模式：创造 / 生存 / 旁观。
 * 旁观 = 隐身穿墙观战：免疫伤害、不刷不吃、不能挖放，准星对准生物按 F 附身。
 * 它是「看世界运转」用的，所以刷怪照旧（见 updateMobs）、怪物无视你
 * （见 hostileTarget）。 */



/* 生存数值的调参集中在这里，方便一把改齐 */
export const SURV = {
  fallSafe: 3.4,        // 这个高度以内落地不掉血
  drownDps: 2,          // 缺氧后每秒扣血
  drownDelay: 1,        // 缺氧后多久开始扣血
  airRefill: 5,         // 露出水面后每秒回多少氧气
  lavaDps: 4,           // 岩浆每秒伤害（按 lavaTick 折算到每次结算）
  lavaTick: 0.5,
  cactusDmg: 1,         // 仙人掌伤害
  cactusTick: 0.6,
  exhaustIdle: 0.018,   // 静立每秒消耗度
  exhaustWalk: 0.100,   // 移动
  exhaustRun: 0.300,    // 冲刺
  exhaustPerFood: 4,    // 攒满多少消耗度扣 1 点饥饿
  regenFood: 16,        // 饥饿高于此值才会自然回血
  regenInterval: 3,     // 回 1 点血的间隔（秒）
  regenCost: 3,         // 每次回血额外增加的消耗度
  starveInterval: 4,    // 饿到 0 之后多久扣 1 点血
};

/* --- 背包：id → 数量。创造模式下不使用 --- */
export const inv = reactive(new Map());
export const invCount = (id) => inv.get(id) | 0;
export function invAdd(id, n = 1) {
  if (!id || n <= 0) return;
  inv.set(id, invCount(id) + n);
  autoSlot(id);
}
export function invTake(id, n = 1) {
  const c = invCount(id);
  if (c < n) return false;
  if (c === n) inv.delete(id); else inv.set(id, c - n);
  return true;
}

/* --- 背包布局：快捷栏 9 格 + 储物 45 格 = 54 格。
 * 格子只记「摆着哪个 id」，数量仍旧统一存在 inv（Map）里 ——
 * 一个 id 只占一格，角标数字永远等于真正持有的数量，不会出现
 * 「两格都写 ×3、实际只有 3 个」这种自相矛盾的显示。
 *
 * 储物 45 格在界面里按 9 列 × 5 排铺开，和快捷栏同宽，一眼能数清排数。
 * 底部常驻的 HUD 仍旧只有 9 格快捷栏 —— 54 格全铺在屏幕上会挡住半个画面。 --- */
export const HOTBAR_N = 9, STORE_N = 45, SLOT_N = HOTBAR_N + STORE_N;   // 54
export const invSlots = reactive(new Array(SLOT_N).fill(0));
/* 当前手持的格子号。声明在这里（而不是「输入」段）是有意的：
 * heldId() 读它，而 heldId() 又被 toolSpeedOn/attackDamage 调用 ——
 * 那些是「常量配置」段里的纯函数，无头测试要能在没有 DOM 的沙箱里跑它们。 */

export const activeSlots = () => (mode === MODE.SURVIVAL ? invSlots : HOTBAR);
/* 当前手持的物品 id（0 = 空手） */
export const heldId = () => activeSlots()[selected] | 0;
/* 把手持物的读取方式装回 config.js（toolSpeedOn / attackDamage 要用）。
 * 必须走注入而不是让 config 反过来 import 本模块 —— 原因见 config.js 顶部注释。 */
setHeldIdReader(heldId);

/* 捡到新东西时自动占一个空格，省得每次都要手动摆。
 * 先塞快捷栏（挖到就能直接用数字键切），快捷栏满了再往后排。 */
export function autoSlot(id) {
  if (!id) return;
  if (invSlots.indexOf(id) >= 0) return;
  const i = invSlots.indexOf(0);
  if (i < 0) return;                 // 54 格全满：东西照样在背包里，只是不占格子
  invSlots[i] = id;
}
/* 数量归零的格子必须腾出来 —— 否则界面会一直挂着一个「僵尸图标」，
 * 看起来像捡到的东西没显示 / 用掉了还显示，两头都错。 */
export function pruneSlots() {
  let changed = false;
  for (let i = 0; i < SLOT_N; i++) {
    if (invSlots[i] && invCount(invSlots[i]) <= 0) { invSlots[i] = 0; changed = true; }
  }
  return changed;
}

/* --- 事件钩子（UI 层注入） --- */

export let deathReason = '';                  // 最近一次死亡的原因文案（界面层直接拿来显示）

/* reason 可选：岩浆/僵尸/摔落… —— 不传就由界面层按环境猜 */
export function hurt(n, reason) {
  const p = player;
  if (n <= 0 || p.dead) return -1;
  /* 只有生存模式会受伤。创造免疫一切伤害，这里是最外层的兜底。
   * updateSurvival 已经用 `mode !== MODE.SURVIVAL` 挡住了坠落/岩浆/溺水/仙人掌/饥饿，
   * 但僵尸攻击走的是 mobAI → hurt() 这条**旁路**，骷髅箭走 updateArrows → hurt()，
   * 苦力怕走 explodeMob → hurt() —— 不在这里堵住就会出现
   * 「创造模式被僵尸打死」。放在 hurt 里而不是调用点，是为了以后新增伤害源
   * 时不用再记得补一遍判断。旁观模式同理：观察者不该被世界碰伤。 */
  if (mode !== MODE.SURVIVAL) return -1;
  p.hp = Math.max(0, p.hp - n);
  p.hurtFlash = 0.42;
  if (onHurt) onHurt(n);
  if (p.hp <= 0) die(reason);
  return p.hp;
}
export function heal(n) {
  const p = player;
  if (p.dead) return;
  p.hp = Math.min(p.maxHp, p.hp + n);
}
export function die(reason) {
  const p = player;
  if (p.dead) return;
  p.dead = true;
  p.fallPeak = null;
  deathReason = reason || '';
  if (onDeath) onDeath(deathReason);
}
/* 复活：回到出生点、数值全满。物品保留（不做掉落惩罚，避免劝退） */
export function respawn() {
  const p = player;
  p.hp = p.maxHp; p.food = p.maxFood; p.air = p.maxAir;
  p.dead = false; p.fallPeak = null; p.exhaust = 0;
  p.drownT = p.lavaT = p.cactusT = p.regenT = p.starveT = 0;
  p.hurtFlash = 0;
  p.x = p.spawn[0]; p.y = p.spawn[1]; p.z = p.spawn[2];
  p.vx = p.vy = p.vz = 0;
}

/* 吃东西：返回是否真的吃到了 */
export function tryEat(id) {
  const d = ITEMS[id];
  const p = player;
  if (!d || !d.food || p.dead) return false;
  if (p.food >= p.maxFood) return false;
  if (!invTake(id, 1)) return false;
  p.food = Math.min(p.maxFood, p.food + d.food);
  return true;
}

/* --- 掉落 --- */
/* 破坏方块后进背包。bonus 是概率掉落（树叶掉苹果）。
 * roll 参数是为了让测试能确定性地驱动概率分支。 */
export function collectDrop(id, roll = Math.random) {
  const B = BLOCKS[id];
  if (!B) return 0;
  const got = dropOf(id);
  if (got) invAdd(got, dropCountOf(id));
  if (B.bonus && roll() < B.bonus.p) invAdd(B.bonus.id, B.bonus.n || 1);
  return got;
}

/* --- 每帧推进生存状态。创造模式只维护受伤红屏，其余直接跳过 --- */
export function updateSurvival(dt, input) {
  const p = player;
  p.hurtFlash = Math.max(0, p.hurtFlash - dt);
  if (mode !== MODE.SURVIVAL || p.dead) return;

  // 坠落伤害：记录离地后的最高点，落地时用它减去落点
  if (p.fly || p.inWater || p.inLava) p.fallPeak = null;
  else if (p.onGround) {
    if (p.fallPeak !== null) {
      const d = p.fallPeak - p.y;
      if (d > SURV.fallSafe) hurt(Math.min(20, Math.floor(d - SURV.fallSafe) + 1), '你摔死了');
      p.fallPeak = null;
    }
  } else if (p.fallPeak === null) p.fallPeak = p.y;
  else if (p.y > p.fallPeak) p.fallPeak = p.y;

  // 溺水：只有头部没入水中才消耗氧气
  const headId = getEffective(Math.floor(p.x), Math.floor(p.y + EYE), Math.floor(p.z));
  if (headId === I.WATER) {
    p.air -= dt;
    if (p.air <= 0) {
      p.air = 0;
      p.drownT += dt;
      if (p.drownT >= SURV.drownDelay) { p.drownT = 0; hurt(SURV.drownDps, '你溺水了'); }
    }
  } else {
    p.air = Math.min(p.maxAir, p.air + dt * SURV.airRefill);
    p.drownT = 0;
  }

  // 岩浆
  if (p.inLava) {
    p.lavaT += dt;
    if (p.lavaT >= SURV.lavaTick) {
      p.lavaT = 0;
      // lavaDps 是「每秒」伤害，这里按 tick 周期折算 —— 直接拿它当每次伤害的话
      // 实际是 4 / 0.5s = 8 点/秒，满血 2.5 秒烧死，根本来不及游出来
      hurt(SURV.lavaDps * SURV.lavaTick, '你被岩浆吞没了');
    }
  } else p.lavaT = 0;

  // 接触伤害方块（仙人掌；以后加别的只需给它标 hurt）
  const hx0 = Math.floor(p.x - PW), hx1 = Math.floor(p.x + PW - 1e-6);
  const hy0 = Math.floor(p.y),      hy1 = Math.floor(p.y + 1.8 - 1e-6);
  const hz0 = Math.floor(p.z - PW), hz1 = Math.floor(p.z + PW - 1e-6);
  let touched = 0;
  for (let y = hy0; y <= hy1 && !touched; y++)
    for (let z = hz0; z <= hz1 && !touched; z++)
      for (let x = hx0; x <= hx1; x++) {
        const B = BLOCKS[getEffective(x, y, z)];
        if (B && B.hurt) { touched = B.hurt; break; }
      }
  if (touched) {
    p.cactusT += dt;
    if (p.cactusT >= SURV.cactusTick) { p.cactusT = 0; hurt(touched, '你被仙人掌扎死了'); }
  } else p.cactusT = 0;

  // 饥饿：静止也会慢慢消耗，跑动快得多
  const moving = !!(input.f || input.b || input.l || input.r);
  if (!p.fly) {
    p.exhaust += dt * (input.sprint && moving ? SURV.exhaustRun : moving ? SURV.exhaustWalk : SURV.exhaustIdle);
    while (p.exhaust >= SURV.exhaustPerFood) {
      p.exhaust -= SURV.exhaustPerFood;
      p.food = Math.max(0, p.food - 1);
    }
  }

  // 吃饱了慢慢回血（会额外消耗饥饿，形成「吃 → 回血 → 更饿」的循环）
  if (p.food >= SURV.regenFood && p.hp < p.maxHp) {
    p.regenT += dt;
    if (p.regenT >= SURV.regenInterval) {
      p.regenT = 0;
      heal(1);
      p.exhaust += SURV.regenCost;
    }
  } else p.regenT = 0;

  // 饿死
  if (p.food <= 0) {
    p.starveT += dt;
    if (p.starveT >= SURV.starveInterval) { p.starveT = 0; hurt(1, '你饿死了'); }
  } else p.starveT = 0;
}

/* --- 按硬度计时的挖掘 ---
 * 创造模式是瞬破（沿用 doBreak），生存模式要按住左键挖满时长。 */
export const dig = { on: false, x: 0, y: 0, z: 0, t: 0 };
/* 返回 0~1 的进度，供准星进度环使用 */
export function digProgress() {
  if (!dig.on) return 0;
  const bt = breakTime(getEffective(dig.x, dig.y, dig.z));
  if (!Number.isFinite(bt) || bt <= 0) return 0;
  return clamp(dig.t / bt, 0, 1);
}
export function cancelDig() { dig.on = false; dig.t = 0; }

/* 推进挖掘进度。hit 为当前准星目标；返回「本帧挖穿的方块」或 null。 */
export function updateDig(dt, hit) {
  if (mode !== MODE.SURVIVAL) { cancelDig(); return null; }
  if (!hit) { cancelDig(); return null; }
  const bt = breakTime(hit.id);
  if (!Number.isFinite(bt) || bt <= 0) { cancelDig(); return null; }   // 液体：挖不动
  if (!dig.on || dig.x !== hit.x || dig.y !== hit.y || dig.z !== hit.z) {
    dig.on = true; dig.x = hit.x; dig.y = hit.y; dig.z = hit.z; dig.t = 0;
  }
  dig.t += dt;
  if (dig.t < bt) return null;
  cancelDig();
  return hit;
}
