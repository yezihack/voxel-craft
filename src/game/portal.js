/* 传送门与维度切换 —— 迁移自 voxel-craft.html 第 1952-2106 行 */

import { toast } from './uiState.js'
import { SEED, dim, edits, setColCache, setColCacheSeed, setDim, setEdits, setPortalCd, setSpectate } from './state.js'
import { blip } from './audio.js'
import { despawnAllBotDrops, despawnAllBots } from './bots.js'
import { D, DIM_N, H, I, PORTAL_BLOCK, PW, isPortalBlock } from './config.js'
import { DIMS, findDimEntry } from './dims.js'
import { fluid, fluidActive } from './fluid.js'
import { dimEdits, getEffective, isSolid, setBlock } from './generate.js'
import { chunks } from './mesher.js'
import { arrows, despawnAllMobs } from './mobs.js'
import { player } from './player.js'
import { updateSkyColor } from './post.js'

/* ============================== 传送门与维度切换 ==============================
 * 识别一扇门是**纯几何**：内空 2 宽 × 3 高，左右立柱 + 上下横梁全是黑曜石。
 * 门方块 id 自带目标维度（PORTAL_BLOCK / PORTAL_DIM），所以「走进去」时只查一次
 * 表；也因为没有另建「坐标 → 目的地」的映射，拆掉重建地形都不会把门弄丢。
 *
 * 这一段刻意放在生成入口段内（而不是「操作」段）：它全是纯函数 ——
 * 门框判定、落点挑选、维度切换的状态收口 —— 要能在无头测试里直接跑。
 * 交互那一层（射线、扣物品、音效）留在 doPlace。 */
export const PORTAL_W = 2, PORTAL_H = 3;

/* 门洞里那 6 格（下起、沿 u 方向左起）。不合规返回 null。
 * ⚠ 洞里必须是**空气**：否则「门洞被石头堵上」也会被判成合法的门，
 * 一点火就凭空在石头里开出一条通道。 */
export function portalFrameCells(ox, oy, oz, ux, uz) {
  const hole = [];
  for (let j = 0; j < PORTAL_H; j++) for (let i = 0; i < PORTAL_W; i++) {
    const hx = ox + i * ux, hy = oy + j, hz = oz + i * uz;
    if (hy < 1 || hy + 1 > H) return null;
    if (getEffective(hx, hy, hz) !== 0) return null;
    hole.push([hx, hy, hz]);
  }
  const ring = [];
  for (let j = 0; j < PORTAL_H; j++)                        // 左右立柱
    ring.push([ox - ux, oy + j, oz - uz], [ox + PORTAL_W * ux, oy + j, oz + PORTAL_W * uz]);
  for (let i = 0; i < PORTAL_W; i++)                        // 上下横梁
    ring.push([ox + i * ux, oy - 1, oz + i * uz], [ox + i * ux, oy + PORTAL_H, oz + i * uz]);
  for (const [fx, fy, fz] of ring) {
    if (fy < 0 || fy >= H) return null;
    if (getEffective(fx, fy, fz) !== I.OBSIDIAN) return null;
  }
  return hole;
}

/* 以某块黑曜石为起点找门框。点击的那块可能落在门框的任意位置（左右立柱、
 * 上下横梁、甚至洞口的空气格），所以「两个轴向 × 4 个列偏移 × 6 个行偏移」
 * 全试一遍 —— 一共 48 次判定，够快，也让玩家不用精确点某个特定方块。 */
export function findPortalFrame(x, y, z) {
  for (const axis of ['x', 'z']) {
    const ux = axis === 'x' ? 1 : 0, uz = axis === 'z' ? 1 : 0;
    for (let col = -2; col <= 1; col++)
      for (let oy = y - 4; oy <= y + 1; oy++) {
        const cells = portalFrameCells(x + col * ux, oy, z + col * uz, ux, uz);
        if (cells) return cells;
      }
  }
  return null;
}

/* 点燃：把门洞那 6 格写成目标维度的门方块。返回门洞坐标（失败返回 null） */
export function ignitePortal(d, x, y, z) {
  const hole = findPortalFrame(x, y, z);
  if (!hole) return null;
  const pid = PORTAL_BLOCK[d];
  for (const [hx, hy, hz] of hole) setBlock(hx, hy, hz, pid);
  return hole;
}

/* ---- 每个维度的进度：离开时的坐标 / 出生点 / 是否到过 ---- */
export const dimReturnPos = new Array(DIM_N).fill(null);
export const dimSpawn = new Array(DIM_N).fill(null);
export const dimVisited = new Array(DIM_N).fill(false);


/* 玩家 AABB 里有没有门方块 —— 有就是「站进传送门了」 */
export function portalIdInPlayer() {
  const p = player;
  const x0 = Math.floor(p.x - PW), x1 = Math.floor(p.x + PW - 1e-6);
  const y0 = Math.floor(p.y),      y1 = Math.floor(p.y + 1.8 - 1e-6);
  const z0 = Math.floor(p.z - PW), z1 = Math.floor(p.z + PW - 1e-6);
  for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) {
    const id = getEffective(x, y, z);
    if (isPortalBlock(id)) return id;
  }
  return 0;
}

/* 落点旁边补一扇「回去的门」。门方块不需要黑曜石框（框只是玩家自己搭门时的
 * 识别形状），所以只要找一处 2×3 的空位直接写进去即可。
 * 找不到就放弃 —— 玩家还能用核心自己搭，没必要为了「一定有」去改地形。 */
export function buildReturnPortal(backDim) {
  const px0 = Math.floor(player.x), pz0 = Math.floor(player.z), py0 = Math.floor(player.y);
  for (const [dx, dz] of [[2, 0], [-2, 0], [0, 2], [0, -2], [3, 0], [-3, 0]]) {
    for (const dy of [0, -1, 1, -2]) {
      const bx = px0 + dx, by = py0 + dy, bz = pz0 + dz;
      if (by < 1 || by + PORTAL_H >= H) continue;
      let ok = true;
      for (let j = 0; j < PORTAL_H && ok; j++)
        for (let i = 0; i < PORTAL_W; i++)
          if (getEffective(bx + i, by + j, bz) !== 0) { ok = false; break; }
      if (!ok) continue;
      // 底下得是实地，不然这扇门悬在半空（走进去再掉下去，体验很差）
      if (!isSolid(getEffective(bx, by - 1, bz)) || !isSolid(getEffective(bx + 1, by - 1, bz))) continue;
      for (let j = 0; j < PORTAL_H; j++) for (let i = 0; i < PORTAL_W; i++)
        setBlock(bx + i, by + j, bz, PORTAL_BLOCK[backDim]);
      return [bx + 0.5, by + 1.2, bz + 0.5];
    }
  }
  return null;
}

/* 切维度。所有「换维度要跟着换」的状态都在这里收口：
 *   覆盖层 edits / 水位表 fluid / 区块全部标脏 / 天空与雾 / 落点 / 出生点。
 * UI 调用一律 typeof 守卫 —— 这一段要抽到 Node 里做无头测试，那边没有 toast / blip。 */
export function switchDim(target, stayAt) {
  if (target === dim || !(target >= 0 && target < DIM_N)) return false;
  const p = player;
  dimReturnPos[dim] = [p.x, p.y, p.z];
  const from = dim;
  setDim(target);
  setEdits(dimEdits[dim]);                 // 覆盖层跟着换：异界拆的方块不能长回主世界
  /* 水位表不按维度分表，直接清空 —— 表里存的是「流动水当前高度」，
   * 清掉之后异界的水位从源头重算，代价只是一次流动动画，比维护 8 张表省心。
   * （漏掉这句的话，主世界某个坐标的水位会「借」到异界同一个坐标上，
   *   表现是凭空冒出一条水流。） */
  fluid.clear(); fluidActive.clear();
  setColCacheSeed(SEED); setColCache(new Map());   // 列缓存与维度强相关，整体换掉最稳
  for (const c of chunks) c.dirty = true;      // 所有区块几何重建（异界地形完全不同）

  /* 生物与箭一律清场：它们的位置是**上一个维度的坐标**，换维度之后同一坐标
   * 底下可能是完全不同的地形（甚至悬空）。让它们带着旧坐标在新世界里继续跑，
   * 就会看到「僵尸卡在岩壁里」这种穿帮。新维度由 dimMobSpawn 重新刷。
   * 附身状态也一并解除 —— 被附身那只已经不存在了。 */
  despawnAllMobs();
  arrows.length = 0;
  setSpectate(null);
  /* AI 玩家同样清场，理由和生物一样（坐标属于旧维度），而且它们还带着
   * 「家」—— 一个家在熔火之心的家跨到花园天下来就是纯穿帮。
   * 地上的掉落物一并清掉：不捡的话，玩家会在新维度里收到旧世界的物资。 */
  despawnAllBots();
  despawnAllBotDrops();

  let pos = stayAt || dimReturnPos[dim] || findDimEntry(dim);
  if (!pos) pos = [0.5, 20, 0.5];
  p.x = pos[0]; p.y = pos[1]; p.z = pos[2];
  p.vx = p.vy = p.vz = 0; p.fallPeak = null;
  if (!dimSpawn[dim]) dimSpawn[dim] = [pos[0], pos[1], pos[2]];
  p.spawn = dimSpawn[dim];
  setPortalCd(1.4);                              // 别让刚生成的门立刻把玩家吸回去

  if (typeof updateSkyColor === 'function') updateSkyColor();

  /* 第一次落地的维度：在脚边补一扇回程门，保证玩家一定回得去
   * （否则异界里没黑曜石 = 永久困死，那是最劝退的一种失败）。 */
  let back = null;
  if (!dimVisited[dim]) {
    dimVisited[dim] = true;
    back = buildReturnPortal(from);
  }
  const D = DIMS[dim];
  if (typeof blip === 'function') blip(520, 0.26, 'sine', 0.06);
  if (typeof toast === 'function')
    toast(D.icon + ' 已进入「' + D.name + '」' + (back ? '' : ' · 记得自己搭一扇回程门'));
  return true;
}
