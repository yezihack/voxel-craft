/* 主循环：每帧更新与绘制 —— 迁移自 voxel-craft.html 第 9076-9406 行 */

import { MODE, bowCharge, breakHeld, dim, handSwing, lastAction, lookVec, mode, paused, placeHeld, placeRepeat, portalCd, running, setBowCharge, setHandSwing, setLastAction, setPortalCd, setSpectate, setTargetBlock, spectate, stickVec, targetBlock } from './state.js'
import { doBreak, doBreakTimed, doPlace, particles, updateParticles } from './actions.js'
import { blip, noiseBurst } from './audio.js'
import { bots, tryAttackAny, updateBotDrops, updateBots } from './bots.js'
import { updateCarts } from './carts.js'
import { CD, CW, D, EYE, I, LAVA_RECT, PORTAL_DIM, REACH, SHIELD_OF, TEXEL, WATER_RECT } from './config.js'
import { updateFluid } from './fluid.js'
import { applyBelts, tickBlink, updatePads } from './transport.js'
import { addLook, input } from './input.js'
import { M4, clamp } from './math.js'
import { VIEW_CX, VIEW_CZ, anchorGX, anchorGZ, buildChunk, chunks, shiftChunks } from './mesher.js'
import { MOB_TYPES, fireArrow, updateArrows, updateMobs } from './mobs.js'
import { player, raycast, updatePhysics } from './player.js'
import { portalIdInPlayer, switchDim } from './portal.js'
import { tickAutoSave } from './save.js'
import { AMBIENT, FOG_FAR, FOG_HEIGHT, FOG_NEAR, SHADER_T, SKY, atlasTex, composite, drawArrows, drawBotDrops, drawBots, drawCarts, drawChunkBlend, drawChunkOpaque, drawHandView, drawMobs, ensureFbos, lineBuf, postOK, runBloom, sceneFbo, updateSkyColor, uploadChunk } from './post.js'
import { canvas, gl, locLine, locMain, progLine, progMain } from './renderer.js'
import { drawSky } from './sky.js'
import { applyStickInput } from './stick.js'
import { cancelDig, digProgress, heldId, invCount, invTake, updateDig, updateSurvival } from './survival.js'
import { P } from './textures.js'
import { syncHurt, syncVitals } from './uiSync.js'
import { updateNameTags } from './nametags.js'
import { ui } from './uiState.js'

/* ============================== 主循环 ============================== */
export let last = 0, fps = 0, fpsAcc = 0, fpsN = 0, frames = 0;

export function resize() {
  /* 触屏把渲染倍率压到 1.5：手机的 devicePixelRatio 常见是 3，
   * 按 2 倍算就是 2.2M 像素的 WebGL 画面，中端机会掉到 20 帧以下。
   * 1.5 倍在这类屏幕上肉眼几乎看不出差别，帧率却能翻一倍 ——
   * 「能不能玩」比「够不够锐」重要。 */
  const cap = ui.touch ? 1.5 : 2;
  const dpr = Math.min(window.devicePixelRatio || 1, cap);
  const w = Math.floor(innerWidth * dpr), h = Math.floor(innerHeight * dpr);
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w; canvas.height = h;
  }
  ensureFbos(canvas.width, canvas.height);   // 离屏缓冲跟着一起换尺寸
  gl.viewport(0, 0, canvas.width, canvas.height);
}
window.addEventListener('resize', resize);

/* 视锥剔除：用相机平面把区块 AABB 快速筛掉 */
export function chunkVisible(c, planes) {
  for (const p of planes) {
    // 取 AABB 在法线方向上最靠近相机的那个角
    const px = p[0] > 0 ? c.max[0] : c.min[0];
    const py = p[1] > 0 ? c.max[1] : c.min[1];
    const pz = p[2] > 0 ? c.max[2] : c.min[2];
    if (p[0] * px + p[1] * py + p[2] * pz + p[3] < 0) return false;
  }
  return true;
}
/* 从 viewProj 矩阵提取 6 个裁剪平面 */
export function extractPlanes(m) {
  const rows = [
    [m[0], m[4], m[8], m[12]],
    [m[1], m[5], m[9], m[13]],
    [m[2], m[6], m[10], m[14]],
    [m[3], m[7], m[11], m[15]],
  ];
  const P = [];
  const add = (a, b, s) => {
    const p = [a[0] + s * b[0], a[1] + s * b[1], a[2] + s * b[2], a[3] + s * b[3]];
    const n = Math.hypot(p[0], p[1], p[2]) || 1;
    P.push([p[0] / n, p[1] / n, p[2] / n, p[3] / n]);
  };
  add(rows[3], rows[0], 1); add(rows[3], rows[0], -1);
  add(rows[3], rows[1], 1); add(rows[3], rows[1], -1);
  add(rows[3], rows[2], 1); add(rows[3], rows[2], -1);
  return P;
}

/* 当前「眼睛」在哪 —— 平时是玩家自己；旁观附身时是那只生物的脑袋。
 * 高度取身高的 0.88：卡在几何中心会穿模，贴头顶又太靠上。
 * 附身目标死了就地退回自由视角（spectate 置 null）——
 * 否则相机会留在一具尸体旁边，而 mobAI 已经不再驱动它。 */
export function camEye() {
  if (spectate && spectate.dead) setSpectate(null);
  if (mode === MODE.SPECTATOR && spectate) {
    const D = MOB_TYPES[spectate.type];
    /* ⚠ yaw 要 +π：生物模型的「正脸」建在 +z，yaw=0 时脸朝 +z；
     * 而相机的 yaw=0 是看向 -z（玩家那套约定，见 updatePhysics 的 wish 向量）。
     * 两套约定符号相反，直接拿 spectate.yaw 当相机 yaw，附身画面就会整个
     * 转 180° —— 附身一只正在散步的怪，你看到的永远是它「从哪来」，
     * 而不是它「往哪去」。加 π 之后相机才顺着怪物的脸看出去。 */
    return { x: spectate.x, y: spectate.y + D.h * 0.88, z: spectate.z, yaw: spectate.yaw + Math.PI, pitch: 0 };
  }
  return { x: player.x, y: player.y + EYE, z: player.z, yaw: player.yaw, pitch: player.pitch };
}

/* 摇杆当前是否在接管方向键 —— 状态收在 stick.js 里（见那里的说明）。 */

export function frame(now) {
  requestAnimationFrame(frame);
  const t = now / 1000;
  let dt = last ? t - last : 0;
  last = t;
  if (dt > 0.1) dt = 0.1;
  /* 下界同样要封。`hurtFlash = Math.max(0, hurtFlash - dt)` 这类"随时间衰减"的量，
   * 一旦拿到负的 dt 就会反过来增长 —— 表现就是屏幕边缘挂着一圈永远不消的受伤红屏。
   * 正常浏览器里 performance.now() 单调递增，跑不到这里；会触发的是
   * 「无头测试 + 虚拟时间切回真实时间」这种时钟回拨场景。加个下界成本为零。 */
  if (dt < 0) dt = 0;
  frames++;

  resize();

  /* 触屏摇杆 → 输入。归零那一帧也必须写一遍 false，
   * 否则上一帧的 input.f = true 没人清，松手后人会一直往前走。
   * 换算逻辑与「接管期」都收在 stick.js 里，那边可以在 node 里单测。 */
  applyStickInput(stickVec, input);
  if (lookVec.x || lookVec.y) addLook(lookVec.x * 11, lookVec.y * 11);

  if (running && !paused) {
    /* 举盾：手持盾牌 + 按住右键 = 格挡中。
     * 必须在 updatePhysics **之前**维护 —— 这一帧的移动减速（player.js 里读
     * p.blocking）与伤害减免（survival.hurt 读同一个值）才是同一帧的口径。
     * 创造 / 旁观模式不举盾：那两个模式本来就不吃伤害，举盾只是多余的动作。 */
    player.blocking = mode === MODE.SURVIVAL && !player.dead
      && placeHeld && !!SHIELD_OF[heldId()];
    updatePhysics(dt, input);
    /* 传送门：站在门方块里就切维度（冷却期内不重复触发）。
     * 紧跟 updatePhysics —— 用的是这一帧的位置，不然会有「一帧的延迟差」
     * 让玩家穿门而过却没传送。 */
    if (portalCd > 0) setPortalCd(Math.max(0, portalCd - dt));
    else if (!player.dead && !spectate) {      // 附身中身体冻结在旧维度，不该被门带走
      const pid = portalIdInPlayer();
      const target = pid ? PORTAL_DIM[pid] : undefined;
      if (target !== undefined && target !== dim) switchDim(target);
    }
    updateSurvival(dt, input);
    updateMobs(dt);
    updateBots(dt);          // AI 玩家（在 updateMobs 之后：敌人刚死它就不用再打了）
    updateBotDrops(dt);
    /* 运输装置必须排在**所有实体推进之后**：传送带按位移推人推怪，
     * 先移动再推，这一帧的最终位置才是对的（反过来会慢一帧、且贴墙时抖动）。 */
    updateCarts(dt);
    applyBelts(dt);
    updatePads(dt);
    tickBlink(dt);
    updateParticles(dt);
    updateArrows(dt);
    updateFluid(dt);          // 水/液体的流动（按固定周期推进，与帧率解耦）
    if (handSwing > 0) setHandSwing(Math.max(0, handSwing - dt * 4.2));
    // 先取一次准星目标，挖掘进度与后面的高亮框共用同一份结果
    /* 附身中不取目标：射线从玩家身体出发，而画面里准星对着的是生物眼前的世界，
     * 两个点不一致，高亮框会画到莫名其妙的地方去。 */
    setTargetBlock(spectate ? null : raycast(REACH));
    // 准星上有生物、且比方块更近 → 打生物，而不是挖它背后的方块
    const blockDist = targetBlock && targetBlock.dist !== undefined ? targetBlock.dist : Infinity;
    const hitMob = breakHeld && mode !== MODE.SPECTATOR && tryAttackAny(dt, blockDist);
    // 挖掘：创造模式瞬破（长按每 0.18s 一次），生存模式按硬度累计进度
    if (mode === MODE.SURVIVAL) {
      if (breakHeld && !hitMob) {
        const broke = updateDig(dt, targetBlock);
        if (broke) doBreakTimed(broke);
      } else cancelDig();
    } else if (mode !== MODE.SPECTATOR && breakHeld && !hitMob && t - lastAction > 0.18) { doBreak(); setLastAction(t); }
    /* 连续放置只留给触屏（placeRepeat）。鼠标右键的「点一次放一块」发生在
     * mousedown 里，这里不再重复，否则按住不放就会沿视线一路朝自己堆方块。 */
    if (placeHeld && placeRepeat && mode !== MODE.SPECTATOR && t - lastAction > 0.22) { doPlace(); setLastAction(t); }

    /* 弓箭：按住右键蓄力、松手射出。
     * doPlace 对弓是空操作（它在 ITEMS 分支直接 return），所以两者不打架。 */
    const heldNow = heldId();
    const canShoot = mode !== MODE.SPECTATOR && heldNow === I.BOW && invCount(I.ARROW) > 0;
    if (placeHeld && canShoot) {
      setBowCharge(Math.min(1, bowCharge + dt / 1.05));
    } else if (bowCharge > 0) {
      const pw = bowCharge;
      setBowCharge(0);
      if (canShoot) {
        invTake(I.ARROW, 1);
        fireArrow(pw);
        noiseBurst(0.08, 0.05, 1200);
        blip(300 - pw * 120, 0.13, 'sawtooth', 0.05);
      }
    }
    /* 自动存档：只在「真的在玩」时推进。
     * 暂停 / 背包打开时不存 —— 那些时刻玩家可能在摆弄合成台，
     * 存下来的半途状态读回去只会让人困惑。
     * 存成功就 bump 一下 saveRev，让暂停面板上的摘要跟着更新。 */
    const autoSave = tickAutoSave(dt, true);
    if (autoSave && autoSave.ok) ui.saveRev++;
  } else {
    cancelDig();
    setTargetBlock(running ? raycast(REACH) : null);
  }

  // ---------------- 渲染 ----------------
  const aspect = canvas.width / Math.max(1, canvas.height);
  const proj = M4.persp(Math.PI / 180 * 72, aspect, 0.08, 240);
  /* 相机眼睛：cam 矩阵、下面的 uCam 雾心共用同一份。
   * 附身时它是生物的脑袋 —— 雾心得跟着相机走，否则隔着一片雾看世界。 */
  const eye = camEye();
  const cam = M4.view(eye.x, eye.y, eye.z, eye.yaw, eye.pitch);
  const vp = M4.mul(proj, cam.view);
  const planes = extractPlanes(vp);

  updateSkyColor();                       // 昼夜：天空色/雾色/太阳/环境光每帧跟着时间走
  const vw = canvas.width, vh = canvas.height;
  ensureFbos(vw, vh);
  // 有离屏帧缓冲就先画到那儿（后处理要用），建不起来则直出屏幕
  gl.bindFramebuffer(gl.FRAMEBUFFER, postOK ? sceneFbo : null);
  gl.viewport(0, 0, vw, vh);
  gl.clearColor(SKY[0], SKY[1], SKY[2], 1);
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  gl.enable(gl.DEPTH_TEST);
  gl.enable(gl.CULL_FACE);
  gl.cullFace(gl.BACK);

  // 0) 天穹。关深度测试、不写深度 —— 它是背景板，后面的一切都盖在它上面
  drawSky(cam, proj);

  // 0) 玩家走近窗口边缘时，把区块窗口整体平移一格（无限地形的关键）
  const pgx = Math.floor(player.x / CW), pgz = Math.floor(player.z / CD);
  const offX = pgx - anchorGX, offZ = pgz - anchorGZ;
  const halfX = VIEW_CX >> 1, halfZ = VIEW_CZ >> 1;
  if (Math.abs(offX - halfX) > 1 || Math.abs(offZ - halfZ) > 1) {
    // 每次只挪一格，避免跨越太多导致一次性重建大量区块
    const dgx = clamp(offX - halfX, -1, 1);
    const dgz = clamp(offZ - halfZ, -1, 1);
    if (dgx || dgz) shiftChunks(dgx, dgz);
  }

  // 1) 构建脏区块（每帧限制数量，避免卡顿）
  let budget = 4;
  for (const c of chunks) {
    if (c.dirty && budget > 0) { uploadChunk(c, buildChunk(c)); budget--; }
  }

  // 2) 方块：先画全部不透明面，再画半透明面（玻璃/水/冰/岩浆）
  gl.useProgram(progMain);
  gl.uniformMatrix4fv(locMain.uProj, false, proj);
  gl.uniformMatrix4fv(locMain.uView, false, cam.view);
  gl.uniformMatrix4fv(locMain.uModel, false, M4.ident());
  gl.uniform3f(locMain.uCam, eye.x, eye.y, eye.z);
  gl.uniform3f(locMain.uFog, SKY[0], SKY[1], SKY[2]);
  gl.uniform1f(locMain.uFogNear, FOG_NEAR);
  gl.uniform1f(locMain.uFogFar, FOG_FAR);
  gl.uniform1f(locMain.uFogHeight, FOG_HEIGHT);   // 每个维度自己的起雾高度
  gl.uniform1f(locMain.uTime, SHADER_T());
  gl.uniform1f(locMain.uAmbient, AMBIENT);
  gl.uniform1f(locMain.uTexel, TEXEL);
  gl.uniform4f(locMain.uWaterRect, WATER_RECT[0], WATER_RECT[1], WATER_RECT[2], WATER_RECT[3]);
  gl.uniform4f(locMain.uLavaRect, LAVA_RECT[0], LAVA_RECT[1], LAVA_RECT[2], LAVA_RECT[3]);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, atlasTex);
  gl.uniform1i(locMain.uAtlas, 0);
  gl.uniform3f(locMain.uTint, 1, 1, 1);

  const vis = [];
  for (const c of chunks) {
    if (!c.built || !c.count) continue;
    if (!chunkVisible(c, planes)) continue;
    vis.push(c);
  }
  // 不透明趟：开深度写入、关混合，树叶的镂空靠 shader 里的 discard 裁掉
  gl.disable(gl.BLEND);
  gl.depthMask(true);
  gl.uniform1f(locMain.uCutout, 1);
  for (const c of vis) drawChunkOpaque(c);
  // 半透明趟：开混合、关深度写入（否则先画的透明块会挡住后面的）
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  gl.depthMask(false);
  gl.uniform1f(locMain.uCutout, 0);
  for (const c of vis) drawChunkBlend(c);
  gl.depthMask(true);
  gl.disable(gl.BLEND);

  // 2b) 生物：同一套 shader，靠 uModel 做「局部模型 → 世界」变换
  drawMobs(cam);
  /* 2b') AI 玩家：必须在生物**之后**画 —— 两者互相遮挡时，
   * 人应该能走到怪前面去（它是「人」，语义上比怪物更靠前）。 */
  drawBots(cam);
  // 2c) 飞行中的箭
  drawArrows();
  // 2d) AI 玩家掉在地上的物资
  drawBotDrops();
  // 2e) 矿车（不透明实体，和掉落物同一趟）
  drawCarts();

  // 3) 选中方块高亮 + 粒子
  gl.useProgram(progLine);
  gl.uniformMatrix4fv(locLine.uProj, false, proj);
  gl.uniformMatrix4fv(locLine.uView, false, cam.view);
  gl.bindBuffer(gl.ARRAY_BUFFER, lineBuf);
  gl.enableVertexAttribArray(locLine.aPos);
  gl.vertexAttribPointer(locLine.aPos, 3, gl.FLOAT, false, 0, 0);
  gl.disable(gl.CULL_FACE);

  if (targetBlock && !spectate) {
    const t = targetBlock;
    // 生存模式挖到一半时，把框染成琥珀色，进度越深越亮 —— 明确「在挖、但还没破」
    const dp = mode === MODE.SURVIVAL ? digProgress() : 0;
    gl.uniform4f(locLine.uColor, 0.03, 0.03, 0.04, 0.75);
    drawLineBox(t.x + 0.5, t.y + 0.5, t.z + 0.5, 1.008);
    gl.uniform4f(locLine.uColor, 1, 0.55 + 0.45 * (1 - dp), 0.25 + 0.75 * (1 - dp), 0.9);
    drawLineBox(t.x + 0.5, t.y + 0.5, t.z + 0.5, 1.0);
  }

  // 粒子：用小立方体线框表示
  if (particles.length) {
    for (const p of particles) {
      gl.uniform4f(locLine.uColor, p.col[0] / 255, p.col[1] / 255, p.col[2] / 255, 1);
      drawLineBox(p.x, p.y, p.z, 0.09);
    }
  }
  gl.enable(gl.CULL_FACE);

  // 3b) 第一人称手持物：放在最后画，并自己清一次深度，永远压住地形
  drawHandView(cam, proj);

  // 3c) 后处理：泛光 + 调色 + 暗角 + FXAA，最后贴回屏幕
  if (postOK) { runBloom(vw, vh); composite(vw, vh); }

  // 4) 准星命中反馈 + 挖掘进度环 + HUD
  ui.crossHit = !!targetBlock;
  /* 名字标签：每帧都要跟手（人跑过去标签必须粘在头上），
   * 8~10 个人的 DOM 写入量在这个规模完全可以接受。 */
  updateNameTags(vp, eye, vw, vh);
  const dp = mode === MODE.SURVIVAL ? digProgress() : 0;
  ui.digOn = dp > 0;
  if (dp > 0) ui.digPct = +(dp * 100).toFixed(1);
  // 弓蓄力条
  ui.bowOn = bowCharge > 0;
  if (bowCharge > 0) ui.bowPct = +(bowCharge * 100).toFixed(1);

  // 生存数值每帧都便宜（只有十几个 SVG），但没必要 —— 每 6 帧刷一次足够跟手
  if (frames % 6 === 0) { syncVitals(); syncHurt(); }

  fpsAcc += dt; fpsN++;
  if (fpsAcc > 0.5) { fps = Math.round(fpsN / fpsAcc); fpsAcc = 0; fpsN = 0; }
}

/* 画一个线框立方体：用 model 矩阵方式在 CPU 端变换太慢，
 * 改用 uniform 传偏移，把 12 条边的顶点按偏移平移绘制 */
export let lineLoc = null;
export function drawLineBox(cx, cy, cz, size) {
  // 直接在 JS 里生成这个盒子的 24 个顶点（12 条边）—— 数量极少，开销可忽略
  const h = size / 2;
  const v = [];
  const P = [
    [-h,-h,-h],[ h,-h,-h],[ h,-h, h],[-h,-h, h],
    [-h, h,-h],[ h, h,-h],[ h, h, h],[-h, h, h],
  ];
  const E = [[0,1],[1,2],[2,3],[3,0],[4,5],[5,6],[6,7],[7,4],[0,4],[1,5],[2,6],[3,7]];
  for (const [a, b] of E) {
    v.push(cx + P[a][0], cy + P[a][1], cz + P[a][2]);
    v.push(cx + P[b][0], cy + P[b][1], cz + P[b][2]);
  }
  gl.bindBuffer(gl.ARRAY_BUFFER, lineBuf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(v), gl.DYNAMIC_DRAW);
  gl.enableVertexAttribArray(locLine.aPos);
  gl.vertexAttribPointer(locLine.aPos, 3, gl.FLOAT, false, 0, 0);
  gl.drawArrays(gl.LINES, 0, v.length / 3);
}
