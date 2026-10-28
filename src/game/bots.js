/* AI 玩家：会挖矿盖房打怪的 NPC —— 迁移自 voxel-craft.html 第 7452-8229 行 */

import { MODE, mode, setHandSwing, setSwingT, swingT } from './state.js'
import { spawnParticles } from './actions.js'
import { blip } from './audio.js'
import { BLOCKS, D, EYE, G, H, I, REACH_ATTACK, attackDamage, breakTime, dropCountOf, dropOf, isBlockId } from './config.js'
import { getEffective, isLiquid, isSolid, setBlock } from './generate.js'
import { RECIPES, recipeMatrix } from './crafting.js'
import { keys } from './input.js'
import { MOB_TYPES, damageMob, isNight, mobs, rayBox, raycastMob, registerBots } from './mobs.js'
import { moveBodyAxis, player } from './player.js'
import { portalIdInBox } from './portal.js'
import { hurt, invAdd } from './survival.js'
import { toast } from './uiState.js'

/* ============================== AI 玩家 ==============================
 * 一群「行为像玩家」的 NPC：会走会跳、会挖方块采集、会放方块盖房、
 * 会挥武器打怪，被你打了会还手，被打死会把自己背上的东西全掉出来。
 *
 * ⚠⚠ **绝对不能把它们塞进 mobs 数组**。
 * mobs 那一侧的 mobRng 消费序列被回归测试用 scripted RNG 逐项钉死了
 * （白天几次、夜里几次、什么顺序），多一个调用点就让上百条断言集体漂移；
 * 而 mobs 的语义也是「怪物」——AI 玩家要有名字、背包、中立立场和掉落，
 * 这些字段挂在 MOB_TYPES 上会把怪物表的语义搅浑。所以是独立数组 + 独立表。
 *
 * 数据与本段其余部分的关系：
 *   botAI      状态机（闲逛 / 采集 / 建造 / 战斗 / 逃命），纯逻辑、无 DOM
 *   botPhysics 复用 moveBodyAxis —— 和生物、玩家同一套 AABB 扫掠
 *   渲染在 WebGL 段的 drawBots（靠 uTint 逐部件染色，网格只有一份）
 *   名字标签在界面段（DOM 覆盖层，需要投影矩阵） */

export const BOT_CAP = 10;                    // 同屏上限（用户要的是 8~10 个）
export const BOT_MIN = 8;                     // 低于这个数就补人
export const BOT_KEEP = 68;                   // 走远到这个距离就回收（比生物的 48 宽，
                                       //   名字标签在 48 格外已经糊成一团了）
export const BOT_SPAWN_MIN = 26, BOT_SPAWN_MAX = 54;   // 别在眼皮底下凭空冒出来
export const BOT_H = 1.8, BOT_W = 0.6;        // 碰撞箱：和玩家几乎一样（PW=0.30）
export const BOT_BAG_CAP = 40;                // 背包「种类」上限（数量不限）。放宽到 40，
                                       //   让它们能同时带着木板/石头/工具/火把，掉落更丰富

/* 名字池：中文网名 + 英文 ID 混排，比「玩家1/玩家2」有生气得多。
 * 刻意不带真实人名/谐音梗 —— 随机撞上现实里某个人的 ID 不太厚道。 */
export const BOT_NAMES = [
  '阿岩', '小满', '木子', '石头', '半糖', '夜航', '拾光', '云吞',
  '青柠', '布丁', '麦芒', '铁蛋', '山雀', '杏仁', '土豆', '风铃',
  'steve_j', 'nova_k', 'pixel_9', 'lava_boi', 'oak_king', 'red_panda',
  'cobalt', 'mossy', 'quartz', 'drift', 'ember_x', 'tidal',
];

/* 上衣配色：饱和度拉开的几组，让 8~10 个人在人群里一眼能互相区分。
 * 存的是「乘性 tint」，因为 bot_shirt 贴图本身是接近中性的浅色调。 */
export const BOT_SHIRTS = [
  [0.30, 0.52, 0.92], [0.92, 0.36, 0.34], [0.36, 0.72, 0.42], [0.94, 0.72, 0.24],
  [0.74, 0.40, 0.86], [0.24, 0.72, 0.78], [0.94, 0.52, 0.70], [0.52, 0.56, 0.66],
  [0.86, 0.86, 0.90], [0.40, 0.44, 0.30],
];
export const BOT_SKINS = [
  [0.98, 0.84, 0.72], [0.92, 0.74, 0.60], [0.80, 0.62, 0.48], [0.62, 0.46, 0.34],
];
export const BOT_HAIRS = [
  [0.26, 0.18, 0.12], [0.62, 0.46, 0.22], [0.86, 0.78, 0.30], [0.90, 0.90, 0.92],
];

/* 人形网格的部件表（一次建成，所有人共用）。
 * at / box 的数值沿用僵尸那套比例：总高 1.8、脚在 y=0、头顶约 1.8。
 * tint 字段标明该部件用哪套配色 —— 绘制时逐部件设 uTint，
 * 于是「一个人六个部件四种颜色」不需要第二份网格。 */
export const BOT_PARTS = [
  { box: [0.52, 0.66, 0.28], at: [0, 1.22, 0],    tex: 'bot_shirt', tint: 'shirt' },
  { box: [0.46, 0.46, 0.46], at: [0, 1.62, 0],    tex: 'bot_skin',  tint: 'skin'  },
  { box: [0.49, 0.20, 0.49], at: [0, 1.80, 0],    tex: 'bot_hair',  tint: 'hair'  },
  /* 眼睛/嘴是贴在脸前的薄片，而不是画进 bot_skin：
   * 画进皮肤的话，深肤色的 AI 玩家连眼睛一起被 tint 染深，五官糊成一团
   * （这坑在怪物贴图上踩过：蜘蛛眼与底色同色，整块看着像块红板）。
   *
   * ⚠⚠ z 必须**大于**头的半深 0.23 + 薄片半厚 0.01 = 0.24，取 0.255。
   * 早先写在 0.24 —— 正好与头的前表面共面，两块薄片整个埋进头里，
   * 正面拍过去就是一张没有五官的脸（截图抓到的，无头断言全绿也照样错）。
   * 往外挪 0.015 才是「贴在脸上」而不是「嵌进脸里」。 */
  { box: [0.11, 0.11, 0.02], at: [-0.11, 1.66, 0.255], tex: 'bot_eye', tint: 'eye' },
  { box: [0.11, 0.11, 0.02], at: [ 0.11, 1.66, 0.255], tex: 'bot_eye', tint: 'eye' },
  { box: [0.20, 0.05, 0.02], at: [0, 1.53, 0.255], tex: 'bot_eye', tint: 'eye' },   // 嘴
  { box: [0.16, 0.58, 0.16], at: [-0.33, 1.28, 0.02], tex: 'bot_skin',  tint: 'skin',  arm: 1 },
  { box: [0.16, 0.58, 0.16], at: [ 0.33, 1.28, 0.02], tex: 'bot_skin',  tint: 'skin',  arm: 2 },
  { box: [0.19, 0.90, 0.19], at: [-0.13, 0.45, 0],    tex: 'bot_pants', tint: 'pants', leg: 1 },
  { box: [0.19, 0.90, 0.19], at: [ 0.13, 0.45, 0],    tex: 'bot_pants', tint: 'pants', leg: 2 },
];

export const bots = [];
export const botRng = Math.random;             // 单独一条随机源，绝不借 mobRng

/* 出生点：找一块「脚下实心 + 头两格空」的地面。找不到就返回 null（跳过这一轮）。 */
export function botGroundY(x, z, yRef) {
  for (let d = 0; d <= 14; d++) {
    for (const y of [yRef - d, yRef + d]) {
      if (y < 2 || y > H - 3) continue;
      const g = getEffective(x, y, z);
      if (!isSolid(g) || isLiquid(g)) continue;
      if (isSolid(getEffective(x, y + 1, z)) || isSolid(getEffective(x, y + 2, z))) continue;
      return y + 1;
    }
  }
  return -1;
}

/* 造一个人。name 缺省时从名字池里随机取一个（避让已在场的人）。 */
export function spawnBot(x, y, z, name) {
  installBotHook();                              // 幂等；见文件末尾的说明
  if (bots.length >= BOT_CAP) return null;
  const taken = new Set(bots.map(b => b.name));
  let nm = name;
  if (!nm) {
    const free = BOT_NAMES.filter(n => !taken.has(n));
    if (!free.length) return null;                 // 名字用光了就不加了
    nm = free[Math.floor(botRng() * free.length) % free.length];
  }
  const b = {
    name: nm,
    x, y, z, vx: 0, vy: 0, vz: 0,
    yaw: botRng() * Math.PI * 2, pitch: 0,
    onGround: false, inWater: false,
    hp: 20, maxHp: 20, food: 20,
    hurtFlash: 0, dead: false, animT: botRng() * 6,
    /* 受伤后的「禁疗时间」。之前它们身上挂着三路回血（吃东西 5/s、
     * 到家 2.5/s、每 3.5 秒 +1），而僵尸一秒才打 3 点 —— 回血比掉血快，
     * 打半天血条纹丝不动，看起来就像「AI 玩家根本不会受伤」。
     * 现在挨一下之后 6 秒内一滴血都回不了，伤害才留得住。 */
    regenBlockT: 0,
    /* 配色：skin/shirt/pants/hair 四套，eye 固定黑白不吃 tint */
    col: {
      skin:  BOT_SKINS[Math.floor(botRng() * BOT_SKINS.length) % BOT_SKINS.length],
      shirt: BOT_SHIRTS[Math.floor(botRng() * BOT_SHIRTS.length) % BOT_SHIRTS.length],
      pants: [0.30 + botRng() * 0.3, 0.30 + botRng() * 0.3, 0.34 + botRng() * 0.3],
      hair:  BOT_HAIRS[Math.floor(botRng() * BOT_HAIRS.length) % BOT_HAIRS.length],
      /* 眼睛/嘴：白底贴图 × 这个深 tint = 想要的黑。给一点点暖调，
       * 纯黑在深色头发边上会糊成一片。 */
      eye:   [0.30, 0.24, 0.26],
    },
    /* 背包：id → 数量。采集会往里塞，建造从里面拿，死亡全掉出来。 */
    bag: new Map(),
    bagCap: BOT_BAG_CAP,       // 背包「种类」上限，满了就不再采集新种类
    home: [x, y, z],            // 认家：白天出去干活，天黑往家走
    state: 'idle',              // idle / gather / build / craft / fight / flee / home
    stateT: 0,
    think: 0,                   // 决策节流：不是每帧都重新想
    goal: null,                 // { x, y, z } 当前目标点
    target: null,               // 当前盯着的方块坐标（采集用）
    digT: 0,                    // 挖掘累计进度（秒）
    digId: 0,                   // 正在挖的那个方块 id（中途被换掉要作废）
    atkT: 0,                    // 挥击冷却
    swingT: 0,                  // 手臂动画（渲染用）
    /* 建房蓝图：一次规划、分多次执行（建材不够就先去采集，回来接着盖）。 */
    buildPlan: null,            // 待建格子的有序列表（按 y 升序）
    buildIdx: 0,                // 当前盖到第几个
    buildOrigin: null,          // [ox, oy, oz] 地基角
    buildCd: 0,                 // 两座房子之间的冷却（秒），避免它们把世界盖满
    /* ⚠ 起跳冷却：台阶跳跃**必须**有它。没有它会自锁成「每帧垂直起跳」——
     * 撞墙时水平速度被moveBodyAxis 归零，下一帧 botWalkTo 又填满再撞一次，
     * 于是「撞→跳→悬空→还判定要跳」无限循环，人钉在台阶前上下颠（每秒 74 次）。 */
    hopCd: 0,
    angryT: 0,                  // 被玩家打了之后追击的剩余时间
    healT: 0,
    speak: 0, speakCd: 6 + botRng() * 10,     // 头顶冒话
  };
  bots.push(b);
  return b;
}

/* 背包操作（和玩家的 inv 同构但独立，互不串味） */
export function botBagAdd(b, id, n = 1) {
  if (!id || n <= 0 || b.bag.size >= b.bagCap) return false;
  b.bag.set(id, (b.bag.get(id) || 0) + n);
  return true;
}
export function botBagCount(b, id) { return b.bag.get(id) || 0; }
export function botBagTake(b, id, n = 1) {
  const c = b.bag.get(id) || 0;
  if (c < n) return false;
  if (c === n) b.bag.delete(id); else b.bag.set(id, c - n);
  return true;
}

/* 受伤：会还手。knock 是击退方向（可省）。 */
export function damageBot(b, n, kx, kz, fromPlayer) {
  if (b.dead || n <= 0) return 0;
  b.hp = Math.max(0, b.hp - n);
  b.hurtFlash = 0.35;
  /* 挨打之后禁疗 6 秒 —— 否则「吃东西回 5/s」比僵尸的 3/s 还快，
   * 血条永远不动，玩家会以为 AI 玩家是无敌的。 */
  b.regenBlockT = 6;
  if (fromPlayer) {
    b.angryT = 14;                             // 记你一笔，追你 14 秒
    b.speak = 1.4; b.speakMsg = '喂！';
  }
  if (kx !== undefined) { b.vx += kx * 5.0; b.vz += kz * 5.0; b.vy = Math.max(b.vy, 3.0); }
  if (b.hp <= 0) killBot(b);
  return b.hp;
}
export function healBot(b, n) { b.hp = Math.min(b.maxHp, b.hp + n); }

/* 死亡：背包全掉 + 冒一句话。
 * ⚠ 掉落实体必须在**清空 bag 之前**算出来：botDropBag 只读不删，
 * 这里先拿它落地再清 —— 顺序反了就会「清空后掉落 0 个」。
 * 背包里有方块的话额外还你几块石料（空手打人总得有点代价感）。 */
export function killBot(b) {
  if (b.dead) return;
  b.dead = true;
  b.speak = 1.6; b.speakMsg = '呜哇——';
  if (!b.silent) {
    const loot = new Map(b.bag);
    if (loot.size === 0) {
      // 空手被打死的也给点「像样」的东西，不然玩家会觉得「白打了一架」
      loot.set(I.PLANK, 3 + Math.floor(botRng() * 4));            // 木板 3~6
      if (botRng() < 0.4) loot.set(I.TORCH, 4 + Math.floor(botRng() * 5)); // 偶尔附赠火把
    }
    // 击杀奖励：让「打一架」更有收益——包里没有武器就 35% 送一把木剑
    let hasWeapon = false;
    for (const [id] of loot)
      if (id === I.SWORD_WOOD || id === I.SWORD_STONE || id === I.SWORD_IRON ||
          id === I.PICK_WOOD  || id === I.PICK_STONE  || id === I.PICK_IRON) { hasWeapon = true; break; }
    if (!hasWeapon && botRng() < 0.35) loot.set(I.SWORD_WOOD, 1);
    botDropBag(b, loot);
    b.bag.clear();
  }
  if (typeof spawnParticles === 'function')
    for (let i = 0; i < 6; i++) spawnParticles(b.x, b.y + 0.5 + i * 0.3, b.z, b.col.shirt.map(c => Math.round(c * 255)));
}

/* ---------------- AI 物理：与玩家 / 生物同一套 AABB 扫掠 ---------------- */
export function botPhysics(b, dt) {
  const hw = BOT_W / 2;
  const feet = getEffective(Math.floor(b.x), Math.floor(b.y + 0.1), Math.floor(b.z));
  const inWater = feet === I.WATER;
  b.inWater = inWater;

  /* 岩浆 / 仙人掌会持续掉血 —— AI 玩家也会被环境杀死（然后掉物资） */
  if (BLOCKS[feet] && BLOCKS[feet].hot) damageBot(b, 9 * dt);
  if (feet === I.CACTUS) damageBot(b, 2 * dt);
  if (b.dead) return;

  const wasGround = !!b.onGround;
  if (inWater) {
    b.vy -= 4 * dt;
    b.vy = Math.max(b.vy, 1.4);
  } else {
    const footY = Math.floor(b.y - 0.02);
    let grounded = false;
    const x0 = Math.floor(b.x - hw), x1 = Math.floor(b.x + hw - 1e-6);
    const z0 = Math.floor(b.z - hw), z1 = Math.floor(b.z + hw - 1e-6);
    for (let z = z0; z <= z1 && !grounded; z++)
      for (let x = x0; x <= x1; x++)
        if (isSolid(getEffective(x, footY, z))) { grounded = true; break; }
    if (grounded && b.vy <= 0.01) {
      b.y = footY + 1; b.vy = 0; b.onGround = true;
    } else {
      b.vy -= G * dt;
      b.vy = Math.max(b.vy, -32);
      b.onGround = false;
      moveBodyAxis(b, hw, BOT_H, 'y', b.vy * dt);
    }
  }

  /* ⚠ 朝向必须在扫掠**之前**存：moveBodyAxis 一撞墙就把该轴速度归零，
   * 之后 Math.sign(b.vx) 恒为 0，前方探测会退化成「自己所在格」（同上，生物那边踩过）。 */
  const dirVX = b.vx, dirVZ = b.vz;
  const hitX = moveBodyAxis(b, hw, BOT_H, 'x', b.vx * dt);
  const hitZ = moveBodyAxis(b, hw, BOT_H, 'z', b.vz * dt);

  /* 撞墙：一格台阶跳过去；两格以上（面前有整面墙）就换个方向绕。
   * 不会跳的情形一律「转身」而不是死顶 —— 顶着墙抖动最像卡 bug。
   *
   * ⚠⚠ 这里必须加 `hopCd` 冷却，否则会变成**每帧垂直起跳的原地蹦**：
   * 玩家/BOT 的速度是每帧重新朝目标累加的（botWalkTo），撞墙归零后下一帧
   * 又被填满 → 「撞墙 → 起跳 → 悬空 → 下一帧仍然判定要跳」自锁，
   * 人就钉在台阶前上下颠，位移恒为 0（实测每秒 74 次起跳）。
   * 这跟生物那边MOB_HOP_V 的教训是同一类：起跳是**离地事件**，
   * 不能在没有新输入的情况下每帧重复触发。 */
  /* ⚠ 用 `(b.hopCd || 0) - dt` 而不是 `b.hopCd -= dt`：无头测试会拿裸对象
   * 直接调 botPhysics，字段缺失时 `-= NaN`，冷却永远 <= 0 成立 → 又变回每帧起跳。
   * 与生物那边m.hopCd 的写法保持一致。 */
  b.hopCd = (b.hopCd || 0) - dt;
  if ((hitX || hitZ) && b.onGround && !inWater && b.hopCd <= 0) {
    const hy = Math.floor(b.y);
    const dirX = hitX ? Math.sign(dirVX) : 0, dirZ = hitZ ? Math.sign(dirVZ) : 0;
    const ax = Math.floor(b.x + dirX * (hw + 0.22)), az = Math.floor(b.z + dirZ * (hw + 0.22));
    const low = getEffective(ax, hy, az), up = getEffective(ax, hy + 1, az);
    if (isSolid(low) && !isSolid(up) && !isSolid(getEffective(ax, hy + 2, az))) {
      /* 一格台阶：给一个**够得上去**的初速。
       * ⚠⚠ 别学生物那边的MOB_HOP_V 往下调 —— 跳高是 v²/(2G)，
       * 7.2 恰好只有 0.997 格，差 0.003 跨不上 1 格台阶（实测卡在 0.5 格
       * 上不去、每0.45 秒重跳一次，看着就是「原地蹦」）。
       * 给 8.0 → 跳高 1.23 格，留两成余量；玩家是 9.0（1.56 格）。 */
      b.vy = 8.0;
      b.vx = dirVX; b.vz = dirVZ;
      b.onGround = false;
      /* 冷却要给够**滞空 + 落地站稳**的整段时间：滞空 2×8/26 ≈ 0.62s，
       * 只给 0.45 的话落地瞬间冷却已过 → 立刻又撞下一级又跳，
       * 一段斜坡能跳出十几次（实测 14 次/6.5 秒）。0.9s ≈ 滞空 + 站稳余量。 */
      b.hopCd = 0.9;
    } else {
      b.yaw += (botRng() < 0.5 ? 1 : -1) * (1.1 + botRng() * 0.9);
      b.goal = null;                              // 作废当前目标，重新挑
    }
  }

  /* 悬崖：前方 1 格没有脚下地面就停下/转向。AI 玩家不会跳崖自杀。
   * ⚠ 必须把「一格台阶」和「真悬崖」分开：台阶那一列的**脚下格是空的**
   * （地面在更高一层），只判 `!isSolid(fx, fy, fz)` 会把它当成悬崖 →
   * 撞上台阶的每一帧都触发一次大角度转向，走一步歪一次（实测 400 帧才挪 1.8 格）。
   * 台阶的判据是「脚同高的那一格有方块、而它上面是空的」，也就是能跳上去的那种。 */
  if (b.onGround && !inWater && (hitX || hitZ)) {
    const dirX = hitX ? Math.sign(dirVX) : 0, dirZ = hitZ ? Math.sign(dirVZ) : 0;
    const fx = Math.floor(b.x + dirX * (hw + 0.5)), fz = Math.floor(b.z + dirZ * (hw + 0.5));
    const fy = Math.floor(b.y - 1);
    const openBelow = !isSolid(getEffective(fx, fy, fz));
    /* 能跳上去的一格台阶：脚同高那格实心、再上一格空→ 让撞墙分支去处理，别抢着转身 */
    const steppable = openBelow && isSolid(getEffective(fx, fy + 1, fz))
                                && !isSolid(getEffective(fx, fy + 2, fz));
    if (openBelow && !steppable && !isSolid(getEffective(fx, fy - 1, fz)))
      b.yaw += 1.4 + botRng() * 0.8;
  }

  const onG = b.onGround || wasGround;
  /* ⚠⚠ 地面摩擦**必须比botWalkTo 的每帧加速更快衰减不了**，否则速度被锁死：
   * 平衡点是 `目标速 × k / (1 - 摩擦)`，k = 6·dt ≈ 0.1、摩擦 0.80
   * → 终速 = 1.4 × 0.1 / 0.20 = **0.7 格/秒**（实测只有 0.46）。
   * 走这么慢的直接后果不是「慢」，而是**看起来一跳一跳**：
   * 每秒挪不到半格 → 三步一撞墙 → 三步一起跳，玩家看着像原地蹦。
   * 生物那边是0.86 + 更强的驱动，所以僵尸走得正常（别拿AI 的数去对齐生物）。
   * 这里给 0.90：终速 ≈ 目标速的 8~9 成，脚步能连贯起来。 */
  b.vx *= onG ? 0.90 : 0.97;
  b.vz *= onG ? 0.90 : 0.97;
  if (b.y < -8) { b.dead = true; b.silent = true; }   // 掉出世界：静默消失，不掉物资
}

/* 朝目标走：返回一个「还差多远」。已到位返回 true。 */
export function botWalkTo(b, tx, tz, speed, dt) {
  const dx = tx - b.x, dz = tz - b.z;
  const d = Math.hypot(dx, dz);
  if (d < 0.6) return true;
  /* ⚠ 驱动强度 k 决定终速：稳态时 `k·(目标 - v) = 摩擦衰减量`，
   * 所以 `v终 ≈ 目标 × k / (1 - 摩擦)`。原来 k = 6·dt ≈ 0.1、摩擦 0.80
   * → 只能到目标速的 **28%**（实测目标 1.4、实走 0.46 格/秒）。
   * 走太慢的观感后果不是「慢」而是「一跳一跳」：每秒挪不到半格，
   * 三步一撞墙、三步一起跳。给 30·dt（@60fps ≈ 0.5）+ 摩擦 0.90，
   * 终速约为目标的 **九成**，脚步才连得起来（实测目标 1.4 → 走 1.3）。 */
  const k = Math.min(1, 30 * dt);
  b.vx += (dx / d * speed - b.vx) * k;
  b.vz += (dz / d * speed - b.vz) * k;
  /* 朝向用 atan2(dx, dz) 而不是 +π：模型正脸建在 +z，
   * 而 botAI 的转向语义和生物那边一致（yaw=0 → +z）。 */
  b.yaw = Math.atan2(dx, dz);
  return false;
}

/* 往前看一格是什么方块（采集/建造的目标探测）。 */
export function botLook(b, dist = 1) {
  const dx = Math.sin(b.yaw), dz = Math.cos(b.yaw);
  const x = Math.floor(b.x + dx * dist), z = Math.floor(b.z + dz * dist);
  const y = Math.floor(b.y + 0.9);
  return { x, y, z, id: getEffective(x, y, z) };
}

/* ---------------- AI 状态机 ----------------
 * 每 bot.think 秒才重新想一次「现在该干什么」，中间帧只执行当前状态。
 * 没有这层节流的话 10 个人 × 60 帧 的邻近扫描会很浪费，
 * 而且行为会变成每秒抖一次的抽搐。 */
export function botDecide(b) {
  b.stateT = 0;

  /* 优先级从高到低：
   *   1. 被打了 → 追着还手（有限时间，怒气会消）
   *   2. 血少且背包有吃的 → 停下来吃
   *   3. 身边有敌对生物 → 打它（中立不等于任人宰割）
   *   4. 血少 → 回家疗伤
   *   5. 天黑/离家太远 → 回家
   *   6. 背包有方块 → 盖房
   *   7. 背包没满 → 采集
   *   8. 以上都不是 → 闲逛 */
  if (b.angryT > 0) { b.state = 'fight'; b.target = 'player'; return; }
  if (b.hp < b.maxHp * 0.55 && b.food > 6) { b.state = 'eat'; return; }
  const foe = botNearestFoe(b, 9);
  if (foe) { b.state = 'fight'; b.target = 'mob'; b.foe = foe; return; }
  if (b.hp < b.maxHp * 0.45) { b.state = 'home'; b.speakMsg = '得回家上药…'; return; }
  if (isNight() && Math.hypot(b.x - b.home[0], b.z - b.home[2]) > 26) { b.state = 'home'; return; }
  /* 手上有值得合成原料（木头/铁矿/圆石/煤）→ 先做工具/火把，把原料变强 */
  if (botCanCraft(b)) { b.state = 'craft'; return; }
  /* 有蓝图在盖、或攒够了建材 → 盖房（蓝图是一次性规划，断点续盖不受冷却限制） */
  if (b.buildPlan || botHasBuildBlock(b)) { b.state = 'build'; return; }
  if (b.bag.size < b.bagCap && botFindOre(b)) { b.state = 'gather'; return; }
  b.state = 'idle';
  b.goal = null;
  b.yaw += (botRng() - 0.5) * 1.2;
}

/* 附近有没有该打的敌对生物（只看 hostile，傀儡和被动生物不算）。 */
export function botNearestFoe(b, range) {
  let best = null, bd = range;
  for (const m of mobs) {
    if (m.dead || !MOB_TYPES[m.type].hostile) continue;
    if (Math.abs(m.y - b.y) > 8) continue;
    const d = Math.hypot(m.x - b.x, m.z - b.z);
    if (d < bd) { bd = d; best = m; }
  }
  return best;
}

/* 采集：找一块「值得挖」的方块。优先木头（盖房要），
 * 再是石头/泥土这类建材。树叶不挖（挖了就没树了）。
 * ⚠ 这里只登记**建材**和**木头**，不登记矿石/树叶/草方块：十个 AI 玩家
 * 满世界乱挖会把玩家的树全砍光、地面全刨坑，看着像世界在自己长痘。 */
export const BOT_WANT = { };
export function botInitWant() {
  const want = [
    /* ⚠ 刻意**不**收 DIRT（泥土）：早先它们把挖来的泥土随手垒成小柱子，
     * 满世界都是突兀的土堆，看着像「乱摆」。现在只采「像建材」的东西，
     * 而且建造时（botPickBuildBlock）也只认建材，泥土绝不会被摆出来。
     * SAND 保留：它能合成玻璃 / 沙岩，是像样的装饰建材；且建造白名单已排除沙子。 */
    I.LOG, I.PLANK, I.STONE, I.COBBLE, I.SAND, I.STICK, I.COAL, I.IRON,
    I.GLASS, I.BRICK, I.STONEBRICK, I.WOOL_WHITE,
  ];
  for (const id of want) if (id !== undefined && !BOT_WANT[id]) BOT_WANT[id] = 1;
}
botInitWant();

/* ============================== AI 玩家：合成 ==============================
 * 让它们会「把原料做成更强的东西」——木头→木板→木棍→工具，煤+木棍→火把。
 * 复用 crafting.js 的**单一配方源**（RECIPES + recipeMatrix），形状与玩家合成
 * 完全一致，不会自己另写一套导致和玩家配方漂移。
 *
 * ⚠ 木棍不在外面单独列：只在「要造工具但缺木棍」时才临时用木板搓 4 根，
 * 否则会把攒来盖房的木板全变成木棍（那个坑踩过一次）。 */
const BOT_CRAFT_OUT = [
  I.PLANK,                                                     // 木头永远转木板（更省种类、也是建材）
  I.PICK_WOOD, I.SWORD_WOOD, I.AXE_WOOD,                       // 木级工具（入门）
  I.PICK_STONE, I.SWORD_STONE, I.AXE_STONE,                    // 石级（圆石+木棍）
  I.PICK_IRON, I.SWORD_IRON, I.AXE_IRON,                       // 铁级（铁矿+木棍）—— 更强
  I.TORCH,                                                     // 火把（煤+木棍）：装饰/光源，最后才考虑
];
/* 预编译每条配方的「材料需求」（id → 数量），避免每次匹配重算矩阵。 */
export const BOT_CRAFT_RECIPES = [];
for (const out of BOT_CRAFT_OUT) {
  const r = RECIPES.find(x => x.out === out);
  if (!r) continue;
  const m = recipeMatrix(r.grid);
  const need = new Map();
  for (let rr = 0; rr < 3; rr++) for (let cc = 0; cc < 3; cc++) { const v = m[rr][cc]; if (v) need.set(v, (need.get(v) || 0) + 1); }
  BOT_CRAFT_RECIPES.push({ out, n: r.n, need });
}

/* 试着合成一件东西（每次调用最多做成一件）。成功返回 true。
 * 顺序即优先级：先消耗木头出木板，再逐级做工具，最后才做火把。 */
export function botTryCraftOnce(b) {
  for (const r of BOT_CRAFT_RECIPES) {
    if (r.out === I.PLANK) {
      if (botBagCount(b, I.LOG) >= 1) { botBagTake(b, I.LOG, 1); botBagAdd(b, I.PLANK, 4); return true; }
      continue;
    }
    if (r.out === I.TORCH) {
      // 火把是「锦上添花」，工具齐了、且手头刚好有煤和木棍才做
      if (botBagCount(b, I.COAL) >= 1 && botBagCount(b, I.STICK) >= 1 && botBagCount(b, I.TORCH) < 8) {
        botBagTake(b, I.COAL, 1); botBagTake(b, I.STICK, 1); botBagAdd(b, I.TORCH, 4); return true;
      }
      continue;
    }
    // 工具：已经有了就不重复造（升级逻辑自然覆盖——有木镐后才会去凑石/铁）
    if (botBagCount(b, r.out) > 0) continue;
    // 工具要木棍：不够就先用木板搓 4 根（仅当这件工具确实能造出来）
    const stickNeed = r.need.get(I.STICK) || 0;
    if (stickNeed > 0 && botBagCount(b, I.STICK) < stickNeed) {
      if (botBagCount(b, I.PLANK) >= 2) { botBagTake(b, I.PLANK, 2); botBagAdd(b, I.STICK, 4); return true; }
      continue;
    }
    let okAll = true;
    for (const [id, n] of r.need) { if (id === I.STICK) continue; if (botBagCount(b, id) < n) { okAll = false; break; } }
    if (!okAll) continue;
    for (const [id, n] of r.need) botBagTake(b, id, n);
    botBagAdd(b, r.out, r.n);
    return true;
  }
  return false;
}
/* 手上还有「值得合成」的原料吗（决定要不要进 craft 状态）。 */
export function botCanCraft(b) {
  return botBagCount(b, I.LOG) > 0 || botBagCount(b, I.IRON) > 0
      || botBagCount(b, I.COBBLE) > 0 || botBagCount(b, I.COAL) > 0;
}

/* ============================== AI 玩家：建造 ==============================
 * 早先的 botBuild 只是「在家旁边垒一根最高 3 格的柱子」—— 满地土堆的来源。
 * 现在改成**真的盖一间小屋**：4×4 地基、3 格高围墙（带门洞）、顶部一圈平顶，
 * 蓝图一次规划、分多次执行（建材不够就先去采，回来接着盖）。
 *
 * 建造只用「建材白名单」里的方块，且**明确排除泥土/沙子/草**，从根本上杜绝
 * 「乱摆泥土块」。 */
export const BOT_BUILD_BLOCKS = [
  I.PLANK, I.DARKPLANK, I.STONEBRICK, I.BRICK, I.COBBLE, I.STONE,
  I.LOG, I.SANDSTONE, I.GLASS, I.WOOL_WHITE,
];
export function botPickBuildBlock(b) {
  for (const id of BOT_BUILD_BLOCKS) if (botBagCount(b, id) > 0) return id;
  return 0;
}
export function botHasBuildBlock(b) { return botPickBuildBlock(b) !== 0; }

const HOUSE_W = 4, HOUSE_D = 4, HOUSE_H = 3;   // 4×4 占地、3 格高墙
export function botStartHouse(b) {
  for (let i = 0; i < 8; i++) {
    const a = botRng() * Math.PI * 2, r = 3 + botRng() * 5;
    const cx = Math.floor(b.home[0] + Math.cos(a) * r);
    const cz = Math.floor(b.home[2] + Math.sin(a) * r);
    const gy = botGroundY(cx, cz, Math.floor(b.y));
    if (gy <= 0) continue;
    // 四角地面高度差 <=1 且上方两格空，才算「平地基」
    let okFoot = true;
    for (const dx of [0, HOUSE_W - 1]) for (const dz of [0, HOUSE_D - 1]) {
      const g2 = botGroundY(cx + dx, cz + dz, gy);
      if (g2 <= 0 || Math.abs(g2 - gy) > 1) { okFoot = false; break; }
    }
    if (!okFoot) continue;
    const ox = cx, oz = cz, oy = gy;
    const plan = [];
    for (let y = oy + 1; y <= oy + HOUSE_H; y++)
      for (let x = ox; x < ox + HOUSE_W; x++)
        for (let z = oz; z < oz + HOUSE_D; z++) {
          const perim = (x === ox || x === ox + HOUSE_W - 1 || z === oz || z === oz + HOUSE_D - 1);
          if (!perim) continue;
          /* 门洞：前墙（z=oz）正中一列整面挖空（通高 3 格），这样门上方的墙块
           * 不会有「下方悬空」的问题；屋顶对应位置也跳过，保持支撑链完整。 */
          if (z === oz && x === ox + 1) continue;
          plan.push({ x, y, z });
        }
    // 平顶环：坐在墙顶上
    const ry = oy + HOUSE_H + 1;
    for (let x = ox; x < ox + HOUSE_W; x++)
      for (let z = oz; z < oz + HOUSE_D; z++) {
        const perim = (x === ox || x === ox + HOUSE_W - 1 || z === oz || z === oz + HOUSE_D - 1);
        if (!perim) continue;
        // 跳过屋顶在门洞正上方那一格（下方无墙顶支撑）
        if (z === oz && x === ox + 1) continue;
        plan.push({ x, y: ry, z });
      }
    // 按 y 升序、同层按离原点距离，保证「从下往上、由近及远」地盖（有支撑）
    plan.sort((p, q) => p.y - q.y || (Math.abs(p.x - ox) + Math.abs(p.z - oz)) - (Math.abs(q.x - ox) + Math.abs(q.z - oz)));
    b.buildPlan = plan; b.buildIdx = 0; b.buildOrigin = [ox, oy, oz];
    return true;
  }
  return false;
}
const BUILD_LINES = ['这间给你留着。', '盖好了，进来坐。', '嘿，新家！', '别踩我的墙。', '窗户还没装…'];
export function pickBuildLine() { return BUILD_LINES[Math.floor(botRng() * BUILD_LINES.length) % BUILD_LINES.length]; }

export function botFindOre(b) {
  const R = 13;
  /* ⚠ 搜索原点必须是**脚下的实心地面**，不能直接用 b.y：
   * 人在半空（刚被爆炸掀起来 / 从高处落下 / 维度入口找点失败停在悬空处）时，
   * 以 b.y 为中心的 ±3~+5 格窗口整个悬在空气里，一样建材都扫不到 ——
   * 于是一个人就在「离地 3 格」的高度上干站，永远处于 gather 决策失败
   * 又立刻重试的循环里。先把原点吸到脚下那块实心方块顶上。 */
  let baseY = Math.floor(b.y);
  if (!isSolid(getEffective(Math.floor(b.x), baseY - 1, Math.floor(b.z)))) {
    const gy = botGroundY(Math.floor(b.x), Math.floor(b.z), baseY);
    if (gy > 0) baseY = gy - 1;
  }
  const x0 = Math.floor(b.x), z0 = Math.floor(b.z);
  let best = null, bd = R * R;
  for (let dy = -3; dy <= 5; dy++) {
    for (let dz = -R; dz <= R; dz += 2) {
      for (let dx = -R; dx <= R; dx += 2) {
        const x = x0 + dx, z = z0 + dz, y = baseY + dy;
        if (y < 1 || y > H - 2) continue;
        const id = getEffective(x, y, z);
        if (!id || !isBlockId(id)) continue;
        if (!BOT_WANT[id]) continue;
        const d2 = dx * dx + dz * dz + dy * dy * 2.5;
        if (d2 < bd) { bd = d2; best = { x, y, z, id }; }
      }
    }
  }
  b.target = best;
  b.digId = best ? best.id : 0;
  b.digT = 0;
  return !!best;
}

/* 采集状态：走到目标格旁边挖。挖满 breakTime 的时间（按空手速度算，
 * AI 玩家没有工具加成 —— 它们不是矿工，是路人）。 */
export function botGather(b, dt) {
  const t = b.target;
  if (!t || !isBlockId(getEffective(t.x, t.y, t.z)) || getEffective(t.x, t.y, t.z) !== b.digId) {
    botFindOre(b);
    if (!b.target) { b.state = 'idle'; return; }
    return;
  }
  const d = botWalkTo(b, t.x + 0.5, t.z + 0.5, 2.1, dt);
  /* 距离 2.2 格内就能挖（比玩家的 6.5 短，反正它们走过去的就是这个距离） */
  if (Math.hypot(t.x + 0.5 - b.x, t.z + 0.5 - b.z) > 2.2) return;
  b.digT += dt;
  b.swingT = 0.28;
  const need = breakTime(b.digId, 1.6);          // 1.6 倍：给它们一点「会挖矿」的错觉
  if (b.digT >= need) {
    setBlock(t.x, t.y, t.z, 0);
    const got = dropOf(b.digId);
    if (got) botBagAdd(b, got, dropCountOf(b.digId));
    b.digT = 0;
    botFindOre(b);
    if (!b.target) b.state = 'idle';
  }
}

/* 建造：按蓝图（b.buildPlan）逐格盖。蓝图是一次性规划好的有序格子列表，
 * 分多次执行——背包装不下就先去采集，回来从断点接着盖（buildIdx 保留）。
 * 只用建材白名单里的方块，绝不摆泥土/沙子。 */
export function botBuild(b, dt) {
  if (!b.buildPlan) {
    // 起新屋：要求攒够至少 12 个建材，且不在冷却里，免得把世界盖满
    if (b.buildCd > 0 || botBagCount(b, botPickBuildBlock(b)) < 12) { b.state = 'idle'; return; }
    if (!botStartHouse(b)) { b.state = 'idle'; return; }
  }
  const plan = b.buildPlan;
  // 跳过已被占（别人/自己）的格子
  while (b.buildIdx < plan.length && isSolid(getEffective(plan[b.buildIdx].x, plan[b.buildIdx].y, plan[b.buildIdx].z))) b.buildIdx++;
  if (b.buildIdx >= plan.length) { b.buildPlan = null; b.buildCd = 25; b.state = 'idle'; b.speakMsg = pickBuildLine(); return; }

  const c = plan[b.buildIdx];
  botWalkTo(b, c.x + 0.5, c.z + 0.5, 1.9, dt);
  if (Math.hypot(c.x + 0.5 - b.x, c.z + 0.5 - b.z) > 2.6) return;

  const put = botPickBuildBlock(b);
  if (!put) { b.state = 'gather'; return; }          // 没建材了 → 去采集，下次接着盖
  // 支撑检查：底层（贴地）或下方一格是实心才放，避免悬空
  if (c.y > b.buildOrigin[1] + 1 && !isSolid(getEffective(c.x, c.y - 1, c.z))) { b.buildIdx++; return; }

  setBlock(c.x, c.y, c.z, put);
  botBagTake(b, put, 1);
  b.swingT = 0.28;
  b.buildIdx++;
  if (b.buildIdx >= plan.length) { b.buildPlan = null; b.buildCd = 25; b.state = 'idle'; b.speakMsg = pickBuildLine(); return; }
  if (botRng() < 0.05) b.speakMsg = pickBuildLine();
}

/* 合成状态：每 ~0.5 秒试着做一件东西，做不动了就退出（去采集/盖房）。 */
export function botCraft(b, dt) {
  b.swingT = 0.18;
  b.stateT += dt;
  if (b.stateT < 0.5) return;
  b.stateT = 0;
  if (!botTryCraftOnce(b)) b.state = 'idle';
}

/* 战斗：打玩家（被还手时）或打身边的怪。玩家伤害固定 3 点，
 * 打玩家是「还手」性质的，不会很疼，但足够让你意识到有个活人在场。 */
export function botFight(b, dt) {
  b.atkT -= dt;
  let tx, tz, ty, dmg;
  if (b.state === 'fight' && b.target === 'player' && b.angryT > 0) {
    tx = player.x; tz = player.z; ty = player.y;
    dmg = 3;
    if (!player.dead && mode === MODE.SURVIVAL && b.atkT <= 0) {
      const d = Math.hypot(tx - b.x, tz - b.z);
      if (d < 1.9) {
        b.atkT = 1.15; b.swingT = 0.32;
        const hs = d || 1;
        hurt(dmg, '你被' + b.name + '打死了');
        if (player.dead) { b.angryT = 0; b.state = 'idle'; return; }
        b.vx -= (tx - b.x) / hs * 5; b.vz -= (tz - b.z) / hs * 5;
      }
    }
    if (b.angryT <= 0) { b.state = 'idle'; b.target = null; return; }
  } else {
    const foe = b.foe && !b.foe.dead ? b.foe : botNearestFoe(b, 9);
    b.foe = foe;
    if (!foe) { b.state = 'idle'; b.target = null; return; }
    tx = foe.x; tz = foe.z; ty = foe.y;
    dmg = 3;
    if (b.atkT <= 0) {
      const d = Math.hypot(tx - b.x, tz - b.z);
      if (d < 1.85) {
        b.atkT = 1.0; b.swingT = 0.32;
        const D = MOB_TYPES[foe.type];
        damageMob(foe, Math.max(2, D.hp > 14 ? 4 : 2), (tx - b.x) / (d || 1), (tz - b.z) / (d || 1));
      }
    }
  }
  botWalkTo(b, tx, tz, 2.6, dt);
  b.pitch = Math.max(-0.5, Math.min(0.5, Math.atan2(ty + 0.6 - (b.y + 1.5), Math.max(0.5, Math.hypot(tx - b.x, tz - b.z))) * -0.7));
}

/* 逃命 / 回家 */
export function botFleeTo(b, tx, tz, speed, dt) {
  /* ⚠ 这里原来有一句「每帧 2% 概率随机起跳」，看着像「跑得带劲儿」，
   * 实际是**全代码里蹦得最凶的一处**：逃跑状态会持续好几秒，
   * 2%/帧 @60fps ≈ 每秒 1.2 次无理由腾空，玩家视角就是「一群人边跑边跳」。
   * 逃跑不需要跳跃助跑 —— 想跳的话 botPhysics 的台阶分支会自己跳（那个有冷却）。 */
  botWalkTo(b, tx, tz, speed, dt);
}
export function botGoHome(b, dt) {
  const d = Math.hypot(b.home[0] - b.x, b.home[2] - b.z);
  if (d < 1.4) {
    /* 到家才回血，而且受伤后 6 秒内不回 —— 见 damageBot 的说明。
     * 速度也从 2.5/s 降到 1.2/s：一路 2.5/s 等于「跑回家就满血」，
     * 追着打的怪再怎么努力也留不下痕迹。 */
    if (b.hp < b.maxHp && b.regenBlockT <= 0) { healBot(b, 1.2 * dt); }
    b.state = 'idle'; b.goal = null;
    b.yaw += 0.004;
    return;
  }
  botFleeTo(b, b.home[0], b.home[2], 2.3, dt);
}

/* 吃东西回血 */
export function botEat(b, dt) {
  if (b.hp >= b.maxHp || b.food <= 6) { b.state = 'idle'; return; }
  b.food -= 8 * dt;
  if (b.regenBlockT <= 0) healBot(b, 2.5 * dt);
  b.stateT += dt;
  if (b.stateT > 1.4) { b.state = 'idle'; b.speakMsg = '嗯，好多了。'; }
}

/* 每帧推进一个人。
 * botFreeze 为真时**只走物理、不做决策**：动画（摆腿、落体）照常，
 * 但不会转身、不会换状态、不会去挖东西。
 * 用途是定格演出（过场 / 截图）：摆好一排人之后如果不冻住，
 * idle 分支每帧的 `yaw += (botRng()-0.5)*1.4` 会在几十帧内把人转成侧脸，
 * 看着像「模型朝向搞错了」，其实是被人自己转走了（踩过两次）。 */
export let botFreeze = false;
export function botStep(b, dt) {
  b.animT += dt;
  b.hurtFlash = Math.max(0, b.hurtFlash - dt);
  b.atkT = Math.max(0, b.atkT - dt);
  if (b.swingT > 0) b.swingT = Math.max(0, b.swingT - dt);
  if (b.angryT > 0) b.angryT -= dt;
  if (botFreeze) { botPhysics(b, dt); return; }
  b.stateT += dt;
  b.think -= dt;
  if (b.buildCd > 0) b.buildCd = Math.max(0, b.buildCd - dt);
  if (b.think <= 0) { b.think = 0.4 + botRng() * 0.5; botDecide(b); }

  switch (b.state) {
    case 'gather': botGather(b, dt); break;
    case 'build':  botBuild(b, dt);  break;
    case 'craft':  botCraft(b, dt);  break;
    case 'fight':  botFight(b, dt);   break;
    case 'home':   botGoHome(b, dt);  break;
    case 'eat':    botEat(b, dt);     break;
    default:       // idle：随机散步，看见悬崖/墙会自动绕（botPhysics 里处理）
      b.vx *= 0.9; b.vz *= 0.9;
      if (b.stateT > 2.5) { b.stateT = 0; b.yaw += (botRng() - 0.5) * 1.4; }
      if (botRng() < 0.012) botWalkTo(b, b.x + (botRng() - 0.5) * 12, b.z + (botRng() - 0.5) * 12, 1.4, dt);
  }

  /* 血少就慢慢回一点（别让它们永远残血站桩）。
   * 受伤后 6 秒内禁疗，间隔也从 3.5 秒放宽到 6 秒 —— 原来这一路单独看很温和，
   * 但它和「吃东西 5/s」「到家 2.5/s」叠在一起就成了不死之身。 */
  b.regenBlockT = Math.max(0, (b.regenBlockT || 0) - dt);
  b.healT += dt;
  if (b.healT > 6) {
    b.healT = 0;
    if (b.hp < b.maxHp && b.regenBlockT <= 0) healBot(b, 1);
  }
  /* 头上冒话 */
  b.speakCd -= dt;
  if (b.speak > 0) b.speak -= dt;
  else if (b.speakCd <= 0) {
    const lines = ['这矿真多…', '有人吗？', '天快黑了。', '让让让让！', '我在盖房，别拆。', '嘿嘿，挖到了！', '刚才那是谁？'];
    b.speakMsg = lines[Math.floor(botRng() * lines.length) % lines.length];
    b.speak = 2.2; b.speakCd = 14 + botRng() * 22;
  }

  botPhysics(b, dt);
}

/* 主推进：清理死亡、补人、逐个 step。 */
export function updateBots(dt) {
  // 1) 死掉的收走（死亡掉落已在 killBot 里登记到 botDrops）
  for (let i = bots.length - 1; i >= 0; i--) {
    const b = bots[i];
    if (b.dead) { bots.splice(i, 1); continue; }
    /* 走进传送门的：他过门去了另一个维度 —— 从这一侧看就是消失。
     * 给一小簇粒子 + 一句话，否则人会「凭空不见」，玩家会以为是 bug。
     * （跟着玩家一起过门的情况由 switchDim 的 rehomeBots 处理，
     *   那里已经把人挪走了，这里不会再遇到他们。） */
    if (botPortalId(b)) {
      spawnParticles(b.x, b.y + 0.9, b.z, [150, 110, 246]);
      if (typeof toast === 'function') toast('🌀 ' + b.name + ' 走进了传送门');
      bots.splice(i, 1);
      continue;
    }
    if (Math.hypot(b.x - player.x, b.z - player.z) > BOT_KEEP) bots.splice(i, 1);
  }
  // 2) 人数不足就补人。补在玩家背后 —— 正对着冒出来会像作弊刷怪
  if (!player.dead) {
    let guard = 0;
    while (bots.length < BOT_MIN && guard++ < 4) {
      const back = player.yaw + Math.PI + (botRng() - 0.5) * 2.2;
      const r = BOT_SPAWN_MIN + botRng() * (BOT_SPAWN_MAX - BOT_SPAWN_MIN);
      const x = Math.floor(player.x + Math.sin(back) * r);
      const z = Math.floor(player.z + Math.cos(back) * r);
      const y = botGroundY(x, z, Math.floor(player.y));
      if (y < 0) continue;
      spawnBot(x + 0.5, y, z + 0.5);
    }
  }
  // 3) 逐个推进
  for (const b of bots) botStep(b, dt);
}

/* 切维度 / 切模式时清场：AI 玩家带着「家」和背包，跨维度搬家不合理。 */
export function despawnAllBots() { bots.length = 0; }

/* ---------------- AI 玩家与传送门 ----------------
 * 这一段回答的是「为什么 AI 玩家走进传送门不会被传送」——
 * 因为**实体没有维度字段**：bots / mobs / arrows 全部隐式属于「当前维度」，
 * getEffective() 读的也是当前维度。一个人的坐标 (x,y,z) 在八个维度里各指一处地形，
 * 光靠坐标根本表达不了「他在熔火之心」——所以「AI 玩家去了别的维度」
 * 在这套架构里只有一个可观测结果：**从当前维度消失**。
 *
 * 于是分两种情况处理，两边都是这个结论的诚实表达：
 *   ① 玩家正在过同一扇门（switchDim）→ 把他记为「随行者」，到落点附近原样放回来
 *   ② 他自己晃进了门（updateBots）   → 当场消失：他真的过门去了，只是你没跟着
 * 早先这两种情况都是「什么都没发生」（人站在门里继续挖矿），
 * 看着就像传送门对 AI 玩家无效 —— 实际是根本没有这一层判定。 */

/* 这个人的碰撞箱里有门方块吗？返回门方块 id（0 = 没在门里）。
 * 用玩家的同一套盒判定：BOT_W(0.6) 与玩家 PW*2(0.6) 等宽，高度也几乎一样。 */
export function botPortalId(b) {
  return portalIdInBox(b.x, b.y, b.z);
}

/* 把一批「随行者」在 (cx, cz) 附近放回来，返回真正落地的人数。
 * ⚠ 落地半径刻意给到 5~12 格：太近的话会直接落在刚生成的回程门上，
 *   下一帧又被判定「在门里」而消失，玩家看到的是「人跟过来了又立刻没了」。 */
export function rehomeBots(list, cx, cy, cz) {
  bots.length = 0;
  let n = 0;
  for (const b of list) {
    let placed = false;
    for (let i = 0; i < 8 && !placed; i++) {
      const a = botRng() * Math.PI * 2, r = 5 + botRng() * 7;
      const x = Math.floor(cx + Math.cos(a) * r), z = Math.floor(cz + Math.sin(a) * r);
      const gy = botGroundY(x, z, Math.floor(cy));
      if (gy < 0) continue;
      b.x = x + 0.5; b.y = gy; b.z = z + 0.5;
      placed = true;
    }
    if (!placed) continue;             // 新维度这一带没有地面 → 就当没跟过来
    b.vx = b.vy = b.vz = 0;
    b.onGround = false;
    /* 家、采集目标、挖掘进度全部作废：它们记的是**旧维度**的坐标，
     * 留着的话人会朝着一个不存在的点走（在虚空维度还会直接走出岛外）。 */
    b.home = [b.x, b.y, b.z];
    b.goal = null; b.target = null; b.foe = null;
    b.digT = 0; b.digId = 0;
    b.state = 'idle'; b.stateT = 0; b.think = 0.2;
    bots.push(b);
    n++;
  }
  return n;
}

/* 射线打 AI 玩家（玩家左键能打他们）。返回 { bot, dist } 或 null。 */
export function raycastBot(ox, oy, oz, dx, dy, dz, maxD) {
  let best = null;
  const hw = BOT_W / 2;
  for (const b of bots) {
    if (b.dead) continue;
    const mn = [b.x - hw, b.y, b.z - hw], mx = [b.x + hw, b.y + BOT_H, b.z + hw];
    const t = rayBox(ox, oy, oz, dx, dy, dz, mn, mx);
    if (t < 0 || t > maxD) continue;
    if (!best || t < best.dist) best = { bot: b, dist: t };
  }
  return best;
}

/* 玩家左键挥击的**统一入口**：一次挥击先看 AI 玩家、再看怪。
 * ⚠ 为什么不是「在主循环里连着调 tryAttackBot + tryAttackMob」：
 * 那两个函数各自开头都会 `swingT -= dt`，连着调等于一帧扣两次冷却，
 * 挥击速度直接砍半，而且两个函数的「冷却中就返回 false」判断也各走一次，
 * 会出现「这一帧既打了人又打了怪」的双重命中。所以扣冷却只在这里做一次，
 * 命中判定也只在这里做一次。
 *
 * tryAttackMob 保持原样不动 —— 无头回归直接调它并断言冷却语义
 * （「挥击有冷却」那条），把它改签名会连带动既有断言。 */
export function tryAttackAny(dt, blockDist = Infinity) {
  setSwingT(swingT - dt);
  if (swingT > 0) return false;
  if (mode === MODE.SPECTATOR) return false;
  const p = player;
  const cp = Math.cos(p.pitch), sp = Math.sin(p.pitch);
  const dir = [-Math.sin(p.yaw) * cp, sp, -Math.cos(p.yaw) * cp];
  const eye = p.y + EYE;

  /* 比距离：谁更近打谁。AI 玩家和怪在同一个准星方向上时，
   * 该打哪个不该由数组顺序决定（谁先被遍历到谁挨打，纯属偶然）。 */
  /* 打人/打怪用 REACH_ATTACK —— REACH 已经是 13 格的挖放距离 */
  const hB = raycastBot(p.x, eye, p.z, dir[0], dir[1], dir[2], REACH_ATTACK);
  const hM = raycastMob(p.x, eye, p.z, dir[0], dir[1], dir[2], REACH_ATTACK);
  const dB = hB && hB.dist < blockDist ? hB.dist : Infinity;
  const dM = hM && hM.dist < blockDist ? hM.dist : Infinity;
  if (dB === Infinity && dM === Infinity) return false;

  setSwingT(0.32);
  setHandSwing(1);
  if (dB <= dM) {
    damageBot(hB.bot, attackDamage(), dir[0], dir[2], true);   // fromPlayer → 对方会还手
    if (typeof blip === 'function') blip(180, 0.05, 'square', 0.04);
  } else {
    damageMob(hM.mob, attackDamage(), dir[0], dir[2]);
  }
  return true;
}

/* ---------------- 地面掉落物（AI 玩家死后掉出来的东西）----------------
 * 玩家自己的破坏掉落是**直接进背包**的（collectDrop），没有地面实体。
 * 但 AI 玩家的掉落不能这么做 —— 它必须先在地上躺着，你走过去才捡得到，
 * 否则「打死一个人就凭空收进背包」既没有掉落仪式感，也没有拾取的乐趣。
 *
 * 所以这里是一个真正的实体系统：{ id, n, x, y, z, vx, vy, vz, life }，
 * 有重力、会落地、会原地转圈。AI 玩家之间**不互相拾取**（只有玩家能捡），
 * 否则一次群体互殴之后地上的东西会凭空消失。 */
export const botDrops = [];
export const BOT_DROP_LIFE = 180;        // 3 分钟后消失，防止世界里堆满垃圾
export const BOT_DROP_MERGE = 1.6;       // 同类相距这么近就叠成一堆

/* 丢一批东西。同类合并是为了避免一个人死一次地上散出二十个方块。 */
export function botDropBag(b, bag) {
  let dropped = 0;
  for (const [id, n] of bag) {
    if (!id || n <= 0) continue;
    // 一堆里最多落 4 个实体，其余按个数合并进已有的堆（cap 24）
    const stacks = Math.min(4, Math.max(1, Math.ceil(n / 6)));
    const per = Math.ceil(n / stacks);
    for (let s = 0; s < stacks; s++) {
      const cnt = Math.min(per, n - s * per);
      if (cnt <= 0) break;
      // 先看附近有没有同类，有就直接叠上去
      let merged = false;
      for (const d of botDrops) {
        if (d.id !== id || d.n >= 24) continue;
        if (Math.hypot(d.x - b.x, d.z - b.z) < BOT_DROP_MERGE && Math.abs(d.y - b.y) < 1.4) {
          d.n += cnt; merged = true; break;
        }
      }
      if (merged) { dropped += cnt; continue; }
      const a = botRng() * Math.PI * 2, sp = 1.1 + botRng() * 1.5;
      botDrops.push({
        id, n: cnt,
        x: b.x + Math.cos(a) * 0.35, y: b.y + 0.7, z: b.z + Math.sin(a) * 0.35,
        vx: Math.cos(a) * sp, vy: 3.2 + botRng() * 1.4, vz: Math.sin(a) * sp,
        life: BOT_DROP_LIFE, spin: botRng() * Math.PI * 2,
      });
      dropped += cnt;
    }
  }
  return dropped;
}

/* 推进掉落物：重力 + 落地 + 靠近玩家自动拾取 + 超时回收。返回本帧捡进背包的件数。 */
export function updateBotDrops(dt) {
  let picked = 0;
  for (let i = botDrops.length - 1; i >= 0; i--) {
    const d = botDrops[i];
    d.life -= dt;
    if (d.life <= 0 || d.y < -6) { botDrops.splice(i, 1); continue; }

    d.vy -= G * 0.55 * dt;                              // 掉落物重力比玩家小（飘着一点好看）
    d.vx *= 0.90; d.vz *= 0.90;
    d.spin += dt * 1.6;
    d.vy = Math.max(d.vy, -18);

    /* 逐轴扫掠 + 落地吸附。
 * ⚠⚠ 吸附高度必须重新向上取整到**下一格的顶面**：
 * 地面是第 G 格（实心），它的顶面在 G+1，掉落物就该躺在 y = G+1。
 *   · 写成 floor(d.y)            → 落进地里的格子，埋进土中，之后一路沉到 y<-6 被回收
 *   · 写成 floor(d.y) + 1 + 0.02 → 恰好是 G+1，才是对的
 * 我一开始写成了 floor(d.y)+1+0.02，看到截图里「浮空一格」就顺手改成
 * floor(d.y)+0.02 —— 结果反了：掉落物全部沉进地里然后凭空消失。
 * 两次都错，说明这一行必须靠**截图 + 数值**验证，不能凭直觉改。
 * 正确写法：命中实心格 fy 时，落到「fy+1」那一格（空气格）的底部。
 *
 * 判据用**下落前**的位置（用旧 y 求 fy）也很关键：一帧位移可能跨过整格，
 * 用新 y 求 fy 会得到已经埋进地里的那一格，越判越深。 */
    const hw = 0.14;
    // x / z：撞到就反弹一下（掉在地上会弹一下，比直接停住自然）
    d.x += d.vx * dt;
    if (isSolid(getEffective(Math.floor(d.x - hw), Math.floor(d.y + 0.05), Math.floor(d.z))) ||
        isSolid(getEffective(Math.floor(d.x + hw), Math.floor(d.y + 0.05), Math.floor(d.z)))) {
      d.x -= d.vx * dt; d.vx *= -0.25;
    }
    d.z += d.vz * dt;
    if (isSolid(getEffective(Math.floor(d.x), Math.floor(d.y + 0.05), Math.floor(d.z - hw))) ||
        isSolid(getEffective(Math.floor(d.x), Math.floor(d.y + 0.05), Math.floor(d.z + hw)))) {
      d.z -= d.vz * dt; d.vz *= -0.25;
    }
    // y：先用**旧位置**求出「下一格」，落进实心格就贴到它的顶面
    if (d.vy < 0) {
      const nextY = Math.floor(d.y + d.vy * dt);
      if (isSolid(getEffective(Math.floor(d.x), nextY, Math.floor(d.z)))) {
        d.y = nextY + 1 + 0.02;                 // 躺在实心格的正上方那一格
        d.vy = 0; d.vx *= 0.55; d.vz *= 0.55; d.settled = 1;
      } else {
        d.y += d.vy * dt;
      }
    } else {
      d.y += d.vy * dt;
    }

    /* 拾取：玩家 1.9 格内自动收进背包。创造模式也捡（反正玩家自己的掉落也是直接进包）。 */
    if (!player.dead) {
      const dpx = player.x - d.x, dpz = player.z - d.z;
      if (Math.abs(d.y - (player.y + 0.8)) < 2.2 && dpx * dpx + dpz * dpz < 1.9 * 1.9) {
        invAdd(d.id, d.n);
        picked += d.n;
        botDrops.splice(i, 1);
        continue;
      }
    }
    /* 走远的也回收（玩家跑到 68 格外时那一片的东西没必要留着） */
    if (Math.hypot(d.x - player.x, d.z - player.z) > BOT_KEEP) { botDrops.splice(i, 1); }
  }
  return picked;
}

export function despawnAllBotDrops() { botDrops.length = 0; }

/* ---------------- 把 AI 玩家交给生物模块 ----------------
 * mobs.js 不能反向 import 本文件（bots.js 已经 import 了 mobs.js，成环会让
 * ESM 拿到未初始化的绑定）。所以由这边把「列表」和「扣血函数」递过去 ——
 * 之后僵尸、骷髅的箭、苦力怕爆炸、凋灵的爆破才会把 AI 玩家当成和玩家一样的猎物。
 *
 * ⚠ 必须**延迟**到模块图跑完之后再注册：直接写在模块顶层会撞上 TDZ ——
 * mobs.js 自己的 import 链里绕回来加载了 bots.js，那一刻 mobs.js 的
 * `export const botHook` 还没初始化，registerBots 会抛
 * 「Cannot access 'botHook' before initialization」。所以由 boot() 调用一次，
 * spawnBot 里也兜一次（幂等），保证任何时候生成第一只 bot 之前都装好了。
 *
 * 传的是数组**引用**（bots 是 const 数组、只 push/splice 不重新赋值），
 * 所以增删 bot 不需要重新注册。 */
let hookInstalled = false;
export function installBotHook() {
  if (hookInstalled) return;
  hookInstalled = true;
  registerBots(bots, damageBot);
}
