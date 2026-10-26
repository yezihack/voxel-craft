/* 输入：键盘 / 鼠标 / 触屏事件 —— 迁移自 voxel-craft.html 第 8260-8473 行 */

import { MODE, mode, running, selected, setBreakHeld, setLastAction, setPlaceHeld, setPlaceRepeat, setSpectate, spectate } from './state.js'
import { doBreak, doPlace } from './actions.js'
import { blip } from './audio.js'
import { REACH } from './config.js'
import { camEye } from './loop.js'
import { clamp } from './math.js'
import { MOB_TYPES, raycastMob } from './mobs.js'
import { player } from './player.js'
import { closeBag, loadNow, saveNow, selectSlot, setMode, toggleBag } from './uiActions.js'
import { toast, ui } from './uiState.js'
import { canvas } from './renderer.js'
import { HOTBAR_N, cancelDig, respawn } from './survival.js'

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
        const hit = raycastMob(e.x, e.y, e.z, dx, dy, dz, REACH);
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
      ui.flyTag = player.fly ? '(开)' : '(关)';
      blip(player.fly ? 880 : 440, 0.09, 'sine', 0.06);
    }
  }
  /* G 三模式循环：创造 → 生存 → 旁观 → 创造。
   * 为什么不是「切回上一个」：三个模式两两组合都有意义，而循环只需要一次按键。 */
  if (k === 'KeyG') setMode(mode === MODE.SURVIVAL ? MODE.CREATIVE
                                  : mode === MODE.CREATIVE ? MODE.SURVIVAL
                                  : MODE.CREATIVE);
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
export function addLook(dx, dy) {
  player.yaw -= dx * SENS;
  player.pitch = clamp(player.pitch - dy * SENS, -Math.PI / 2 + 0.02, Math.PI / 2 - 0.02);
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

/* 触屏：按住 = 挖掘（生存模式按进度累计），长按 380ms = 放置。
 * 这两个监听挂在画布上 —— 手指落在世界里的动作，和覆盖层的触屏控件不是一回事。 */
let tapTimer = null;
canvas.addEventListener('touchstart', (e) => {
  if (mode === MODE.SPECTATOR) return;    // 旁观不挖不放
  setBreakHeld(true);                      // 按住期间持续挖，松手即停
  setLastAction(performance.now() / 1000);
  if (mode !== MODE.SURVIVAL) doBreak(); // 创造模式瞬破，立即给反馈
  tapTimer = setTimeout(() => {
    setBreakHeld(false);                   // 转入放置，不再挖
    setPlaceHeld(true); setPlaceRepeat(true); doPlace();
    setLastAction(performance.now() / 1000);
  }, 380);
}, { passive: true });
canvas.addEventListener('touchend', () => {
  clearTimeout(tapTimer);
  setBreakHeld(false); setPlaceHeld(false); setPlaceRepeat(false); cancelDig();
});
