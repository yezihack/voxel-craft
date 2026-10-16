/* 启动流程：世界生成、资源上传、首帧准备。
 * 原文件里这一段的 DOM 部分（veil / death / btnStart / 模式按钮的事件绑定）
 * 全部搬到了 Vue 组件与 uiActions.js，这里只留引擎侧的真活儿。 */
import { blip } from './audio.js'
import { CD, CW, D, I, W } from './config.js'
import { findSpawn, generate } from './fluid.js'
import { getEffective } from './generate.js'
import { input } from './input.js'
import { frame, resize } from './loop.js'
import { buildChunk, chunks, initChunks } from './mesher.js'
import { PASSIVE_TYPES, spawnMob, surfaceY } from './mobs.js'
import { player } from './player.js'
import { dimSpawn } from './portal.js'
import { updateSkyColor, uploadAtlas, uploadBotMesh, uploadChunk, uploadDropMesh, uploadMobMeshes } from './post.js'
import { canvas } from './renderer.js'
import { buildCloudTexture } from './sky.js'
import { breakHeld, running, setBowCharge, setBreakHeld, setOnDeath, setOnHurt, setPaused, setPlaceHeld, setPlaceRepeat, setRunning } from './state.js'
import { cancelDig } from './survival.js'
import { buildAtlas } from './textures.js'
import { pauseGame, showDeath } from './uiActions.js'
import { ui } from './uiState.js'

/* ---------------- 系统级事件：指针锁定 ----------------
 * 这两个监听是「浏览器 ↔ 引擎」的协议，不涉及任何自绘界面，留在引擎侧。
 * 面板显示与否只通过 ui.veilVisible 表达。 */
export function attachSystemEvents() {
  document.addEventListener('pointerlockchange', () => {
    if (document.pointerLockElement === canvas) {
      if (ui.bagOpen) return
      ui.veilVisible = false
      setRunning(true); setPaused(false)
    } else if (running) {
      pauseGame()
    }
  })
  /* 关掉背包会立刻重新请求指针锁定，而浏览器对「刚解锁就重锁」有冷却，
   * 被拒后就没人管了 —— 鼠标锁不上、又没有遮罩，玩家会以为游戏卡住。
   * 这里退化成暂停遮罩，点一下即可继续。 */
  document.addEventListener('pointerlockerror', () => {
    if (!ui.bagOpen) pauseGame()
  })
}

/* 把生存逻辑的事件钩子接到界面上（生存逻辑本身不知道界面的存在） */
export function attachSurvivalHooks() {
  setOnHurt(() => {
    ui.hurt = player.hurtFlash > 0
    blip(150, 0.14, 'sawtooth', 0.055)
  })
  setOnDeath(() => {
    setRunning(false); setPaused(true)
    setBreakHeld(false); setPlaceHeld(false); setPlaceRepeat(false)
    setBowCharge(0)
    cancelDig()
    Object.keys(input).forEach((k) => (input[k] = false))
    if (document.pointerLockElement === canvas) document.exitPointerLock()
    showDeath(player.inLava ? '你被岩浆吞没了' : '生命值归零')
  })
}

export function boot() {
  const t0 = performance.now()
  const info = generate(20260918)
  player.spawn = findSpawn()
  dimSpawn[0] = player.spawn              // 主世界的出生点登记进维度表（R 键 / 死亡重生用）
  player.x = player.spawn[0]
  player.y = player.spawn[1]
  player.z = player.spawn[2]
  // 面朝地图中心
  player.yaw = Math.atan2(W / 2 - player.x, D / 2 - player.z) + Math.PI

  // 区块窗口以玩家所在区块为中心，之后随玩家移动自动平移
  initChunks(Math.floor(player.x / CW), Math.floor(player.z / CD))
  buildAtlas()          // 先把贴图画出来，再上传给 GPU
  uploadAtlas()
  buildCloudTexture()   // 云纹理也是 CPU 现画一张，之后只做采样
  uploadMobMeshes()
  uploadBotMesh()          // AI 玩家：全场共用一份网格
  uploadDropMesh()         // 掉落物小方块（也要一份网格 + uTint 染色）
  updateSkyColor()      // 先按当前时间把天空/太阳/环境光算一遍，
                        // 免得第一帧拿到全 1 的默认值（会闪一下正午）
  resize()

  // 开局先撒一批被动生物，进游戏就能看到世界是活的
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2 + 0.4
    const r = 16 + (i % 3) * 8
    const x = Math.floor(player.x + Math.cos(a) * r)
    const z = Math.floor(player.z + Math.sin(a) * r)
    const h = surfaceY(x, z)
    if (h > 1 && getEffective(x, h, z) === I.GRASS)
      spawnMob(PASSIVE_TYPES[i % PASSIVE_TYPES.length], x + 0.5, h + 1, z + 0.5)
  }

  // 逐帧预构建全部区块，构建期间把进度写进 ui，由开始面板显示
  let done = 0
  const total = chunks.length
  const ready = `地形就绪（${info.trees} 棵树 · ${info.cacti} 丛仙人掌 · ` +
    `${info.oreCount} 块矿石 · ${info.villages} 座村庄 · ${info.ruins} 处遗迹 · ` +
    `${info.mines} 条废弃矿井 · 底部 ${info.lavaCount} 格岩浆）`
  function step() {
    const budgetStart = performance.now()
    while (done < total && performance.now() - budgetStart < 14) {
      uploadChunk(chunks[done], buildChunk(chunks[done]))
      done++
    }
    if (done < total) {
      ui.veilHint = `正在生成地形… ${Math.round(done / total * 100)}%`
      requestAnimationFrame(step)
    } else {
      ui.veilHint = `${ready} · 点击后会锁定鼠标，按 <b>Esc</b> 可随时退出`
    }
  }
  step()
  console.log(`[voxel] 世界生成耗时 ${(performance.now() - t0).toFixed(0)}ms, 区块 ${total}`)
}

/* 起帧。放在这里而不是模块顶层：引擎是被 Vue 动态 import() 拉起来的，
 * 顶层执行会让「拿到画布」和「开跑」的先后关系变模糊。 */
export function startLoop() {
  requestAnimationFrame(frame)
}
