/* 界面偏好设置（本地持久化）。
 *
 * 这些是「这台设备上的显示偏好」，**不是世界状态** —— 所以不进存档、
 * 不上 D1 云端，单独占一个 localStorage 键。存档是给 D1 同步的世界 / 玩家数据，
 * 把偏好混进去会让两套持久化互相污染（换设备时偏好跟着走是错的行为：
 * 手机要摇杆，桌面要键盘）。
 *
 * ⚠ 隐私模式 / 无痕窗口下 localStorage 会抛，读取与写入都要兜住：
 * 存不进去就退回默认值，绝不能因为「存不下设置」把整个游戏带崩。 */
import { reactive } from 'vue'

const KEY = 'voxel-craft:settings'

/* 默认值。新玩家一律按默认值走。 */
const DEFAULTS = {
  /* 进入游戏时在左上角显示一张快捷键说明。默认开 —— 新玩家最缺的就是
   * 「这个键是干什么的」；老玩家可以自己在设置里关掉。 */
  showKeyHints: true,
}

/* 只认白名单里的键，且只接受布尔值。
 * localStorage 里的内容是**外部输入**（用户手改、旧版本残留、别的标签页写的），
 * 不校验就会把任意字符串塞进响应式对象，后面 `settings.showKeyHints` 当布尔用
 * 时就会出 `undefined` 之类的怪值。 */
function sanitize(raw) {
  const out = {}
  for (const k of Object.keys(DEFAULTS)) {
    if (raw && typeof raw[k] === 'boolean') out[k] = raw[k]
  }
  return out
}

export const settings = reactive({ ...DEFAULTS })

export function loadSettings() {
  try {
    if (typeof localStorage === 'undefined') return
    const raw = localStorage.getItem(KEY)
    if (!raw) return
    Object.assign(settings, sanitize(JSON.parse(raw)))
  } catch { /* 隐私模式 / 脏数据：用默认值 */ }
}

export function saveSettings() {
  try {
    if (typeof localStorage === 'undefined') return
    const out = {}
    for (const k of Object.keys(DEFAULTS)) out[k] = settings[k]
    localStorage.setItem(KEY, JSON.stringify(out))
  } catch { /* 配额满 / 隐私模式：本次会话内仍然生效 */ }
}

export function setSetting(key, value) {
  if (!(key in DEFAULTS)) return
  settings[key] = !!value
  saveSettings()
}

export function toggleSetting(key) {
  if (!(key in DEFAULTS)) return
  setSetting(key, !settings[key])
}

/* 模块加载时就读一次：设置面板是开始面板的一部分，比引擎拉起得早，
 * 等引擎就绪再读的话，面板会先闪一个错误的开关状态。 */
loadSettings()
