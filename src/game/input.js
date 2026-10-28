/* 输入：键盘 / 鼠标 / 触屏事件 —— 迁移自 voxel-craft.html 第 8260-8473 行 */

import { MODE, mode, running, selected, setBreakHeld, setLastAction, setPlaceHeld, setPlaceRepeat, setSpectate, spectate } from './state.js'
import { doBreak, doPlace } from './actions.js'
import { blip } from './audio.js'
import { REACH_ATTACK } from './config.js'
import { camEye } from './loop.js'
import { clamp } from './math.js'
import { MOB_TYPES, raycastMob } from './mobs.js'
import { player } from './player.js'
import { closeBag, cycleMode, loadNow, saveNow, selectSlot, toggleBag } from './uiActions.js'
import { toast, ui } from './uiState.js'
import { canvas } from './renderer.js'
import { HOTBAR_N, respawn } from './survival.js'

/* ============================== 输入 ============================== */
export const input = { f: false, b: false, l: false, r: false, jump: false, shift: false, sprint: false };
export const keys = {};




/* 放置是否「按住连发」。鼠标一律 false —— 右键点一次只放一块，
 * 想继续铺必须再点。原因：连发时每次都会重新打射线，而新方块总落在命中面
 * 靠自己的一侧、比原方块更近，于是下一次射线先打到它，「从远到近」一路朝
 * 玩家脸上堆过去。触屏没有「右键点击」这个动作（长按 380ms 是唯一入口），
 * 所以那一路仍然连发，否则铺路会变成反复长按的苦力活。 */


window.addEventListener('keydown', (e) => {
  const k = e.code;
  if (keys[k]) return;
  keys[k] = true;
  if (k === 'KeyW') input.f = true;
  if (k === 'KeyS') input.b = true;
  if (k === 'KeyA') input.l = true;
  if (k === 'KeyD') input.r = true;
  if (k === 'Space') { input.jump = true; e.preventDefault(); }
  if (k === 'ShiftLeft' || k === 'ShiftRight') input.shift = true;
  if (k === 'ControlLeft') input.sprint = true;

  if (k === 'KeyF') {
    if (mode === MODE.SPECTATOR) {
      /* 旁观模式的 F = 附身 / 脱离。射线从「当前眼睛」出发
       * （自由视角时就是玩家自己，附身中不会走到这分支）。
       * 命中生物才附得上；再按一次原地脱离，回到自由视角。 */
      if (spectate) {
        setSpectate(null);
        blip(440, 0.09, 'sine', 0.06);
        toast('👁 已脱离附身，回到自由视角');
      } else {
        const e = camEye();
        const cp = Math.cos(e.pitch), sp = Math.sin(e.pitch);
        const dx = -Math.sin(e.yaw) * cp, dy = sp, dz = -Math.cos(e.yaw) * cp;
        const hit = raycastMob(e.x, e.y, e.z, dx, dy, dz, REACH_ATTACK);
        if (hit) {
          setSpectate(hit.mob);
          blip(880, 0.09, 'sine', 0.06);
          toast('👁 附身：' + MOB_TYPES[hit.mob.type].name + '（再按 F 脱离）');
        } else {
          toast('准星对准一种生物再按 F');
        }
      }
    } else if (mode === MODE.SURVIVAL) { toast('生存模式没有飞行 —— 想飞请按 G 切模式'); }
    else {
      player.fly = !player.fly;
      player.vy = 0;
      blip(player.fly ? 880 : 440, 0.09, 'sine', 0.06);
      toast(player.fly ? '✈ 飞行已开启（F 关闭）' : '✈ 飞行已关闭');
    }
  }
  /* G 三模式循环：创造 → 生存 → 旁观 → 创造。
   * 为什么不是「切回上一个」：三个模式两两组合都有意义，而循环只需要一次按键。 */
  if (k === 'KeyG') cycleMode();
  if (k === 'KeyE' && running) { e.preventDefault(); toggleBag(); }
  if (k === 'KeyR') {
    if (mode === MODE.SURVIVAL) { respawn(); toast('已回到出生点'); }
    else { player.x = player.spawn[0]; player.y = player.spawn[1]; player.z = player.spawn[2]; player.vx = player.vy = player.vz = 0; }
    blip(660, .12, 'sine', .06);
  }
  if (k >= 'Digit1' && k <= 'Digit9') selectSlot(+k.slice(5) - 1);
  /* F5 存档 / F9 读档。
   * F5 是浏览器刷新键，**必须** preventDefault —— 否则玩家一按就把进度刷没了，
   * 而这恰恰是「存档」这个动作最不该有的副作用。暂停面板里也有同样的两个按钮，
   * 万一某个浏览器拦不住 F5，玩家仍有别的入口。 */
  if (k === 'F5') { e.preventDefault(); saveNow(true); }
  if (k === 'F9') { e.preventDefault(); loadNow(); }
  if (k === 'Escape') { if (ui.bagOpen) closeBag(); /* 其余交给 pointerlockchange */ }
});
window.addEventListener('keyup', (e) => {
  const k = e.code;
  keys[k] = false;
  if (k === 'KeyW') input.f = false;
  if (k === 'KeyS') input.b = false;
  if (k === 'KeyA') input.l = false;
  if (k === 'KeyD') input.r = false;
  if (k === 'Space') input.jump = false;
  if (k === 'ShiftLeft' || k === 'ShiftRight') input.shift = false;
  if (k === 'ControlLeft') input.sprint = false;
});

/* --------------------------- 鼠标 / 触摸视角 --------------------------- */
export const SENS = 0.0022;

/* 俯仰的上下界。原来卡在 ±(π/2 - 0.02)，差 1.15° 就顶住 —— 手指滑到那儿
 * 画面不再动，继续滑也不积累，手感就是「卡死」。
 * 现在只留 0.0005 rad（0.03°）的余量：纯粹是防 sin/cos 在正好 ±π/2 时的
 * 数值退化（那会让视图矩阵退化成不可逆，画面翻过来）。
 * 换句话说，除了「正好垂直」这一点，低头和抬头已经没有限制。 */
const PITCH_LIM = Math.PI / 2 - 0.0005;

export function addLook(dx, dy) {
  player.yaw -= dx * SENS;
  player.pitch = clamp(player.pitch - dy * SENS, -PITCH_LIM, PITCH_LIM);
}

document.addEventListener('mousemove', (e) => {
  if (document.pointerLockElement === canvas) addLook(e.movementX || 0, e.movementY || 0);
});

/* 拖拽转头：指针锁定后也能用（右键拖拽），未锁定时左键拖拽即可。
 * 这样即使鼠标没锁上、或锁定后想微调视角，都有办法转头。 */
export let dragging = false, lastMX = 0, lastMY = 0, dragPointerId = null;
export function startDrag(e) {
  if (!running) return;
  dragging = true; dragPointerId = e.pointerId ?? null;
  lastMX = e.clientX; lastMY = e.clientY;
}
export function endDrag() { dragging = false; dragPointerId = null; }

canvas.addEventListener('pointerdown', (e) => {
  if (!running) return;
  /* 触摸指针不参与拖拽：触屏的视角转动由下面的 touchmove 专门处理。
   * 两套都生效的话，一次滑动会被乘上两倍灵敏度，还会互相抢 pointerId。 */
  if (e.pointerType === 'touch') return;
  const locked = document.pointerLockElement === canvas;
  // 未锁定：左键/触摸都能拖；已锁定：用右键拖（左键留给挖掘）
  if (!locked) { startDrag(e); return; }
  if (e.button === 2) startDrag(e);
});
window.addEventListener('pointermove', (e) => {
  if (!dragging) return;
  if (dragPointerId !== null && e.pointerId !== dragPointerId) return;
  addLook(e.clientX - lastMX, e.clientY - lastMY);
  lastMX = e.clientX; lastMY = e.clientY;
});
window.addEventListener('pointerup', endDrag);
window.addEventListener('pointercancel', endDrag);
window.addEventListener('blur', endDrag);
/* 锁定状态下右键拖拽：屏蔽浏览器右键菜单，并吞掉这次右键的放置动作 */
export let suppressPlace = false;
canvas.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  if (document.pointerLockElement === canvas && dragPointerId !== null) suppressPlace = true;
});

canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  // 滚轮只循环「快捷栏 9 格」—— 储物格不是手持目标，别把 selected 转到 20 去
  selectSlot((selected + (e.deltaY > 0 ? 1 : -1) + HOTBAR_N) % HOTBAR_N);
}, { passive: false });

/* 鼠标按键：左挖右放，长按连续动作。
 * 注意生存模式不能在这里直接挖 —— 必须走 updateDig 的计时流程，
 * 否则按住左键会绕过硬度、瞬间破块。 */
canvas.addEventListener('mousedown', (e) => {
  if (!running) return;
  if (mode === MODE.SPECTATOR) return;      // 旁观者只观察，不碰世界（挖/放/射箭全免）
  if (e.button === 0) { setBreakHeld(true); if (mode !== MODE.SURVIVAL) doBreak(); }
  if (e.button === 2) { setPlaceHeld(true); setPlaceRepeat(false); doPlace(); setLastAction(performance.now() / 1000); }
});
window.addEventListener('mouseup', (e) => {
  if (e.button === 0) setBreakHeld(false);
  if (e.button === 2) { setPlaceHeld(false); setPlaceRepeat(false); }
});
canvas.addEventListener('contextmenu', (e) => e.preventDefault());

/* 触屏：在画布上滑动 = 转视角。
 * 挖掘与放置交给右下角的两个专用按钮（TouchControls.vue → touchMine / touchPlace）。
 *
 * 早期版本把「按住挖、长按 380ms 放」压在画布上，结果是「想转头却挖了个坑」——
 * 拖拽和长按在电容屏上本来就分不清，手指稍微停顿一下就会从「转视角」跳成「挖掘」，
 * 再停久一点又变成「放置」。把三个动作挤在同一个手势里必然互相误伤，
 * 所以画布只保留最不会误判的那一个：滑动转向。 */
/* 触屏灵敏度倍率。原来 2.2 —— 滑 100px 转 27.7°，滑 324px 就转满 90°，
 * 从屏幕顶滑到底能转 234°：手指稍微一动画面就冲到边界，根本瞄不准方块。
 * 1.15 是「滑 100px 转 14.5°」：滑满一屏（约 800px）才转 116°，
 * 想低头看脚下要滑大半屏，既能到位又留得住精度。 */
export const TOUCH_LOOK = 1.15;

/* 单次 touchmove 最多算这么多像素。
 * 手指滑得快时浏览器会合并事件，一次 delta 可能上百像素；
 * 更糟的是 touchend 被系统手势吞掉时，下一次 delta 会是「当前位置 - 很久以前的位置」。
 * 不封顶的话视角会瞬间被甩到边界 —— 这就是「一低头就跳到最抬头」的真相。 */
const TOUCH_STEP_MAX = 90;

let lookId = null, lookX = 0, lookY = 0;

canvas.addEventListener('touchstart', (e) => {
  if (!running) return;
  /* 已经有手指在接管视角就忽略第二根 —— 但先确认那根手指还活着：
   * 它的 touchend 万一没送到，lookId 会一直挂着，之后每次按下都被挡掉，
   * 基准永远停在旧位置。 */
  if (lookId !== null) {
    let alive = false;
    for (const t of e.touches) if (t.identifier === lookId) alive = true;
    if (alive) return;
  }
  const t = e.changedTouches[0];
  lookId = t.identifier;
  lookX = t.clientX; lookY = t.clientY;
}, { passive: true });

canvas.addEventListener('touchmove', (e) => {
  for (const t of e.changedTouches) {
    if (t.identifier !== lookId) continue;
    let dx = t.clientX - lookX, dy = t.clientY - lookY;
    const d = Math.hypot(dx, dy);
    if (d > TOUCH_STEP_MAX) { dx = dx / d * TOUCH_STEP_MAX; dy = dy / d * TOUCH_STEP_MAX; }
    addLook(dx * TOUCH_LOOK, dy * TOUCH_LOOK);
    lookX = t.clientX; lookY = t.clientY;
    e.preventDefault();            // 阻止页面跟着手指滚动 / 下拉刷新
  }
}, { passive: false });

const endLook = (e) => {
  let hit = false;
  for (const t of e.changedTouches) if (t.identifier === lookId) hit = true;
  /* 兜底：这根手指的 touchend 没送到我们手上（被系统手势 / 遮罩 / 元素移除吞掉），
   * 但页面上已经没有手指了 —— 那就别管 identifier，直接复位。
   * 少了这一步，lookId 会一直挂着，下一次 touchstart 被 `lookId !== null` 挡掉，
   * lookX/lookY 停在很久以前的位置，于是下一次滑动就是一次几百像素的跳变。 */
  if (!hit && e.touches.length > 0) return;
  lookId = null;
};
canvas.addEventListener('touchend', endLook);
canvas.addEventListener('touchcancel', endLook);
