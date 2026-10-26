/* 生物：被动 / 敌对 AI、刷怪、掉落物 —— 迁移自 voxel-craft.html 第 6284-7451 行 */

import { MODE, dim, mode, setHandSwing, setSwingT, spectate, swingT } from './state.js'
import { spawnParticles } from './actions.js'
import { blip, noiseBurst } from './audio.js'
import { BLOCKS, D, EGG_OF, EYE, G, H, I, ITEMS, JUMP_V, MAT_PLAIN, PW, REACH, SUMMON_OF, TILE_INDEX, UV_QUAD, attackDamage, setMobTypes, tileUV } from './config.js'
import { CELL, DIMS, structAnchor, structAt } from './dims.js'
import { getEffective, isLiquid, isSolid, setBlock } from './generate.js'
import { keys } from './input.js'
import { FACES } from './mesher.js'
import { moveBodyAxis, player } from './player.js'
import { hurt, inv, invAdd } from './survival.js'
import { shade } from './textures.js'

/* ============================== 生物 ============================== */
/* 实体与玩家共用同一套逐轴 AABB 碰撞（moveBodyAxis）与同一套 shader
 * （靠 uModel 做「局部模型 → 世界」变换）。
 * 这一段刻意不碰 DOM/WebGL —— 无头测试要能直接驱动 AI 与战斗。 */

/* ---------------- 昼夜循环 ----------------
 * 既是氛围，也是僵尸生成的判据（夜晚才刷）。 */
export const DAY_LEN = 420;                    // 一整天多少秒（约 7 分钟）
export let worldTime = DAY_LEN * 0.18;         // 从清晨开始
export const dayPhase = () => (worldTime % DAY_LEN) / DAY_LEN;
/* 0.00 清晨 / 0.25 正午 / 0.50 黄昏 / 0.62 入夜 / 0.92 破晓 */
export const isNight = () => { const t = dayPhase(); return t > 0.56 && t < 0.94; };
/* 读档时把世界时间拨回存档那一刻。
 * 必须是 setter：worldTime 是 `let`，ESM 的导入绑定只读，
 * save.js 不能直接赋值（那会抛 TypeError）。 */
export function setWorldTime(t) {
  if (Number.isFinite(t) && t >= 0) worldTime = t;
}

/* ---------------- 生物表 ----------------
 * w = 碰撞半宽基准（实际用 w/2），h = 碰撞高度。
 * parts 里的 at 是「相对脚底中心」的局部坐标，+z 为朝向正前方。
 * leg 标记会让这一块在行走时前后摆动。 */
export const MOB_TYPES = {
  pig: {
    name: '猪', hp: 10, speed: 1.9, w: 0.9, h: 0.95, passive: true,
    drop: 202, dropN: 1, xp: 0,
    parts: [
      { box: [0.62, 0.58, 1.00], at: [0, 0.55, 0], tex: 'mob_pig' },
      { box: [0.50, 0.48, 0.42], at: [0, 0.60, 0.68], tex: 'mob_pig' },
      { box: [0.24, 0.18, 0.10], at: [0, 0.54, 0.93], tex: 'mob_pig_snout' },
      { box: [0.18, 0.42, 0.18], at: [-0.22, 0.21, 0.34], tex: 'mob_leg', leg: 1 },
      { box: [0.18, 0.42, 0.18], at: [0.22, 0.21, 0.34], tex: 'mob_leg', leg: 2 },
      { box: [0.18, 0.42, 0.18], at: [-0.22, 0.21, -0.34], tex: 'mob_leg', leg: 3 },
      { box: [0.18, 0.42, 0.18], at: [0.22, 0.21, -0.34], tex: 'mob_leg', leg: 4 },
    ],
  },
  sheep: {
    name: '羊', hp: 8, speed: 1.8, w: 0.9, h: 1.05, passive: true,
    drop: 203, dropN: 1, xp: 0,
    parts: [
      { box: [0.72, 0.62, 1.00], at: [0, 0.66, 0], tex: 'mob_sheep_wool' },
      { box: [0.44, 0.44, 0.46], at: [0, 0.74, 0.66], tex: 'mob_sheep_face' },
      { box: [0.17, 0.50, 0.17], at: [-0.22, 0.25, 0.32], tex: 'mob_leg', leg: 1 },
      { box: [0.17, 0.50, 0.17], at: [0.22, 0.25, 0.32], tex: 'mob_leg', leg: 2 },
      { box: [0.17, 0.50, 0.17], at: [-0.22, 0.25, -0.32], tex: 'mob_leg', leg: 3 },
      { box: [0.17, 0.50, 0.17], at: [0.22, 0.25, -0.32], tex: 'mob_leg', leg: 4 },
    ],
  },
  chicken: {
    name: '鸡', hp: 4, speed: 2.0, w: 0.5, h: 0.72, passive: true,
    drop: 204, dropN: 1, xp: 0,
    parts: [
      { box: [0.34, 0.34, 0.46], at: [0, 0.42, 0], tex: 'mob_chicken' },
      { box: [0.24, 0.24, 0.20], at: [0, 0.66, 0.24], tex: 'mob_chicken' },
      { box: [0.12, 0.07, 0.14], at: [0, 0.64, 0.40], tex: 'mob_chicken_beak' },
      { box: [0.08, 0.26, 0.08], at: [-0.10, 0.13, 0], tex: 'mob_chicken_beak', leg: 1 },
      { box: [0.08, 0.26, 0.08], at: [0.10, 0.13, 0], tex: 'mob_chicken_beak', leg: 2 },
    ],
  },
  zombie: {
    name: '僵尸', hp: 20, speed: 2.35, w: 0.62, h: 1.85, hostile: true,
    dmg: 3, atkRange: 1.35, sight: 17, drop: 205, dropN: 1,
    parts: [
      { box: [0.50, 0.66, 0.28], at: [0, 1.22, 0], tex: 'mob_zombie_shirt' },
      { box: [0.42, 0.42, 0.42], at: [0, 1.76, 0], tex: 'mob_zombie_skin' },
      { box: [0.16, 0.58, 0.16], at: [-0.33, 1.30, 0.16], tex: 'mob_zombie_skin' },
      { box: [0.16, 0.58, 0.16], at: [0.33, 1.30, 0.16], tex: 'mob_zombie_skin' },
      { box: [0.18, 0.88, 0.18], at: [-0.13, 0.45, 0], tex: 'mob_zombie_pants', leg: 1 },
      { box: [0.18, 0.88, 0.18], at: [0.13, 0.45, 0], tex: 'mob_zombie_pants', leg: 2 },
    ],
  },
  /* 村民：村庄聚落里的 NPC。不主动攻击，被打会躲开；
   * 身体比僵尸矮胖一些，鼻子单独一块凸出来。 */
  villager: {
    name: '村民', hp: 20, speed: 1.15, w: 0.62, h: 1.92, passive: true,
    drop: 0, dropN: 0,
    parts: [
      { box: [0.46, 0.62, 0.26], at: [0, 1.14, 0], tex: 'mob_villager_robe' },
      { box: [0.38, 0.38, 0.30], at: [0, 1.66, 0], tex: 'mob_villager_face' },
      { box: [0.10, 0.10, 0.10], at: [0, 1.62, 0.19], tex: 'mob_villager_face' },  // 鼻子
      { box: [0.14, 0.56, 0.14], at: [-0.30, 1.22, 0.10], tex: 'mob_villager_robe' },
      { box: [0.14, 0.56, 0.14], at: [0.30, 1.22, 0.10], tex: 'mob_villager_robe' },
      { box: [0.17, 0.82, 0.17], at: [-0.12, 0.41, 0], tex: 'mob_villager_robe', leg: 1 },
      { box: [0.17, 0.82, 0.17], at: [0.12, 0.41, 0], tex: 'mob_villager_robe', leg: 2 },
    ],
  },

  /* ---------------- 傀儡 ----------------
   * guard: true 是这一族的唯一标志 —— mobAI 按它走「索敌」分支（打敌对生物），
   * 而不是 hostile 的「追玩家」或 passive 的「被打就跑」。
   * 三者刻意做成三种截然不同的手感，而不是同一只换皮：
   *   铁傀儡  肉厚、慢、伤害高、击退猛 —— 站桩清场
   *   石傀儡  中等身材中等速度，能跟得上玩家 —— 通用保镖
   *   雪傀儡  脆、快、**远程扔雪球**（throw 字段）—— 只敢在 4~13 格外放风筝
   * 共同点：都不攻击玩家、不攻击被动生物，只咬 hostile。
   *
   * arm: 1 的手臂会在挥击时抬起（见 drawMobs），leg 仍旧是行走摆腿。 */
  golem_iron: {
    name: '铁傀儡', hp: 60, speed: 1.45, w: 1.15, h: 2.36, guard: true,
    dmg: 9, atkRange: 1.75, sight: 16, drop: I.IRON, dropN: 2,     // 掉 2 铁矿石
    parts: [
      { box: [0.88, 0.90, 0.54], at: [0, 1.41, 0], tex: 'mob_iron_plate' },
      { box: [0.54, 0.50, 0.50], at: [0, 2.11, 0], tex: 'mob_iron_face' },
      { box: [0.16, 0.16, 0.22], at: [0, 2.03, 0.34], tex: 'mob_iron_face' },   // 长鼻子
      { box: [0.26, 1.00, 0.28], at: [-0.55, 1.45, 0], tex: 'mob_iron_plate', arm: 1 },
      { box: [0.26, 1.00, 0.28], at: [0.55, 1.45, 0], tex: 'mob_iron_plate', arm: 2 },
      { box: [0.32, 0.96, 0.32], at: [-0.23, 0.48, 0], tex: 'mob_iron_plate', leg: 1 },
      { box: [0.32, 0.96, 0.32], at: [0.23, 0.48, 0], tex: 'mob_iron_plate', leg: 2 },
      { box: [0.20, 0.26, 0.06], at: [0.26, 1.74, 0.29], tex: 'mob_golem_vine' },  // 胸前青苔
      { box: [0.14, 0.30, 0.06], at: [-0.24, 1.14, 0.29], tex: 'mob_golem_vine' },
    ],
  },
  golem_stone: {
    name: '石傀儡', hp: 32, speed: 2.05, w: 0.90, h: 1.96, guard: true,
    dmg: 5, atkRange: 1.55, sight: 15, drop: 4, dropN: 3,     // 掉 3 圆石
    parts: [
      { box: [0.70, 0.74, 0.44], at: [0, 1.17, 0], tex: 'mob_stone_plate' },
      { box: [0.46, 0.42, 0.42], at: [0, 1.75, 0], tex: 'mob_stone_face' },
      { box: [0.22, 0.78, 0.24], at: [-0.45, 1.20, 0], tex: 'mob_wood_arm', arm: 1 },
      { box: [0.22, 0.78, 0.24], at: [0.45, 1.20, 0], tex: 'mob_wood_arm', arm: 2 },
      { box: [0.26, 0.16, 0.30], at: [-0.45, 1.54, 0], tex: 'mob_stone_plate' },   // 方肩
      { box: [0.26, 0.16, 0.30], at: [0.45, 1.54, 0], tex: 'mob_stone_plate' },
      { box: [0.26, 0.80, 0.26], at: [-0.18, 0.40, 0], tex: 'mob_stone_plate', leg: 1 },
      { box: [0.26, 0.80, 0.26], at: [0.18, 0.40, 0], tex: 'mob_stone_plate', leg: 2 },
    ],
  },
  golem_snow: {
    name: '雪傀儡', hp: 8, speed: 2.2, w: 0.60, h: 1.44, guard: true,
    dmg: 3, atkRange: 1.4, sight: 15, drop: 12, dropN: 2,      // 掉 2 雪块
    throw: { speed: 14, dmg: 3, cd: 1.35, min: 4, max: 13 },
    parts: [
      { box: [0.58, 0.58, 0.58], at: [0, 0.29, 0], tex: 'mob_snowman' },
      { box: [0.46, 0.46, 0.46], at: [0, 0.81, 0], tex: 'mob_snowman' },
      { box: [0.40, 0.40, 0.40], at: [0, 1.24, 0], tex: 'mob_snow_face' },
      { box: [0.10, 0.46, 0.10], at: [-0.36, 0.92, 0.02], tex: 'mob_wood_arm', arm: 1 },
      { box: [0.10, 0.46, 0.10], at: [0.36, 0.92, 0.02], tex: 'mob_wood_arm', arm: 2 },
    ],
  },

  /* ---------------- 夜间敌对生物（第九轮） ----------------
   * 四种新 hostile，各自一种「僵尸没有的手感」，而不是换皮：
   *   蜘蛛    快、矮、宽，**会爬墙**（climb）—— 房顶不再是安全区
   *   苦力怕  无声逼近，贴脸后引信倒计时，**爆炸并破坏方块**（fuse）
   *   骷髅    远程，保持 4.5~12 格放箭（ranged），被近身会后退
   *   史莱姆  不走路只**弹跳**（hop），大史莱姆死亡时**分裂**成两只小的（split）
   * 共同点：都是夜间刷新（和僵尸同池，见 NIGHT_POOL），都被傀儡视为敌人。
   *
   * ⚠ 新增字段（climb/fuse/ranged/hop/split）一律在读取处写 `|| 0` 兜底 ——
   * 无头测试会拿裸对象直接调 mobPhysics / mobAI，缺字段算出 NaN 是静默的。 */
  spider: {
    name: '蜘蛛', hp: 16, speed: 3.4, w: 1.10, h: 0.90, hostile: true,
    dmg: 3, atkRange: 1.5, sight: 18, drop: I.SPIDER_EYE, dropN: 1, climb: true,
    parts: [
      { box: [0.72, 0.50, 0.85], at: [0, 0.48, 0.10], tex: 'mob_spider' },      // 头胸
      { box: [0.60, 0.54, 0.55], at: [0, 0.42, -0.50], tex: 'mob_spider' },     // 腹部
      { box: [0.34, 0.24, 0.16], at: [0, 0.50, 0.56], tex: 'mob_spider_eye' },  // 眼区
      { box: [0.09, 0.46, 0.09], at: [-0.50, 0.26, 0.30], tex: 'mob_spider', leg: 1 },
      { box: [0.09, 0.46, 0.09], at: [ 0.50, 0.26, 0.30], tex: 'mob_spider', leg: 2 },
      { box: [0.09, 0.46, 0.09], at: [-0.28, 0.26, 0.44], tex: 'mob_spider', leg: 3 },
      { box: [0.09, 0.46, 0.09], at: [ 0.28, 0.26, 0.44], tex: 'mob_spider', leg: 4 },
      { box: [0.09, 0.46, 0.09], at: [-0.50, 0.26, -0.30], tex: 'mob_spider', leg: 5 },
      { box: [0.09, 0.46, 0.09], at: [ 0.50, 0.26, -0.30], tex: 'mob_spider', leg: 6 },
      { box: [0.09, 0.46, 0.09], at: [-0.28, 0.26, -0.44], tex: 'mob_spider', leg: 7 },
      { box: [0.09, 0.46, 0.09], at: [ 0.28, 0.26, -0.44], tex: 'mob_spider', leg: 8 },
    ],
  },
  creeper: {
    name: '苦力怕', hp: 20, speed: 2.1, w: 0.62, h: 1.70, hostile: true,
    dmg: 0, sight: 18, drop: I.GUNPOWDER, dropN: 1,            // 近战打不了人，全靠炸
    fuse: { range: 2.8, time: 1.4, radius: 3.1, dmg: 9 },
    parts: [
      { box: [0.56, 0.82, 0.34], at: [0, 0.98, 0], tex: 'mob_creeper' },       // 竖长身体
      { box: [0.50, 0.50, 0.50], at: [0, 1.55, 0], tex: 'mob_creeper_face' },  // 方头
      { box: [0.20, 0.56, 0.26], at: [-0.28, 0.62, 0.18], tex: 'mob_creeper', leg: 1 },
      { box: [0.20, 0.56, 0.26], at: [ 0.28, 0.62, 0.18], tex: 'mob_creeper', leg: 2 },
      { box: [0.20, 0.56, 0.26], at: [-0.28, 0.62, -0.18], tex: 'mob_creeper', leg: 3 },
      { box: [0.20, 0.56, 0.26], at: [ 0.28, 0.62, -0.18], tex: 'mob_creeper', leg: 4 },
    ],
  },
  skeleton: {
    name: '骷髅', hp: 18, speed: 2.3, w: 0.62, h: 1.85, hostile: true,
    dmg: 0, sight: 20, drop: I.BONE, dropN: 1,                 // 伤害全靠箭，不肉搏
    ranged: { min: 4.5, max: 12, cd: 1.7, speed: 17, dmg: 3 },
    parts: [
      { box: [0.46, 0.62, 0.26], at: [0, 1.20, 0], tex: 'mob_skeleton' },
      { box: [0.44, 0.44, 0.44], at: [0, 1.74, 0], tex: 'mob_skeleton_face' },
      { box: [0.13, 0.52, 0.13], at: [-0.31, 1.26, 0.10], tex: 'mob_skeleton', arm: 1 },
      { box: [0.13, 0.52, 0.13], at: [ 0.31, 1.26, 0.10], tex: 'mob_skeleton', arm: 2 },
      { box: [0.15, 0.85, 0.15], at: [-0.12, 0.44, 0], tex: 'mob_skeleton', leg: 1 },
      { box: [0.15, 0.85, 0.15], at: [ 0.12, 0.44, 0], tex: 'mob_skeleton', leg: 2 },
    ],
  },
  slime_large: {
    name: '史莱姆', hp: 8, speed: 2.2, w: 1.00, h: 1.00, hostile: true,
    dmg: 3, atkRange: 1.5, sight: 14, drop: I.SLIMEBALL, dropN: 1,
    hop: { power: 1.2, cd: 0.85 }, split: 'slime_small', splitN: 2,
    parts: [
      { box: [1.00, 1.00, 1.00], at: [0, 0.50, 0], tex: 'mob_slime' },
      { box: [0.52, 0.30, 0.10], at: [0, 0.60, 0.50], tex: 'mob_slime_face' },   // 脸贴在正前
    ],
  },
  slime_small: {
    name: '小史莱姆', hp: 3, speed: 2.6, w: 0.55, h: 0.55, hostile: true,
    dmg: 2, atkRange: 1.2, sight: 14, drop: I.SLIMEBALL, dropN: 1,
    hop: { power: 1.35, cd: 0.6 },                    // 不再分裂（split 缺省）
    parts: [
      { box: [0.55, 0.55, 0.55], at: [0, 0.275, 0], tex: 'mob_slime' },
      { box: [0.30, 0.18, 0.06], at: [0, 0.34, 0.28], tex: 'mob_slime_face' },
    ],
  },

  /* ---------------- Boss（玩家可召唤） ----------------
   * boss:true 让 mobAI 走专属分支（见下），不进 hostile 的追人/打人逻辑。
   * 三种各一种「打法」，而不是同一种换皮：
   *   末影龙   空中盘旋 + 俯冲喷弹（ranged），hp 200，掉 3 钻石
   *   凋灵     三头远程齐射 + 周期爆破方块（witherBomb），hp 160，掉 2 黑曜石
   *   远古守卫 肉盾近战 + 周期召唤小史莱姆（summonAdds），hp 240，掉 4 金
   *
   * boss 不参与距离回收（见 updateMobs 末尾的 guard 判定旁），
   * 也不进昼夜刷新池（NIGHT_POOL 不含它们）。
   * 只能由玩家用 boss 蛋主动召唤（见 trySpawnEgg）。 */
  dragon: {
    name: '末影龙', hp: 200, speed: 4.0, w: 1.40, h: 2.20, boss: true,
    fly: { height: 6, amp: 2.0, freq: 1.2 },          // 盘旋飞行参数
    ranged: { min: 5, max: 20, cd: 1.6, speed: 18, dmg: 5 },  // 喷弹
    sight: 30, drop: I.DIAMOND, dropN: 3,
    /* 星陨武器的主材料。4 个 = 一把星陨剑（3 龙鳞）+ 余一个，
     * 也就是「打一场末影龙，够换一件武器」。 */
    loot: [[I.DRAGON_SCALE, 4]],
    parts: [
      { box: [0.60, 0.50, 2.20], at: [0, 1.10, 0], tex: 'mob_dragon' },       // 长身
      { box: [0.50, 0.44, 0.50], at: [0, 1.30, 1.35], tex: 'mob_dragon' },    // 头
      { box: [0.30, 0.20, 0.10], at: [0, 1.42, 1.62], tex: 'mob_dragon_eye' }, // 眼区
      { box: [0.80, 0.16, 0.80], at: [-1.10, 1.00, -0.40], tex: 'mob_dragon', arm: 1 }, // 左翼
      { box: [0.80, 0.16, 0.80], at: [ 1.10, 1.00, -0.40], tex: 'mob_dragon', arm: 2 }, // 右翼
      { box: [0.22, 0.44, 0.22], at: [-0.20, 0.55, -0.80], tex: 'mob_dragon', leg: 1 },
      { box: [0.22, 0.44, 0.22], at: [ 0.20, 0.55, -0.80], tex: 'mob_dragon', leg: 2 },
    ],
  },
  wither: {
    name: '凋灵', hp: 160, speed: 2.8, w: 1.20, h: 2.60, boss: true,
    fly: { height: 5, amp: 1.5, freq: 0.9 },
    ranged: { min: 4, max: 18, cd: 1.2, speed: 16, dmg: 4 },
    witherBomb: { radius: 2.5, dmg: 6, cd: 4.5 },     // 周期爆破方块
    sight: 28, drop: I.OBSIDIAN, dropN: 2,
    /* 法杖的主材料（4 个 = 一支凋灵法杖） */
    loot: [[I.WITHER_BONE, 4]],
    parts: [
      { box: [0.70, 1.20, 0.50], at: [0, 1.30, 0], tex: 'mob_wither' },       // 主体
      { box: [0.44, 0.44, 0.44], at: [-0.66, 1.90, 0], tex: 'mob_wither_face' }, // 左头
      { box: [0.44, 0.44, 0.44], at: [ 0.00, 2.20, 0], tex: 'mob_wither_face' }, // 中头
      { box: [0.44, 0.44, 0.44], at: [ 0.66, 1.90, 0], tex: 'mob_wither_face' }, // 右头
      { box: [0.26, 1.00, 0.26], at: [-0.60, 1.00, 0], tex: 'mob_wither', arm: 1 },
      { box: [0.26, 1.00, 0.26], at: [ 0.60, 1.00, 0], tex: 'mob_wither', arm: 2 },
      { box: [0.30, 0.80, 0.30], at: [-0.20, 0.40, 0], tex: 'mob_wither', leg: 1 },
      { box: [0.30, 0.80, 0.30], at: [ 0.20, 0.40, 0], tex: 'mob_wither', leg: 2 },
    ],
  },
  guardian: {
    name: '远古守卫', hp: 240, speed: 2.0, w: 1.30, h: 2.80, boss: true,
    dmg: 8, atkRange: 2.0, sight: 24,
    summonAdds: { type: 'slime_small', n: 2, cd: 6.0, cap: 4 }, // 周期召唤小史莱姆
    drop: I.GOLD, dropN: 4,
    /* 星陨盔甲的主材料：一整套 4 件要 24 个，守卫每场掉 8 个 →
     * 「打三场远古守卫，凑齐一套星陨甲」。它是三种 boss 里最肉的，
     * 所以把最贵的材料挂在它身上。 */
    loot: [[I.GUARDIAN_CORE, 8]],
    parts: [
      { box: [0.90, 1.00, 0.60], at: [0, 1.50, 0], tex: 'mob_guardian' },       // 躯干
      { box: [0.60, 0.56, 0.56], at: [0, 2.30, 0], tex: 'mob_guardian' },      // 头
      { box: [0.30, 0.20, 0.12], at: [0, 2.42, 0.32], tex: 'mob_guardian_face' }, // 金眼
      { box: [0.30, 1.10, 0.30], at: [-0.70, 1.55, 0], tex: 'mob_guardian', arm: 1 },
      { box: [0.30, 1.10, 0.30], at: [ 0.70, 1.55, 0], tex: 'mob_guardian', arm: 2 },
      { box: [0.40, 1.00, 0.40], at: [-0.30, 0.50, 0], tex: 'mob_guardian', leg: 1 },
      { box: [0.40, 1.00, 0.40], at: [ 0.30, 0.50, 0], tex: 'mob_guardian', leg: 2 },
    ],
  },
};

/* 把生物表交回 config.js（itemTip 要拿它拼「右键召唤XXX」的提示）。
 * 必须走注入 —— 原因见 config.js 顶部关于 readHeldId 的注释。 */
setMobTypes(MOB_TYPES);

export const PASSIVE_TYPES = ['pig', 'sheep', 'chicken'];
/* 只在村庄聚落附近刷新的被动生物（不参与荒野随机刷新） */
export const VILLAGE_TYPES = ['villager'];
/* 傀儡：玩家用「核心」召唤，或者按节奏在村庄里刷出来当守卫。
 * 单独给一个上限 —— 它们不吃荒野刷怪的名额，但也不能无限攒。 */
export const GUARD_TYPES = ['golem_iron', 'golem_stone', 'golem_snow'];
export const GUARD_CAP = 3;
/* 夜间敌对生物池（权重表）。僵尸是主力军，四种新怪按权重混入。
 * ⚠ 刷新时这个池必须排在僵尸分支**之后**：僵尸分支一个 mobRng 都不许多消费，
 * 否则依赖 mobRng 时序的既有断言（白天不刷怪 / 夜里刷僵尸）会集体漂移。 */
export const NIGHT_POOL = [
  ['zombie', 5], ['spider', 3], ['skeleton', 2.5], ['creeper', 1.5], ['slime_large', 1.5],
];
/* 按权重挑一种夜间生物，roll ∈ [0,1)。
 * 抽成纯函数是为了让无头测试能**确定性**地说「roll≈1 时选中权重最低的史莱姆」
 * —— 内联在刷新逻辑里就只能写统计学断言，而那种断言每隔几周就会莫名其妙红一次。 */
export function pickNightType(roll) {
  const total = NIGHT_POOL.reduce((s, e) => s + e[1], 0);
  let v = roll * total;
  for (const [t, w] of NIGHT_POOL) { v -= w; if (v <= 0) return t; }
  return NIGHT_POOL[NIGHT_POOL.length - 1][0];
}
/* 旁观模式的「附身目标」：一个生物对象，null = 自由视角。
 * 放在生物段而不是界面段 —— updateMobs 的 48 格远距回收要跳过它，
 * 无头测试也要能直接驱动它。 */

/* 「傀儡核心」里写的 summon 必须真的对得上一种傀儡。写错了的话右键点了
 * 没反应、也不报错，是最难查的那种坏法 —— 在载入期就拦下来。 */
for (const k in SUMMON_OF)
  if (!MOB_TYPES[SUMMON_OF[k]] || !MOB_TYPES[SUMMON_OF[k]].guard)
    throw new Error('核心物品「' + ITEMS[k].name + '」指向的不是傀儡: ' + SUMMON_OF[k]);
/* 「刷怪蛋」里写的 spawn 必须真的对得上一种生物（不必是傀儡）。
 * 写错了同样是「右键没反应也不报错」的坏法 —— 载入期拦下。
 * 顺手把「13 个 MOB_TYPES 键每个都有蛋」也卡死：漏一枚就是玩家永久缺一种蛋。 */
export const EGG_MOBS = Object.keys(MOB_TYPES);
for (const k in EGG_OF)
  if (!MOB_TYPES[EGG_OF[k]])
    throw new Error('刷怪蛋「' + ITEMS[k].name + '」指向不存在的生物: ' + EGG_OF[k]);
for (const t of EGG_MOBS)
  if (!Object.values(EGG_OF).includes(t))
    throw new Error('生物「' + t + '」没有对应的刷怪蛋');
if (Object.keys(EGG_OF).length !== EGG_MOBS.length)
  throw new Error('刷怪蛋数量(' + Object.keys(EGG_OF).length + ') 与生物种类(' + EGG_MOBS.length + ') 对不上');

export const mobs = [];
export const MOB_CAP = 26;                    // 同屏上限，防止刷爆
export let mobRng = Math.random;              // 测试可替换成确定性随机
export let mobSpawnT = 2;
export let villageSpawnN = 0;                 // 村庄刷点计数（每第 4 个刷傀儡）

/* ---------------- 生成 / 销毁 ---------------- */
export function spawnMob(type, x, y, z, yaw) {
  const D = MOB_TYPES[type];
  if (!D) return null;
  const m = {
    type, x, y, z, vx: 0, vy: 0, vz: 0,
    yaw: yaw === undefined ? mobRng() * Math.PI * 2 : yaw,
    hp: D.hp, maxHp: D.hp, dead: false, silent: false,
    onGround: false, animT: 0, hurtFlash: 0, atkT: 0,
    wanderT: 0, moveX: 0, moveZ: 0, fleeT: 0, hopCd: 0,
    fuseT: 0, hopCd2: 0,        // 苦力怕引信 / 史莱姆弹跳冷却（AI 里仍带 || 0 兜底）
  };
  /* 傀儡认家：闲下来会走回出生点附近，不会被闲逛带跑，也不会因为
   * 玩家跑远就被距离回收掉（见 updateMobs 的回收条件）。 */
  if (D.guard) m.home = [x, y, z];
  mobs.push(m);
  return m;
}
export function despawnAllMobs() { mobs.length = 0; }
/* 场上傀儡数量（刷怪时用来卡上限） */
export function guardCount() {
  let n = 0;
  for (const m of mobs) if (MOB_TYPES[m.type].guard) n++;
  return n;
}
/* 傀儡能不能站在 (x, y, z)（脚底那一格）：脚下实心、这一格与头顶一路都空。
 * 放在生物段而不是「操作」段，是为了让无头测试能直接验 —— 操作段不在切片里。 */
export function canSummonAt(type, x, y, z) {
  const D = MOB_TYPES[type];
  if (!D || !D.guard) return false;
  const tall = Math.ceil(D.h);
  if (y < 1 || y + tall > H) return false;
  const cur = getEffective(x, y, z);
  if (cur !== 0 && !isLiquid(cur)) return false;
  if (!isSolid(getEffective(x, y - 1, z))) return false;
  for (let i = 1; i < tall; i++) if (isSolid(getEffective(x, y + i, z))) return false;
  return true;
}
/* 在指定位置召唤一只傀儡。成功返回那只生物，失败返回 null。
 * 上限只认 MOB_CAP —— 玩家想摆一排保镖是他的自由，
 * GUARD_CAP 限制的是「村庄自己长出来」的那种。 */
export function summonGolem(type, x, y, z, yaw) {
  if (mobs.length >= MOB_CAP) return null;
  if (!canSummonAt(type, x, y, z)) return null;
  return spawnMob(type, x + 0.5, y, z + 0.5, yaw);
}

/* 找某一列的地表高度（地形是平铺的，任意 x/z 都能读到模板对应列） */
export function surfaceY(x, z) {
  const xi = Math.floor(x), zi = Math.floor(z);
  for (let y = H - 1; y >= 1; y--) if (isSolid(getEffective(xi, y, zi))) return y;
  return -1;
}

/* ---------------- 物理：重力 + AABB 扫掠 ----------------
 *
 * 「生物走路一跳一跳」的根因就在这个函数的重力处理上：
 * 玩家的 vy 是「按键才跳、否则一路累加」的，落到地面时由 moveBodyAxis
 * 在碰撞那一帧把 vy 归零。可玩家有「按住了就持续跳」的输入语义兜着，
 * 视觉上看不出来；生物没有跳跃输入，于是变成纯粹的循环：
 *   第 N 帧   vy 从 0 自由落体 → 位移 0.002 格 → 没撞到东西
 *   第 N+1 帧 vy 继续累加     → 终于贴到地面 → vy 归零
 *   第 N+2 帧 vy 又从 0 开始  → 再次自由落体
 * 每两帧就完成一次「微跳」，整群生物走起来像在一格一格地弹。
 *
 * 正确做法是「贴地吸附」：先探脚下那一格，只要是实心的，就说明没有下落
 * 空间，直接锁 vy=0 并跳过 Y 轴扫掠 —— 生物就不会反复经历自由落体。
 * 只有脚下真的是空气（走下悬崖 / 从方块上掉下去）才走完整重力。
 *
 * 注意：这里刻意**不往 m 上挂任何新字段**（比如 hopCd）。无头测试会拿
 * 裸对象直接调 mobPhysics，缺字段会算出 NaN。节流靠已有的 m.onGround
 * 与碰撞结果自洽地表达。 */
/* 生物起跳初速：0.9 倍玩家跳跃 ≈ 1.26 格跳高。
 *
 * 为什么不能随手给个小值：这个游戏的地形是台阶状的，「往上走一步」= 抬升 1.0 格。
 * 起跳初速必须让跳高 > 1.0（即 > sqrt(2·G·1.0) ≈ 7.22，也就是 JUMP_V 的 0.80 倍），
 * 否则生物永远够不到台阶：落地 → 又差一格 → 再跳 → 落回原地，视觉上就是「一跳一跳」。
 * 旧代码在 mobPhysics 用 0.62 倍（跳高 0.60 格）、在 mobAI 用 0.8 倍（跳高 0.997 格），
 * 两个值都刚好差在线下面 —— 所以那个跳跃其实一次都没成功过，只负责原地抽搐。 */
export const MOB_HOP_V = JUMP_V * 0.9;
/* 蜘蛛爬墙速度（格/秒）。比走路略慢 —— 爬墙是该快的场面，但不该比追人还快。 */
export const SPIDER_CLIMB = 3.2;

export function mobPhysics(m, dt) {
  const D = MOB_TYPES[m.type];
  const hw = D.w / 2;
  const feet = getEffective(Math.floor(m.x), Math.floor(m.y + 0.1), Math.floor(m.z));
  const inWater = feet === I.WATER;
  const hot = !!(BLOCKS[feet] && BLOCKS[feet].hot);
  m.inWater = inWater;

  if (hot) {                                   // 岩浆里会烧死
    m.hp -= 9 * dt; m.hurtFlash = Math.max(m.hurtFlash, 0.2);
    if (m.hp <= 0) { m.dead = true; return; }
  }

  /* 飞行 boss（末影龙 / 凋灵）：跳过重力与贴地探测。
   * mobAI 会直接设 m.vy（盘旋呼吸），这里只做水平 AABB 扫掠防穿墙。
   * 不做这条短路的话，飞行 boss 会像普通生物一样经历自由落体 → 贴地 → 再落体，
   * 视觉上就是「龙在地上蹦」，fly 参数形同虚设。 */
  if (D.fly) {
    moveBodyAxis(m, hw, D.h, 'x', m.vx * dt);
    moveBodyAxis(m, hw, D.h, 'z', m.vz * dt);
    moveBodyAxis(m, hw, D.h, 'y', m.vy * dt);
    m.onGround = false;
    return;
  }

  const wasGround = !!m.onGround;

  if (inWater) {
    m.vy -= 4 * dt;
    m.vy = Math.max(m.vy, 1.4);                // 水里自动上浮
  } else {
    // 贴地探测：脚下 2 厘米内有没有实心方块。有 = 站在地上，不施加任何重力，
    // 也不做 Y 轴扫掠（扫掠本身是「先移动再回退」，那 2 毫米的位移就是抖动的来源）。
    const footY = Math.floor(m.y - 0.02);
    let grounded = false;
    const x0 = Math.floor(m.x - hw), x1 = Math.floor(m.x + hw - 1e-6);
    const z0 = Math.floor(m.z - hw), z1 = Math.floor(m.z + hw - 1e-6);
    for (let z = z0; z <= z1 && !grounded; z++)
      for (let x = x0; x <= x1; x++)
        if (isSolid(getEffective(x, footY, z))) { grounded = true; break; }

    if (grounded && m.vy <= 0.01) {
      m.y = footY + 1;                         // 精确贴合格子顶面，消掉累积误差
      m.vy = 0;
      m.onGround = true;
    } else {
      m.vy -= G * dt;
      m.vy = Math.max(m.vy, -32);
      m.onGround = false;
      moveBodyAxis(m, hw, D.h, 'y', m.vy * dt);
    }
  }
  // 水平扫掠挂在 updateMobs 的调用顺序里：先水平后垂直，避免卡角
  /* ⚠ 撞之前朝哪走必须在扫掠**之前**存下来：moveBodyAxis 一撞到墙就把
   * 对应轴的速度归零，扫掠后再读 Math.sign(m.vx) 恒为 0 —— 下面起跳 /
   * 爬墙的「前方」探测会退化成怪物自己所在格（贴着一面单格墙时永远
   * 探不到墙那一列，表现就是蜘蛛贴着墙干蹭爬不上去）。 */
  const dirVX = m.vx, dirVZ = m.vz;
  const hitX = moveBodyAxis(m, hw, D.h, 'x', m.vx * dt);
  const hitZ = moveBodyAxis(m, hw, D.h, 'z', m.vz * dt);

  /* 撞墙 / 撞台阶：只有「前方确实高出一格」才起跳。
   *
   * 旧写法是「撞到就跳」，配合上面那个每帧自由落体，只要生物贴着墙走就
   * 会连续起跳 —— 也是「一跳一跳」的另一半成因。改成先看撞到的方向上是
   * 不是真的有一格台阶：脚下同层畅通无阻就不跳，纯粹绕开。
   * 另外用 vy>=0 与 onGround 一起做节流，保证一次接触最多起跳一次。 */
  if ((hitX || hitZ) && m.onGround && !inWater) {
    const hy = Math.floor(m.y);
    const dirX = hitX ? Math.sign(dirVX) : 0, dirZ = hitZ ? Math.sign(dirVZ) : 0;
    const aheadX = Math.floor(m.x + dirX * (hw + 0.22));
    const aheadZ = Math.floor(m.z + dirZ * (hw + 0.22));
    const aheadLow = getEffective(aheadX, hy, aheadZ);
    const aheadUp  = getEffective(aheadX, hy + 1, aheadZ);
    // 前方有两格高（1 格台阶 + 自身高度）而且上面那格是空的 → 才值得跳
    if (isSolid(aheadLow) && !isSolid(aheadUp) && !isSolid(getEffective(aheadX, hy + 2, aheadZ))) {
      m.vy = MOB_HOP_V; m.onGround = false;
    }
  }

  /* 蜘蛛爬墙：被挡住、正在追目标、面前是一面**跳不上去**的高墙（2 格以上）时，
   * 沿墙直接上爬（不走重力）。1 格台阶仍然交给上面的起跳分支 ——
   * 两个分支共用同一个 hitX/hitZ 信号，不区分高度的话蜘蛛连一级台阶都要爬，
   * 看着像苍蝇卡在墙上。爬的时候 vy 清零：否则重力会把「爬」抵消成「原地抖」。
   * 只在 chasing 时爬：闲逛的蜘蛛撞墙绕开就行，别到处上房。
   *
   * 判据分两半：「头顶有方块」= 2 格以上的墙，直接爬；「脚边有方块且已经离地」
   * = 爬到墙头前最后那一格 —— 此时从蜘蛛视角看前面也是个「1 格台阶」，
   * 但不继续爬就会从墙头直直掉下去。站在地上的 1 格台阶没有这待遇（onGround），
   * 照样交给起跳分支。 */
  if (D.climb && (hitX || hitZ) && !inWater && m.chasing) {
    const dirX = hitX ? Math.sign(dirVX) : 0, dirZ = hitZ ? Math.sign(dirVZ) : 0;
    const ax = Math.floor(m.x + dirX * (hw + 0.3));
    const az = Math.floor(m.z + dirZ * (hw + 0.3));
    const hy = Math.floor(m.y);
    if (isSolid(getEffective(ax, hy + 1, az)) || (isSolid(getEffective(ax, hy, az)) && !m.onGround)) {
      moveBodyAxis(m, hw, D.h, 'y', SPIDER_CLIMB * dt);
      m.vy = 0;
      m.onGround = false;
    }
  }

  // 速度衰减：在地用强摩擦（免得滑步），空中用弱阻尼
  const onG = m.onGround || wasGround;
  m.vx *= onG ? 0.86 : 0.96;
  m.vz *= onG ? 0.86 : 0.96;
  if (m.y < -8) { m.dead = true; m.silent = true; }   // 掉出世界直接消失
}

/* ---------------- 索敌辅助 ----------------
 * 傀儡与敌对生物都要「找一个目标」，但选的不是同一批人：
 *   傀儡 → 最近的 hostile（僵尸）
 *   僵尸 → 玩家 与 最近的傀儡 里更近的那个
 * 两边都跳过自己、尸体、以及不属于那一类的目标。 */
export function nearestThreat(m, range, pred) {
  let best = null, bd = range;
  for (const o of mobs) {
    if (o === m || o.dead) continue;
    if (!pred(MOB_TYPES[o.type])) continue;
    if (Math.abs(o.y - m.y) > 10) continue;          // 高差太大就不追（爬不上去）
    const d = Math.hypot(o.x - m.x, o.z - m.z);
    if (d < bd) { bd = d; best = o; }
  }
  return best;
}
export const isHostileType = (D) => !!D.hostile;
export const isGuardType   = (D) => !!D.guard;

/* 僵尸的目标：玩家与附近的傀儡里取更近的一个。
 * ⚠ 场上没有傀儡、玩家也活着时，返回值必须与旧实现**逐字等价** ——
 * 旧的一批断言全都只放玩家，不能被这次泛化带偏。
 * 旁观模式同理：玩家「不存在」于怪物的感知里（bd = Infinity），
 * 于是怪物只会去揍傀儡 —— 旁观时看傀儡大战僵尸才是正经事。 */
export function hostileTarget(m, sight) {
  let best = player, bd = Math.hypot(player.x - m.x, player.z - m.z), kind = 'player';
  if (player.dead || mode === MODE.SPECTATOR) bd = Infinity;    // 死了就不再被追
  const g = nearestThreat(m, Math.min(sight, bd), isGuardType);
  if (g) { best = g; bd = Math.hypot(g.x - m.x, g.z - m.z); kind = 'guard'; }
  if (bd > sight || Math.abs(best.y - m.y) > 12) return null;
  return { obj: best, kind, dist: bd, dy: best.y - m.y };
}

/* 前方一步是不是水/岩浆/悬崖。闲逛掉头与傀儡归位共用，免得两处各写一份。 */
export function hazardAhead(m) {
  const ax = Math.floor(m.x + m.moveX * 1.1);
  const az = Math.floor(m.z + m.moveZ * 1.1);
  return isLiquid(getEffective(ax, Math.floor(m.y + 0.1), az))
      || !isSolid(getEffective(ax, Math.floor(m.y) - 1, az));
}
/* 沿着 (moveX, moveZ) 走一步。k 是速度倍率（归位走 0.9，闲逛走 1）。 */
export function walkOn(m, D, dt, k) {
  const sp = D.speed * (k === undefined ? 1 : k) * (m.inWater ? 0.5 : 1);
  m.vx += (m.moveX * sp - m.vx) * Math.min(1, 7 * dt);
  m.vz += (m.moveZ * sp - m.vz) * Math.min(1, 7 * dt);
}

/* ---------------- AI ---------------- */
export function mobAI(m, dt) {
  const D = MOB_TYPES[m.type];
  const dx = player.x - m.x, dz = player.z - m.z, dy = player.y - m.y;
  const dist = Math.hypot(dx, dz);

  // 被打过 → 逃跑优先（被动生物）
  if (D.passive && m.fleeT > 0) {
    m.fleeT -= dt;
    const sp = D.speed * 1.5;
    m.vx += (-dx / (dist || 1) * sp - m.vx) * Math.min(1, 9 * dt);
    m.vz += (-dz / (dist || 1) * sp - m.vz) * Math.min(1, 9 * dt);
    m.yaw = Math.atan2(-dx, -dz);
    return;
  }

  /* 傀儡：只咬敌对生物。没有敌人时先归位、再闲逛。
   * 放在 passive 之前是因为傀儡既不是 passive 也不是 hostile —— 它压根不走那两条路。 */
  if (D.guard) {
    m.hopCd = (m.hopCd || 0) - dt;
    const foe = nearestThreat(m, D.sight, isHostileType);
    if (foe) {
      const fx = foe.x - m.x, fz = foe.z - m.z;
      const fd = Math.hypot(fx, fz) || 1;
      const fdy = foe.y - m.y;
      m.chasing = true;
      m.yaw = Math.atan2(fx, fz);
      if (m.onGround && fdy > 0.55 && fdy <= 1.25 && m.hopCd <= 0) {
        m.vy = MOB_HOP_V; m.onGround = false; m.hopCd = 0.5;
      }
      m.atkT -= dt;
      if (D.throw) {
        /* 雪傀儡：太近就退、太远就靠，只在 [min, max] 这个窗口里扔雪球。
         * 不做这条「保持距离」的话它会一路贴脸，那 throw 就白设计了。 */
        const want = fd < D.throw.min ? -1 : fd > D.throw.max ? 1 : 0;
        const sp = D.speed * want;
        m.vx += (fx / fd * sp - m.vx) * Math.min(1, 6 * dt);
        m.vz += (fz / fd * sp - m.vz) * Math.min(1, 6 * dt);
        if (m.atkT <= 0 && fd <= D.throw.max && Math.abs(fdy) < 6) {
          m.atkT = D.throw.cd;
          throwSnowball(m, D, foe);
        }
      } else {
        const sp = D.speed;
        m.vx += (fx / fd * sp - m.vx) * Math.min(1, 9 * dt);
        m.vz += (fz / fd * sp - m.vz) * Math.min(1, 9 * dt);
        if (m.atkT <= 0 && fd < D.atkRange && Math.abs(fdy) < 2.4) {
          m.atkT = 1.1;
          damageMob(foe, D.dmg, fx / fd, fz / fd);
          foe.vx += fx / fd * 6.5; foe.vz += fz / fd * 6.5;
          foe.vy = Math.max(foe.vy, 3.6);
        }
      }
      return;
    }
    m.chasing = false;
    /* 归位：离出生点太远就走回去。遇水/悬崖就原地停住而不是掉头 ——
     * 归位目标是有方向的，掉头只会让它离家越来越远。 */
    if (m.home) {
      const hx = m.home[0] - m.x, hz = m.home[2] - m.z;
      const hd = Math.hypot(hx, hz);
      if (hd > 9) {
        m.moveX = hx / hd; m.moveZ = hz / hd;
        m.yaw = Math.atan2(m.moveX, m.moveZ);
        m.wanderT = 0.6;
        if (hazardAhead(m)) { m.moveX = 0; m.moveZ = 0; m.wanderT = 0; }
        else walkOn(m, D, dt, 0.9);
        return;
      }
    }
  }

  /* ---------------- Boss AI ----------------
   * boss 不走 hostile / guard / passive 任何一条既有路径，单独一支。
   * 三种 boss 共享「锁定玩家 + 保持中距」的底盘，差异在攻击方式：
   *   末影龙 / 凋灵 → 飞行 + 远程喷弹（ranged），凋灵额外周期爆破方块
   *   远古守卫   → 地面近战 + 周期召唤小史莱姆当援军
   *
   * ⚠ boss 的 fly 参数在这里生效：物理段 mobPhysics 会跳过重力（见那里），
   *   这里只管水平速度与高度维持 —— 飞行 boss 不该靠 mobAI 落地。
   * 字段一律 `|| 0` 兜底：无头测试可能拿裸对象调 mobAI。 */
  if (D.boss) {
    const sight = D.sight || 24;
    const T = hostileTarget(m, sight);        // 复用：boss 也以玩家为目标
    m.atkT = (m.atkT || 0) - dt;
    m.bombT = (m.bombT || 0) - dt;
    m.summonT = (m.summonT || 0) - dt;

    if (T) {
      const tx = T.obj.x - m.x, tz = T.obj.z - m.z;
      const td = T.dist || 1;
      m.yaw = Math.atan2(tx, tz);

      if (D.fly) {
        /* 飞行 boss：盘旋在目标上空。水平保持中距，高度用正弦呼吸。 */
        const F = D.fly;
        m.vy = Math.sin(m.animT * F.freq) * F.amp;
        const want = td < (D.ranged ? D.ranged.min : 4) ? -1 : td > (D.ranged ? D.ranged.max : 15) ? 1 : 0.3;
        const sp = D.speed * want;
        m.vx += (tx / td * sp - m.vx) * Math.min(1, 5 * dt);
        m.vz += (tz / td * sp - m.vz) * Math.min(1, 5 * dt);
      } else {
        /* 地面 boss：直接追玩家，近战。 */
        const sp = D.speed;
        m.vx += (tx / td * sp - m.vx) * Math.min(1, 8 * dt);
        m.vz += (tz / td * sp - m.vz) * Math.min(1, 8 * dt);
        if (m.atkT <= 0 && td < D.atkRange && Math.abs(T.dy) < 3) {
          m.atkT = 1.4;
          if (T.kind === 'guard') {
            damageMob(T.obj, D.dmg, tx / td, tz / td);
          } else {
            hurt(D.dmg, '你被' + D.name + '击中了');
            player.vx += tx / td * 6.0; player.vz += tz / td * 6.0;
            player.vy = Math.max(player.vy, 3.6);
          }
        }
      }

      /* 远程攻击：末影龙 / 凋灵。复用 shootArrowAt（ foe:true 只认玩家）。 */
      if (D.ranged && m.atkT <= 0 && td >= D.ranged.min && td <= D.ranged.max) {
        m.atkT = D.ranged.cd;
        shootArrowAt(m, D.ranged, T.obj);
      }

      /* 凋灵周期爆破：在目标脚下炸一个球，破坏方块 + 伤人。
       * 复用 explodeMob 的「球形破坏 + 衰减伤害」逻辑，只是中心换到玩家位置。
       * 不能直接调 explodeMob(m) —— 那会让 m.dead = true，凋灵一炸就自杀了。
       * 这里只借它的方块破坏部分，伤害单独算。 */
      if (D.witherBomb && m.bombT <= 0) {
        m.bombT = D.witherBomb.cd;
        const R = D.witherBomb.radius;
        const cx = player.x, cy = player.y + 0.6, cz = player.z;
        const r2 = R * R;
        for (let y = Math.max(1, Math.floor(cy - R)); y <= Math.ceil(cy + R); y++)
          for (let z = Math.floor(cz - R); z <= Math.ceil(cz + R); z++)
            for (let x = Math.floor(cx - R); x <= Math.ceil(cx + R); x++) {
              const d2 = (x + 0.5 - cx) * (x + 0.5 - cx) + (y + 0.5 - cy) * (y + 0.5 - cy) + (z + 0.5 - cz) * (z + 0.5 - cz);
              if (d2 > r2) continue;
              const id = getEffective(x, y, z);
              if (!id || isLiquid(id)) continue;
              const B = BLOCKS[id];
              if (B && B.hard >= 6) continue;
              if (typeof setBlock === 'function') setBlock(x, y, z, 0);
            }
        const pd = Math.hypot(player.x - cx, player.y - cy, player.z - cz);
        if (pd < R) hurt(D.witherBomb.dmg * (1 - pd / R), '你被凋灵的爆破击中了');
        if (typeof noiseBurst === 'function') noiseBurst(0.6, 0.20, 160);
      }

      /* 远古守卫周期召唤援军：场上小史莱姆不超过 cap 就再召 n 只。 */
      if (D.summonAdds && m.summonT <= 0) {
        let count = 0;
        for (const o of mobs) if (o.type === D.summonAdds.type) count++;
        if (count < D.summonAdds.cap && mobs.length < MOB_CAP) {
          m.summonT = D.summonAdds.cd;
          for (let i = 0; i < D.summonAdds.n; i++) {
            const a = mobRng() * Math.PI * 2, r = 3 + mobRng() * 2;
            spawnMob(D.summonAdds.type, m.x + Math.cos(a) * r, m.y, m.z + Math.sin(a) * r, mobRng() * Math.PI * 2);
          }
          if (typeof spawnParticles === 'function')
            spawnParticles(m.x, m.y + 1, m.z, [108, 188, 114]);
        }
      }
      return;
    }
    /* 没目标时：飞行 boss 悬停，地面 boss 闲逛（走下面默认分支） */
    if (D.fly) { m.vx *= 0.92; m.vz *= 0.92; m.vy = Math.sin(m.animT * D.fly.freq) * D.fly.amp * 0.5; return; }
  }

  if (D.hostile) {
    // 看得见玩家 / 傀儡就追，贴脸就打。夜里视野更远
    const sight = D.sight * (isNight() ? 1.25 : 0.85);
    const T = hostileTarget(m, sight);
    if (T) {
      const tx = T.obj.x - m.x, tz = T.obj.z - m.z;
      const td = T.dist || 1;
      m.yaw = Math.atan2(tx, tz);
      m.chasing = true;                    // 蜘蛛爬墙的判据（见 mobPhysics）
      /* 上台阶起跳。旧条件只有一句「只要 dy > 1.1 就跳」，两个毛病：
       *   ① 当时的起跳初速只够跳 1.00 格，却拿 1.1 当门槛 —— 要跳的比能跳的还高，
       *      于是「落地 → 还差 1.2 格 → 再跳 → 落回原地」成了永动机（实测 400 帧里
       *      生物只有 41 帧沾地，其余全在空中做约 1 格的往复振荡）；
       *   ② 真正该跳的「上一格台阶」恰好是 dy = 1.0，反而被这个门槛挡在外面。
       * 现在按「跳得上去才跳」的原则写成区间，并且用自愈式冷却兜住边界抖动
       * （hopCd 用 `|| 0` 取默认值，裸对象直接调 mobAI 也不会是 NaN）。
       * 史莱姆除外 —— 它的弹跳自己管（下面 D.hop 分支），两套起跳叠在一起会抽搐。 */
      if (!D.hop) {
        m.hopCd = (m.hopCd || 0) - dt;
        if (m.onGround && T.dy > 0.55 && T.dy <= 1.25 && m.hopCd <= 0) {
          m.vy = MOB_HOP_V;
          m.onGround = false;
          m.hopCd = 0.5;
        }
      }
      m.atkT -= dt;

      if (D.ranged) {
        /* 骷髅：只在 [min, max] 窗口里站桩射箭；太近后退、太远逼近。
         * 不做这条「保持距离」它会一路贴脸，ranged 就白设计了
         * （和雪傀儡的 throw.min/max 同一个思路）。窗口内只做小幅游走，
         * 站定才像个射手。 */
        const want = td < D.ranged.min ? -1 : td > D.ranged.max ? 1 : 0;
        const sp = D.speed * (want === 0 ? 0.4 : 1);
        m.vx += (tx / td * sp - m.vx) * Math.min(1, 7 * dt);
        m.vz += (tz / td * sp - m.vz) * Math.min(1, 7 * dt);
        if (m.atkT <= 0 && td <= D.ranged.max && Math.abs(T.dy) < 8) {
          shootArrowAt(m, D.ranged, T.obj);
        }
      } else if (D.fuse) {
        /* 苦力怕：逼到引信距离就停步站住，引信烧完就炸。
         * 引信只在「目标还在 range 内」时累积，被拉开超过 range 就回落 ——
         * 否则追人追到一半目标凭空消失（跳出窗口 / 切模式），留下一个永远在
         * 倒计时的哑炮在原地走。站定不走也是刻意的：会移动的炸弹没法预判。 */
        if (td > D.fuse.range * 0.55) {
          const sp = D.speed;
          m.vx += (tx / td * sp - m.vx) * Math.min(1, 9 * dt);
          m.vz += (tz / td * sp - m.vz) * Math.min(1, 9 * dt);
        } else { m.vx *= 0.82; m.vz *= 0.82; }
        if (td < D.fuse.range) {
          if (m.fuseT <= 0 && typeof noiseBurst === 'function') noiseBurst(0.5, 0.05, 2600);  // 点燃引信的嘶声
          m.fuseT += dt;
        } else {
          m.fuseT = Math.max(0, m.fuseT - dt * 2);
        }
        if (m.fuseT >= D.fuse.time) { explodeMob(m); return; }
      } else {
        /* 僵尸 / 蜘蛛 / 史莱姆：近战家族。僵尸蜘蛛照原样追，
         * 史莱姆把「走」换成「弹」。 */
        if (D.hop) {
          /* 史莱姆不走路：朝目标一下一下地弹。只在落地瞬间重新起跳，
           * 滞空期间不管方向 —— 弹跳物的手感就在这个「不灵活」上。
           * hopCd2 是起跳间隔（和上楼梯的 hopCd 不是一回事，别混）。 */
          m.hopCd2 = (m.hopCd2 || 0) - dt;
          if (m.onGround && m.hopCd2 <= 0) {
            m.vy = MOB_HOP_V * D.hop.power;
            m.onGround = false;
            m.vx = tx / td * D.speed;
            m.vz = tz / td * D.speed;
            m.hopCd2 = D.hop.cd;
          }
        } else {
          const sp = D.speed;
          m.vx += (tx / td * sp - m.vx) * Math.min(1, 9 * dt);
          m.vz += (tz / td * sp - m.vz) * Math.min(1, 9 * dt);
        }
        if (m.atkT <= 0 && td < D.atkRange && Math.abs(T.dy) < 2.2) {
          m.atkT = 1.0;
          const k = 5.2;
          const nx = tx / td, nz = tz / td;
          if (T.kind === 'guard') {
            /* 傀儡挡在中间就先揍傀儡 —— 否则「召唤一个保镖」这件事毫无战术价值。 */
            damageMob(T.obj, D.dmg, nx, nz);
            T.obj.vx += nx * k; T.obj.vz += nz * k;
            T.obj.vy = Math.max(T.obj.vy, 3.4);
          } else {
            hurt(D.dmg, '你被' + D.name + '打死了');
            player.vx += nx * k;
            player.vz += nz * k;
            player.vy = Math.max(player.vy, 3.4);
          }
        }
      }
      return;
    }
    m.chasing = false;
  }

  // 闲逛：走一会儿停一会儿
  m.wanderT -= dt;
  if (m.wanderT <= 0) {
    m.wanderT = 1.8 + mobRng() * 3.6;
    if (mobRng() < 0.32) { m.moveX = 0; m.moveZ = 0; }
    else {
      const a = mobRng() * Math.PI * 2;
      m.moveX = Math.cos(a); m.moveZ = Math.sin(a);
      m.yaw = Math.atan2(m.moveX, m.moveZ);
    }
  }
  if (m.moveX || m.moveZ) {
    // 前方是水/岩浆/悬崖就先掉头，免得集体跳海
    if (hazardAhead(m)) {
      m.moveX = -m.moveX; m.moveZ = -m.moveZ;
      m.yaw = Math.atan2(m.moveX, m.moveZ);
      m.wanderT = Math.min(m.wanderT, 0.6);
    }
    walkOn(m, D, dt);
  }
}

/* ---------------- 每帧推进 ---------------- */
export function updateMobs(dt, doSpawn = true) {
  worldTime += dt;
  /* 生存 / 旁观模式都会刷新新怪。创造模式是「建筑模式」，凭空冒出僵尸只会碍事；
   * 切过去时场上已有的那批由 setMode() 负责清空。
   * 旁观模式照旧刷：那一模式的全部意义就是「世界继续运转给我看」——
   * 不刷怪的话飞进夜里只能对着一片空地，昼夜循环也跟着没了观众。 */
  if (doSpawn && (mode === MODE.SURVIVAL || mode === MODE.SPECTATOR)) updateMobSpawn(dt);
  for (let i = mobs.length - 1; i >= 0; i--) {
    const m = mobs[i];
    m.animT += dt;
    m.hurtFlash = Math.max(0, m.hurtFlash - dt);
    if (m.dead) { mobs.splice(i, 1); continue; }
    mobPhysics(m, dt);
    if (m.dead) {
      if (!m.silent) mobDeathDrop(m);
      mobs.splice(i, 1);
      continue;
    }
    mobAI(m, dt);
    /* 走远了就回收。傀儡除外 —— 它们认家（m.home），玩家回基地时得还在；
     * 数量由 GUARD_CAP 卡着，不会因此越攒越多。
     * boss 同理除外 —— 它是玩家主动召唤的挑战，不该因为玩家走远就消失
     * （否则打一半跑开两步 boss 就没了，毫无紧张感）。
     * 「正在被附身观看」的那只也除外：旁观者的相机骑在它身上，
     * 它一被回收，视角就会「啪」地弹回自由模式。 */
    if (!MOB_TYPES[m.type].guard && !MOB_TYPES[m.type].boss && m !== spectate && Math.hypot(m.x - player.x, m.z - player.z) > 48) mobs.splice(i, 1);
  }
}
export function mobDeathDrop(m) {
  const D = MOB_TYPES[m.type];
  if (D.drop) invAdd(D.drop, D.dropN || 1);
  /* boss 专属战利品：星陨装备的**唯一**材料来源（见 config.js 的 262-264）。
   * 数量固定、不掷骰 —— 打一场 boss 掉多少是可预期的，玩家才敢规划
   * 「再打两场就能凑齐一套星陨甲」。掷骰的话终局装备会变成抽奖。
   * 普通生物不登记 loot 字段，所以这条路对它们完全不生效。 */
  if (D.loot) for (const [id, n] of D.loot) invAdd(id, n);
}

/* 异界刷怪的落点：从玩家所在高度向上下各找一个「脚下一格实心、上面两格空气」的位置。
 * ⚠ 不能直接用 surfaceY —— 晶簇洞天的最高实心是洞顶那层岩壳，
 * 按它刷会把怪全刷到屋顶上（玩家一辈子看不见）。 */
export function dimSpawnY(x, z, yRef) {
  for (let d = 0; d <= 26; d++) {
    for (const y of [yRef - d, yRef + d]) {
      if (y < 2 || y > H - 3) continue;
      if (!isSolid(getEffective(x, y, z))) continue;
      if (isSolid(getEffective(x, y + 1, z)) || isSolid(getEffective(x, y + 2, z))) continue;
      return y;
    }
  }
  return -1;
}

/* 异界刷怪：与主世界**完全独立**的一套规则。
 *   · 只刷该维度档案里列出的生物（pool = 敌对 / passive = 被动）
 *   · alwaysNight 的维度敌对生物常驻（那儿没有「白天」这回事）
 *   · alwaysDay 的维度永不刷敌对（炙沙之境 / 天空花园，代价是也没有怪打）
 * 为什么不并进主世界的总闸里：主世界那条分支序列被 375 项回归用 scripted
 * mobRng 逐项钉死了（白天几次、夜里几次、顺序如何）。异界多消费一次 mobRng，
 * 主世界的时序断言就会整体漂移 —— 所以这里是另一条路径，从入口就分开。 */
export function dimMobSpawn() {
  const D = DIMS[dim];
  /* 敌对：常夜维度常驻，永昼维度永不刷，其余（腐化沼泽）跟昼夜走 ——
   * 与主世界「白天任何情况都不刷敌对」的方向一致。
   * 被动：永昼维度随便刷，其余只在天亮的时候刷（夜里刷猪羊不合理，
   * 也和主世界那条「夜里零非敌对」的规则对齐）。 */
  const hostileOk = D.alwaysNight || (!D.alwaysDay && isNight());
  const passiveOk = D.alwaysDay || !isNight();
  const pool = hostileOk && D.pool && D.pool.length ? D.pool : null;
  const pas = passiveOk && D.passive && D.passive.length ? D.passive : null;
  if (!pool && !pas) return;
  const yRef = Math.floor(player.y);
  for (let attempt = 0; attempt < 8; attempt++) {
    const a = mobRng() * Math.PI * 2;
    const r = 15 + mobRng() * 17;                       // 别在眼皮底下凭空冒出来
    const x = Math.floor(player.x + Math.cos(a) * r);
    const z = Math.floor(player.z + Math.sin(a) * r);
    const h = dimSpawnY(x, z, yRef);
    if (h < 1) continue;
    const ground = getEffective(x, h, z);
    if (isLiquid(ground) || !isSolid(ground)) continue;
    if (pool && mobRng() < 0.62) {
      spawnMob(pool[Math.floor(mobRng() * pool.length) % pool.length], x + 0.5, h + 1, z + 0.5);
      return;
    }
    if (pas && mobRng() < 0.45) {
      spawnMob(pas[Math.floor(mobRng() * pas.length) % pas.length], x + 0.5, h + 1, z + 0.5);
      return;
    }
  }
}

export function updateMobSpawn(dt) {
  mobSpawnT -= dt;
  if (mobSpawnT > 0) return;
  mobSpawnT = 1.4;
  if (mobs.length >= MOB_CAP || player.dead) return;
  /* 异界从入口就分道扬镳，绝不落进下面主世界那条总闸（理由见 dimMobSpawn） */
  if (dim !== 0) { dimMobSpawn(); return; }
  /* ⚠⚠ 刷怪总闸：**敌对生物只在夜里刷，白天任何情况都不刷**。
   *
   * 这不是「每个分支各自判一次 night」—— 那种写法迟早被人加新怪时漏写
   * 门控，或者给某个分支开后门（「低于海平面的深坑也算 dark」这种后门
   * 真实踩过：玩家白天挖到地下峡谷被僵尸围）。现在结构上保证：
   * isNight() 为假时直接走下面的白天块并 return，夜里的整个刷怪循环
   * 根本不执行 —— 白天无论光照多黑、坑多深、RNG 掷出 0.0001，
   * 都不存在能刷出敌对怪的代码路径。
   *
   * 想加新的敌对生物 → 只改 NIGHT_POOL 权重表，别在夜里的循环下面开新分支。
   * 想加新的非敌对生物 → 只许加在白天的块里。 */
  if (!isNight()) {
    /* --- 白天：只刷非敌对生物 --- */
    // 先试「村庄村民」：玩家附近有村庄聚落就优先在那儿刷村民，
    // 这样村庄才像有人住，而不是空房子摆着。
    if (mobRng() < 0.45) {
      const v = findNearbyVillage(player.x, player.z);
      if (v) {
        const a = mobRng() * Math.PI * 2, r = 2 + mobRng() * 9;
        const x = Math.floor(v.x + Math.cos(a) * r), z = Math.floor(v.z + Math.sin(a) * r);
        const h = surfaceY(x, z);
        if (h >= 1) {
          const g = getEffective(x, h, z);
          const above = getEffective(x, h + 1, z);
          // 必须站在实心地上、头上有空间 —— 否则会卡在墙里
          if (isSolid(g) && !isSolid(above)) {
            /* 每第 4 个村庄刷点放一个傀儡当守卫。
             * 用确定性计数而不是再掷一次骰子：既不打乱依赖 mobRng 时序的既有断言，
             * 也保证第一个刷点一定是村民。傀儡另有 GUARD_CAP 卡着数量，
             * 而且只在村庄刷 —— 不打进村庄就永远见不到它们。
             * 傀儡高 2 格以上，头顶得再空两格，不然会顶穿屋顶。 */
            const tallBlocked = isSolid(getEffective(x, h + 2, z)) || isSolid(getEffective(x, h + 3, z));
            if (++villageSpawnN % 4 === 0 && !tallBlocked && guardCount() < GUARD_CAP) {
              spawnMob(GUARD_TYPES[(villageSpawnN / 4 - 1) % GUARD_TYPES.length], x + 0.5, h + 1, z + 0.5);
              return;
            }
            spawnMob('villager', x + 0.5, h + 1, z + 0.5);
            return;
          }
        }
      }
    }
    // 荒野草地上刷被动生物（猪 / 羊 / 鸡）—— 生存模式的白天食物来源
    for (let attempt = 0; attempt < 8; attempt++) {
      const a = mobRng() * Math.PI * 2;
      const r = 15 + mobRng() * 17;                       // 别在眼皮底下凭空冒出来
      const x = Math.floor(player.x + Math.cos(a) * r);
      const z = Math.floor(player.z + Math.sin(a) * r);
      const h = surfaceY(x, z);
      if (h < 1) continue;
      const ground = getEffective(x, h, z);
      if (isLiquid(ground) || !isSolid(ground)) continue;
      if (ground === I.GRASS) {
        const t = PASSIVE_TYPES[Math.floor(mobRng() * PASSIVE_TYPES.length) % PASSIVE_TYPES.length];
        spawnMob(t, x + 0.5, h + 1, z + 0.5);
        return;
      }
    }
    return;
  }
  /* --- 夜里：只刷敌对生物（僵尸 + 夜间池） ---
   * 僵尸：**只有夜里刷**。白天任何情况都不刷 ——
   * 曾经放过 `h + 1 <= SEA` 的「低于海平面的深坑也算 dark」后门，
   * 玩家白天挖到地下峡谷照样被僵尸围，现在这条后门堵死了，而且整段
   * 都被上面的总闸挡着，连「再开后门」的入口都没有。
   * 注意判据必须用「是不是夜」而不是别的 —— 曾经写成 h < 30 结果整个地图白天都在刷僵尸。 */
  for (let attempt = 0; attempt < 8; attempt++) {
    const a = mobRng() * Math.PI * 2;
    const r = 15 + mobRng() * 17;                       // 别在眼皮底下凭空冒出来
    const x = Math.floor(player.x + Math.cos(a) * r);
    const z = Math.floor(player.z + Math.sin(a) * r);
    const h = surfaceY(x, z);
    if (h < 1) continue;
    const ground = getEffective(x, h, z);
    if (isLiquid(ground) || !isSolid(ground)) continue;
    if (mobRng() < 0.62) {
      spawnMob('zombie', x + 0.5, h + 1, z + 0.5);
      return;
    }
    /* 夜间新怪池（蜘蛛/骷髅/苦力怕/史莱姆）：僵尸之后独立掷一次骰。
     * ⚠ 顺序不能反 —— 僵尸分支一个 mobRng 都不许多消费，否则依赖 mobRng
     * 时序的既有断言（白天不刷怪 / 夜里刷僵尸）会集体漂移，详见 NIGHT_POOL 处的警告。
     * 同样只在夜里：白天深坑里也不刷（现在有总闸兜底，双保险）。 */
    if (mobRng() < 0.35) {
      spawnMob(pickNightType(mobRng()), x + 0.5, h + 1, z + 0.5);
      return;
    }
  }
}

/* 找玩家附近有没有村庄/雪原聚落（结构格 3 或 7），有就返回锚点。
 * 只查周边 3×3 个结构格 —— 结构半径远小于 CELL，这个范围足够。 */
export function findNearbyVillage(px, pz) {
  const gx = Math.floor(px / CELL), gz = Math.floor(pz / CELL);
  let best = null, bestD = 1e9;
  for (let dz = -1; dz <= 1; dz++)
    for (let dx = -1; dx <= 1; dx++) {
      const t = structAt(gx + dx, gz + dz);
      if (t !== 3 && t !== 7) continue;                 // 3 村庄 / 7 雪原聚落
      const a = structAnchor(gx + dx, gz + dz);
      if (!a) continue;
      const d = Math.hypot(a.x - px, a.z - pz);
      if (d < bestD) { bestD = d; best = a; }
    }
  return best;
}

/* ---------------- 生物几何（纯数据，GPU 上传在渲染段） ----------------
 * 用 FACES 的六面单位立方体拼盒子：每个盒子 24 顶点 / 12 三角形。
 * parts 里记下每块的索引区间与摆动支点，绘制时按块给不同的 uModel。 */
/* 造一个轴对齐盒子的六个面。flag 是材质标志（生物/箭/手持一律普通料）。
 * 盒子是静的，摇晃/流动都交给 shader 按世界坐标算，这里不需要额外信息。 */
export function boxGeo(pos, uv, lit, alp, flag, box, at, texName) {
  const tile = TILE_INDEX[texName] === undefined ? 0 : TILE_INDEX[texName];
  const ox = at[0] - box[0] / 2, oy = at[1] - box[1] / 2, oz = at[2] - box[2] / 2;
  for (let f = 0; f < 6; f++) {
    const F = FACES[f];
    for (let k = 0; k < 4; k++) {
      const v = F.v[k];
      pos.push(ox + v[0] * box[0], oy + v[1] * box[1], oz + v[2] * box[2]);
      const q = UV_QUAD[k];
      const t = tileUV(tile, q[0], q[1]);
      uv.push(t[0], t[1]);
      lit.push(F.shade);
      alp.push(1);
      flag.push(MAT_PLAIN);
    }
  }
}
export function buildMobMesh(type) {
  const D = MOB_TYPES[type];
  if (!D) return null;
  const pos = [], uv = [], lit = [], alp = [], flag = [], idx = [], parts = [];
  for (const p of D.parts) {
    const vBase = pos.length / 3;
    const iBase = idx.length;
    boxGeo(pos, uv, lit, alp, flag, p.box, p.at, p.tex);
    for (let f = 0; f < 6; f++) {
      const b = vBase + f * 4;
      idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
    }
    parts.push({
      start: iBase, count: idx.length - iBase,
      pivot: [p.at[0], p.at[1] + p.box[1] / 2, p.at[2]],
      leg: p.leg || 0, phase: (p.leg || 0) % 2 ? 1 : -1,
      arm: p.arm || 0,
    });
  }
  return {
    pos: new Float32Array(pos), uv: new Float32Array(uv),
    lit: new Float32Array(lit), alp: new Float32Array(alp),
    flag: new Float32Array(flag),
    idx: new Uint32Array(idx), parts,
  };
}

/* ---------------- 射线打生物 ----------------
 * 返回最近的命中：{ mob, dist }。用标准 slab 法。 */
export function rayBox(ox, oy, oz, dx, dy, dz, min, max) {
  let t0 = 0, t1 = 1e9;
  const o = [ox, oy, oz], d = [dx, dy, dz];
  for (let i = 0; i < 3; i++) {
    if (Math.abs(d[i]) < 1e-8) {
      if (o[i] < min[i] || o[i] > max[i]) return -1;
      continue;
    }
    const inv = 1 / d[i];
    let a = (min[i] - o[i]) * inv, b = (max[i] - o[i]) * inv;
    if (a > b) { const t = a; a = b; b = t; }
    if (a > t0) t0 = a;
    if (b < t1) t1 = b;
    if (t0 > t1) return -1;
  }
  return t0;
}
export function mobBounds(m) {
  const D = MOB_TYPES[m.type];
  return [[m.x - D.w / 2, m.y, m.z - D.w / 2], [m.x + D.w / 2, m.y + D.h, m.z + D.w / 2]];
}
export function raycastMob(ox, oy, oz, dx, dy, dz, maxD) {
  let best = null;
  for (const m of mobs) {
    const [mn, mx] = mobBounds(m);
    const t = rayBox(ox, oy, oz, dx, dy, dz, mn, mx);
    if (t < 0 || t > maxD) continue;
    if (!best || t < best.dist) best = { mob: m, dist: t };
  }
  return best;
}
/* 打一下生物。knock 给击退方向 */
export function damageMob(m, n, kx, kz) {
  if (m.dead) return;
  m.hp -= n;
  m.hurtFlash = 0.35;
  if (kx !== undefined) { m.vx += kx * 5.5; m.vz += kz * 5.5; m.vy = Math.max(m.vy, 3.2); }
  if (MOB_TYPES[m.type].passive) m.fleeT = 4.5;      // 被打就跑
  if (m.hp <= 0) {
    m.dead = true;
    mobDeathDrop(m);
    /* 史莱姆分裂：大史莱姆倒下时弹出两只小的。小的没有 split 字段，不会套娃。
     * 出生点带一点横向错位，否则两只会重叠着互相挤；各给一点起跳速度，
     * 「弹开」比「原地出现」更有分裂感。 */
    const D = MOB_TYPES[m.type];
    if (D.split) {
      for (let i = 0; i < (D.splitN || 2); i++) {
        const c = spawnMob(D.split, m.x + (i === 0 ? -0.25 : 0.25), m.y, m.z, mobRng() * Math.PI * 2);
        if (c) { c.vy = MOB_HOP_V * 0.7; c.hopCd2 = 0.25 + i * 0.2; }
      }
    }
  }
}
/* 玩家挥击：准星指向生物时打它。返回是否打到了。
 * blockDist 是准星到方块的距离 —— 生物比方块远就说明准星其实是对着墙，
 * 这时不该隔墙打怪。 */

/* 第一人称手持物的挥击动画进度（1 → 0 衰减）。打中生物、挖破方块、射箭都会踢一脚。 */

export function tryAttackMob(dt, blockDist = Infinity) {
  setSwingT(swingT - dt);
  if (swingT > 0) return false;
  const p = player;
  const cp = Math.cos(p.pitch), sp = Math.sin(p.pitch);
  const dir = [-Math.sin(p.yaw) * cp, sp, -Math.cos(p.yaw) * cp];
  const eye = p.y + EYE;
  const hit = raycastMob(p.x, eye, p.z, dir[0], dir[1], dir[2], REACH);
  if (!hit || hit.dist >= blockDist) return false;
  setSwingT(0.32);
  setHandSwing(1);
  damageMob(hit.mob, attackDamage(), dir[0], dir[2]);
  return true;
}

/* ---------------- 弓箭 ----------------
 * 按住右键蓄力，松手射出：蓄得越久飞得越快、伤害越高。
 * 箭是消耗品，命中方块或生物后消失（打生物会掉血 + 击退）。
 *
 * 这段刻意不碰 DOM/WebGL —— 无头测试要能直接驱动「射一箭 → 看它掉下来 / 打中东西」。
 * 所以粒子的调用用 typeof 兜底：「操作」段不在测试的切片范围里，
 * 直接写 spawnParticles(...) 会在沙箱里 ReferenceError。 */
export const arrows = [];
export const ARROW_GRAV = 15;


export function fireArrow(power) {
  const p = player;
  const cp = Math.cos(p.pitch), sp = Math.sin(p.pitch);
  const dx = -Math.sin(p.yaw) * cp, dy = sp, dz = -Math.cos(p.yaw) * cp;
  const v = 17 + power * 20;
  arrows.push({
    x: p.x + dx * 0.4, y: p.y + EYE - 0.12 + dy * 0.4, z: p.z + dz * 0.4,
    vx: dx * v, vy: dy * v + power * 2.4, vz: dz * v,
    life: 6, dmg: 3 + Math.round(power * 4),
  });
  setHandSwing(1);
  return true;
}
/* 傀儡扔出的雪球。
 * 复用 arrows 数组（同一套子步进飞行 / 命中判定 / 寿命回收），只多带两个字段：
 *   ally: true → 只打 hostile，绝不打自己人（见 updateArrows 的过滤）
 *   snow: true → 渲染成一个雪球而不是箭
 * 初速按抛物线反解：先估飞行时间 t = 水平距离 / 水平速度，把竖直速度补成
 * 「落到目标那一格」所需的量 —— 不补偿的话雪球会全部砸在目标脚前。 */
export const SNOWBALL_GRAV = ARROW_GRAV;
export function throwSnowball(m, D, foe) {
  const dx = foe.x - m.x, dz = foe.z - m.z;
  const dh = Math.hypot(dx, dz) || 1;
  const v = D.throw.speed;
  const t = dh / v;
  const aimY = foe.y + (MOB_TYPES[foe.type].h || 1) * 0.55;
  const dy = aimY - (m.y + 1.05);
  const vy = dy / t + 0.5 * SNOWBALL_GRAV * t;
  arrows.push({
    x: m.x, y: m.y + 1.05, z: m.z,
    vx: dx / dh * v, vy, vz: dz / dh * v,
    life: 4, dmg: D.throw.dmg, ally: true, snow: true,
  });
  m.atkT = D.throw.cd;
  return true;
}
/* 骷髅射出的箭。
 * 和雪球同一套复用：arrows 数组 + 子步进飞行 + 寿命回收，只多一个字段：
 *   foe: true → 只认玩家（见 updateArrows 的分流），打不到别的怪
 * 抛物线瞄准照抄 throwSnowball 的反解式 —— 不补偿重力的话箭会全部插在脚前。
 * 目标可能是玩家（没有 MOB_TYPES 条目），身高回退 1.8。
 * 渲染上不另开网格：还是那根箭，drawArrows 里按 foe 染一层红色以示敌我。 */
export function shootArrowAt(m, R, foe) {
  const dx = foe.x - m.x, dz = foe.z - m.z;
  const dh = Math.hypot(dx, dz) || 1;
  const t = dh / R.speed;
  const foeH = MOB_TYPES[foe.type] ? MOB_TYPES[foe.type].h : 1.8;
  const aimY = foe.y + foeH * 0.6;
  const dy = aimY - (m.y + 1.2);
  const vy = dy / t + 0.5 * ARROW_GRAV * t;
  arrows.push({
    x: m.x, y: m.y + 1.2, z: m.z,
    vx: dx / dh * R.speed, vy, vz: dz / dh * R.speed,
    life: 5, dmg: R.dmg, foe: true,
  });
  m.atkT = R.cd;
  return true;
}
/* 凋灵法杖的魔法弹。
 * 复用 arrows 数组（同一套子步进飞行 / 命中判定 / 寿命回收），只多一个字段：
 *   magic: true → ① 几乎不受重力（见 updateArrows 的重力系数）
 *                 ② 命中方块时炸出紫色的粒子而不是灰白灰
 * 速度给到 26（比满蓄力的箭 37 慢、比半蓄力快）：法杖是「指哪打哪」，
 * 不是「抛射」，飞太慢会让人以为打偏了。 */
export function fireMagicBolt(dmg = 7) {
  const p = player;
  const cp = Math.cos(p.pitch), sp = Math.sin(p.pitch);
  const dx = -Math.sin(p.yaw) * cp, dy = sp, dz = -Math.cos(p.yaw) * cp;
  const v = 26;
  arrows.push({
    x: p.x + dx * 0.5, y: p.y + EYE - 0.1 + dy * 0.5, z: p.z + dz * 0.5,
    vx: dx * v, vy: dy * v, vz: dz * v,
    life: 2.6, dmg, magic: true,
  });
  setHandSwing(1);
  return true;
}
/* 苦力怕爆炸：引信烧完的那一刻。三件事——
 *   ① 球形破坏方块（黑曜石级 hard>=6 炸不动；液体跳过，别把海抽干）
 *   ② 按距离衰减打玩家，并沿爆炸方向击退
 *   ③ 无差别炸伤周围生物（傀儡挨一下很疼；僵尸同理，苦力怕清场名场面）
 * 掉落在函数里直接结算：m.dead 置位后，下一帧会被 updateMobs 循环**顶部**
 * 那条「已死直接收走」的分支接住，不会二次掉落。
 * 音效/粒子函数住在「音效 / 操作」段，不在无头测试切片里 —— typeof 兜底，
 * 和 updateArrows 里对 spawnParticles 的处理同一个套路。 */
export function explodeMob(m) {
  const D = MOB_TYPES[m.type];
  const R = D.fuse.radius;
  const cx = m.x, cy = m.y + 0.6, cz = m.z;
  m.dead = true;
  mobDeathDrop(m);
  const r2 = R * R, reach = R + 1.2;
  for (let y = Math.max(1, Math.floor(cy - R)); y <= Math.ceil(cy + R); y++)
    for (let z = Math.floor(cz - R); z <= Math.ceil(cz + R); z++)
      for (let x = Math.floor(cx - R); x <= Math.ceil(cx + R); x++) {
        const d2 = (x + 0.5 - cx) * (x + 0.5 - cx) + (y + 0.5 - cy) * (y + 0.5 - cy) + (z + 0.5 - cz) * (z + 0.5 - cz);
        if (d2 > r2) continue;
        const id = getEffective(x, y, z);
        if (!id || isLiquid(id)) continue;
        if (BLOCKS[id] && BLOCKS[id].hard >= 6) continue;      // 黑曜石：炸不动
        setBlock(x, y, z, 0);
      }
  // 玩家：距离衰减 + 击退。旁观模式下玩家不存在于爆炸里（hurt 也会挡，但别顺带把人轰飞）
  const pd = Math.hypot(player.x - cx, player.z - cz);
  if (mode !== MODE.SPECTATOR && pd < reach && Math.abs(player.y + 0.9 - cy) < R + 1.2) {
    const falloff = 1 - pd / reach;
    hurt(Math.max(1, Math.round(D.fuse.dmg * falloff)), '你被苦力怕炸死了');
    if (pd > 0.01) {
      player.vx += (player.x - cx) / pd * 9 * falloff;
      player.vz += (player.z - cz) / pd * 9 * falloff;
    }
    player.vy = Math.max(player.vy, 6 * falloff);
  }
  /* 周围生物：先快照再遍历 —— 史莱姆被炸死会分裂、往 mobs 里 push 新对象，
   * 直接 for-of 活着数组会让刚分裂出来的小史莱姆也吃一次爆炸伤害。 */
  for (const o of mobs.slice()) {
    if (o === m || o.dead) continue;
    const od = Math.hypot(o.x - cx, o.z - cz);
    if (od < reach && Math.abs(o.y + 0.5 - cy) < R + 1.2)
      damageMob(o, Math.max(1, Math.round(D.fuse.dmg * (1 - od / reach))),
                (o.x - cx) / (od || 1), (o.z - cz) / (od || 1));
  }
  if (typeof spawnParticles === 'function')
    for (let i = 0; i < 4; i++) spawnParticles(cx, cy + 0.4, cz, [110 + i * 20, 100 + i * 15, 96]);
  if (typeof noiseBurst === 'function') noiseBurst(0.45, 0.22, 620);
  if (typeof blip === 'function') blip(64, 0.4, 'sawtooth', 0.14);
}
/* 推进全部箭矢，返回本帧命中的生物数（测试直接断言这个） */
export function updateArrows(dt) {
  let hits = 0;
  const puff = typeof spawnParticles === 'function' ? spawnParticles : null;
  for (let i = arrows.length - 1; i >= 0; i--) {
    const a = arrows[i];
    a.life -= dt;
    if (a.life <= 0) { arrows.splice(i, 1); continue; }
    a.vy -= (a.magic ? ARROW_GRAV * 0.06 : ARROW_GRAV) * dt;
    /* 分子步进：满蓄力 37 格/秒、一帧走 0.6 格，不细分会直接穿过一格厚的墙 */
    const speed = Math.hypot(a.vx, a.vy, a.vz);
    const steps = Math.max(1, Math.ceil(speed * dt / 0.2));
    const sdt = dt / steps;
    let gone = false;
    for (let s = 0; s < steps && !gone; s++) {
      a.x += a.vx * sdt; a.y += a.vy * sdt; a.z += a.vz * sdt;
      const by = Math.floor(a.y);
      if (by < 0 || by >= H || isSolid(getEffective(Math.floor(a.x), by, Math.floor(a.z)))) {
        if (puff) puff(a.x, a.y, a.z, a.magic ? [168, 120, 240] : a.snow ? [238, 244, 252] : [168, 168, 172]);
        arrows.splice(i, 1); gone = true; break;
      }
      /* 敌方弹药（骷髅的箭）只认玩家，压根不进生物循环 ——
       * 少了这条分流，骷髅箭会插在路过的僵尸身上，而玩家毫发无伤。 */
      if (!a.foe) for (const m of mobs) {
        if (m.dead) continue;
        /* 友方弹药只咬敌对生物 —— 少了这一条，雪傀儡的雪球会把身边的同伴打光。 */
        if (a.ally && !MOB_TYPES[m.type].hostile) continue;
        const [mn, mx] = mobBounds(m);
        if (a.x < mn[0] || a.x > mx[0] || a.y < mn[1] || a.y > mx[1] || a.z < mn[2] || a.z > mx[2]) continue;
        const hs = Math.hypot(a.vx, a.vz) || 1;
        damageMob(m, a.dmg, (a.vx / hs) * 0.6, (a.vz / hs) * 0.6);
        hits++;
        arrows.splice(i, 1); gone = true; break;
      }
      /* 敌方箭命中玩家：AABB 用玩家碰撞箱（半宽 PW、高 1.8）。
       * 旁观模式下玩家「不存在」，箭直接穿过去。 */
      if (!gone && a.foe && !player.dead && mode !== MODE.SPECTATOR &&
          a.x > player.x - PW && a.x < player.x + PW &&
          a.y > player.y && a.y < player.y + 1.8 &&
          a.z > player.z - PW && a.z < player.z + PW) {
        hurt(a.dmg, '你被骷髅射死了');
        if (puff) puff(a.x, a.y, a.z, [196, 84, 84]);
        arrows.splice(i, 1); gone = true;
      }
    }
  }
  return hits;
}
