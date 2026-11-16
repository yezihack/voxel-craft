/* 游戏内左上角的「快捷键速查表」内容。
 *
 * 与 veilKeys.js（开始 / 暂停面板上那张完整按键表）分开：那边是给
 * 「进游戏之前读一遍」的，长一点没关系；这边是进游戏之后弹在左上角
 * 的提醒，必须一眼扫得完，所以只留最常用的十来条。
 *
 * 文案与 input.js / actions.js 里实际绑定的键保持一致，别写成两套。 */
export const KEY_HINTS = [
  { key: 'W A S D', text: '移动' },
  { key: '空格', text: '跳跃 / 上升' },
  { key: 'Shift', text: '潜行 / 下降' },
  { key: 'F', text: '飞行 · 附身' },
  { key: '鼠标左键', text: '挖掘 / 攻击' },
  { key: '鼠标右键', text: '放置 / 使用' },
  { key: '1-9 / 滚轮', text: '切换方块' },
  { key: 'E', text: '背包 / 方块库' },
  { key: 'G', text: '切换模式' },
  { key: 'R', text: '回到出生点' },
  { key: 'F5 / F9', text: '存档 / 读档' },
  { key: 'Esc', text: '暂停菜单' },
  { key: 'H', text: '显示 / 隐藏本表' },
]

/* 触屏版：手机上没有键盘，给的是「手指怎么操作」。
 * 内容与 TouchControls.vue 上的实际控件一一对应，别写成两套。 */
export const TOUCH_HINTS = [
  { key: '左摇杆', text: '移动' },
  { key: '滑动画面', text: '转视角' },
  { key: '右下按钮', text: '挖 / 放 / 跳 / 潜' },
  { key: '右上按钮', text: '背包 / 模式 / 飞行 / 菜单' },
]
