/* 存档别名的校验 / 归一化 —— 浏览器与 Pages Functions 共用同一份规则。
 *
 * 为什么是独立模块：别名要在**服务端**判重、又要由**客户端**做即时提示，
 * 两边规则一旦漂移，就会出现「面板说合法、点保存被后端拒绝」这种最难查的坏法。
 * 本模块是纯函数，不 import 任何东西，Functions 的 esbuild 打包可以直接吃。
 *
 * 规则：2–20 个字符，Unicode 字母 / 数字（含中文）、下划线、连字符；不含空格。
 * 归一化只做 trim + toLowerCase —— 大小写不敏感，避免「Tom」与「tom」被两个人
 * 各占一份；display 列仍保留玩家输入的原貌用于展示。 */
export const ALIAS_MIN = 2
export const ALIAS_MAX = 20
const ALIAS_CHARS = /^[\p{L}\p{N}_-]+$/u

/* 合法返回归一化键（小写），非法返回 null。 */
export function normalizeAlias(raw) {
  const s = String(raw == null ? '' : raw).trim()
  if (s.length < ALIAS_MIN || s.length > ALIAS_MAX) return null
  if (!ALIAS_CHARS.test(s)) return null
  return s.toLowerCase()
}

/* 判定「一串输入是不是存档码（owner）」。
 * 认领框同时接受别名和存档码，必须先分清：一个 10 个字符的纯字母别名
 * 若被当成 owner，就会被写进 x-owner 头去找一份根本不存在的档。
 * 这里只认标准 UUID（crypto.randomUUID 的形态）与 getOwner() 在
 * 无 crypto 环境下的 'u' 开头兜底码；两者长度都远超别名上限的一部分，
 * 或者带 UUID 特有的连字符分组，不会和真实别名混淆。 */
export function isOwnerCode(raw) {
  const s = String(raw == null ? '' : raw).trim()
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s)
    || /^u[a-z0-9]{10,}$/i.test(s)
}
