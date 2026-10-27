/* 触屏改造的静态断言。
 *
 * 这一轮的改动几乎全在「界面层」—— 组件、CSS、事件绑定。
 * 它们跑不进 node（textures.js 顶层要 2D 上下文、renderer.js 顶层要 WebGL），
 * 所以不做运行时渲染验证，改为对源码做结构断言：
 * 谁要是在以后把 HUD 加回来、或者把「按住画布挖掘」复活，这里会立刻红。
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (p) => readFileSync(resolve(root, p), 'utf8');

let pass = 0, fail = 0;
function ok(cond, label, detail = '') {
  if (cond) { pass++; console.log(`  ✓ ${label}`); }
  else { fail++; console.log(`  ✗ ${label}${detail ? '  ← ' + detail : ''}`); }
}

console.log('\n== 1. 左上角 HUD 已彻底移除 ==');
for (const f of [
  'src/components/HudPanel.vue',
  'src/components/HudCard.vue',
  'src/data/helpKeys.js',
]) ok(!existsSync(resolve(root, f)), `${f} 不存在`);

const app = read('src/App.vue');
ok(!/HudPanel/.test(app), 'App.vue 不再引用 HudPanel');

const uiState = read('src/game/uiState.js');
ok(!/^\s*stat:/m.test(uiState), 'uiState 没有 stat 字段');
ok(!/flyTag/.test(uiState), 'uiState 没有 flyTag 字段');

const loop = read('src/game/loop.js');
ok(!/syncHud/.test(loop), 'loop.js 不再调用 syncHud');

const uiSync = read('src/game/uiSync.js');
ok(!/export function syncHud/.test(uiSync), 'uiSync.js 不再导出 syncHud');
ok(/export function syncVitals/.test(uiSync) && /export function syncHurt/.test(uiSync),
  '生存数值 / 受伤闪烁仍同步');

const css = read('src/assets/main.css');
ok(!/^\.card\b/m.test(css), 'main.css 删掉了 .card 死样式');

const uiActions = read('src/game/uiActions.js');
ok(!/ui\.flyTag/.test(uiActions), 'uiActions 不再写 ui.flyTag');

console.log('\n== 2. 触屏动作已接入 ==');
ok(/export function touchMine/.test(uiActions), 'uiActions 定义 touchMine');
ok(/export function touchPlace/.test(uiActions), 'uiActions 定义 touchPlace');
ok(/export function cycleMode/.test(uiActions), 'uiActions 定义 cycleMode');
ok(/mode === MODE\.SPECTATOR \|\| !running\) return/.test(uiActions),
  'touchMine / touchPlace 在旁观与暂停时直接返回');

const input = read('src/game/input.js');
ok(/import \{ closeBag, cycleMode/.test(input), '键盘 G 改走 cycleMode');
ok(!/setMode\(mode === MODE\.SURVIVAL/.test(input), 'input.js 不再自带一份模式循环');

console.log('\n== 3. 画布手势只剩「转视角」 ==');
/* 截出 canvas 的触摸段，单独断言 —— 别处的 setBreakHeld 是鼠标分支，属于正常 */
const touchSec = input.slice(input.indexOf('触屏：在画布上滑动'));
ok(touchSec.length > 0, 'input.js 存在画布触摸段');
ok(/addLook\(\(t\.clientX - lookX\) \* TOUCH_LOOK/.test(touchSec), '触摸移动换算成 addLook');
ok(!/setBreakHeld|tapTimer|doPlace\(\)/.test(touchSec),
  '触摸段里不再有挖掘 / 长按放置');
ok(/e\.pointerType === 'touch'\) return/.test(input),
  'pointerdown 跳过触摸指针，避免与 touchmove 叠加');

console.log('\n== 4. 触屏控件与门面 ==');
const tc = read('src/components/TouchControls.vue');
ok(/engine\.touchMine\(/.test(tc), 'TouchControls 绑定 touchMine');
ok(/engine\.touchPlace\(/.test(tc), 'TouchControls 绑定 touchPlace');
ok(/engine\.toggleBag\(/.test(tc) && /engine\.cycleMode\(/.test(tc)
  && /engine\.toggleFly\(/.test(tc) && /engine\.pauseGame\(/.test(tc),
  '右上四个系统按钮齐全（背包 / 模式 / 飞行 / 菜单）');
ok(/watch\(show/.test(tc), '控件隐藏时复位按住状态');
ok(!/joy2/.test(tc), '右摇杆已移除（改为画布滑动）');

const facade = read('src/game/index.js');
for (const name of ['touchMine', 'touchPlace', 'cycleMode', 'toggleBag', 'pauseGame']) {
  ok(new RegExp(`\\b${name}\\b`).test(facade), `引擎门面导出 ${name}`);
}

console.log('\n== 5. 移动端布局与性能 ==');
ok(/const cap = ui\.touch \? 1\.5 : 2/.test(loop), '触屏渲染倍率上限 1.5');
ok(/touch-action: none/.test(read('src/components/GameCanvas.vue')), '画布禁用浏览器手势');
ok(/max-width: 560px/.test(read('src/components/ui/ItemSlot.vue')),
  '窄屏下快捷格缩到 36×44');
ok(/env\(safe-area-inset-bottom/.test(read('src/components/HotBar.vue')),
  '快捷栏避开底部安全区');

const veil = read('src/components/StartVeil.vue');
ok(/v-if="ui\.touch"/.test(veil), '开始面板按设备切换按键表 / 触屏说明');
ok(/engine\.saveNow\(true\)/.test(veil), '暂停面板提供手动保存按钮');
ok(!/engine\.startGame\(true\)/.test(veil), '「开始游戏」不再硬请求指针锁定');

const boot = read('src/game/boot.js');
ok(/ui\.touch\s*\n?\s*\?/.test(boot), '地形就绪提示语按设备分支');

console.log(`\n${fail === 0 ? '✅ 全部通过' : '❌ 失败 ' + fail + ' 项'}（${pass} 通过 / ${fail} 失败）\n`);
process.exit(fail === 0 ? 0 : 1);
