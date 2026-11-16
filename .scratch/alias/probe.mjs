/* 别名校验 / 归一化纯函数探针（客户端与 Pages Functions 共用同一份规则）。
 * 用法：node .scratch/alias/probe.mjs */
import { ALIAS_MIN, ALIAS_MAX, isOwnerCode, normalizeAlias } from '../../src/game/aliasName.js'

let fails = 0
const ok = (cond, msg) => {
  if (!cond) { fails++; console.error('  FAIL  ' + msg) } else console.log('  ok    ' + msg)
  return cond
}

/* ---- 合法别名 ---- */
ok(normalizeAlias('htop') === 'htop', '纯字母别名')
ok(normalizeAlias('  MyWorld  ') === 'myworld', 'trim + 大小写归一化')
ok(normalizeAlias('我的世界') === '我的世界', '中文别名')
ok(normalizeAlias('存档A_01') === '存档a_01', '中文 + 字母数字 + 下划线混合')
ok(normalizeAlias('a-b') === 'a-b', '连字符别名')
ok(normalizeAlias('ab') === 'ab', `最短 ${ALIAS_MIN} 字`)

/* ---- 非法别名 ---- */
ok(normalizeAlias('a') === null, '少于最短长度')
ok(normalizeAlias('x'.repeat(ALIAS_MAX + 1)) === null, `超过 ${ALIAS_MAX} 字`)
ok(normalizeAlias('my world') === null, '空格')
ok(normalizeAlias('hello world') === null, '含空格的常用词组')
ok(normalizeAlias('a.b') === null, '句点')
ok(normalizeAlias('🚀') === null, 'emoji')
ok(normalizeAlias('') === null && normalizeAlias(null) === null, '空输入')
ok(normalizeAlias('<script>') === null, '尖括号（防注入到展示层）')

/* ---- 存档码判定：必须和别名严格分开 ----
 * 关键回归：一个 10 字符的纯字母别名曾被当作 owner 写进 x-owner 头，
 * 导致「输入别名却去找了一份根本不存在的档」。 */
const uuid = '01603149-deaf-4713-b6c3-87218d29b52b'
ok(isOwnerCode(uuid) === true, '标准 UUID 判为存档码')
ok(isOwnerCode(uuid.toUpperCase()) === true, '大写 UUID 判为存档码')
ok(isOwnerCode('uabc123xyz098') === true, '无 crypto 环境的 u 开头兜底码')
ok(isOwnerCode('myworld123') === false, '10 字符纯字母别名不判为存档码')
ok(isOwnerCode('我的世界') === false, '中文别名不判为存档码')
ok(isOwnerCode('a-b') === false, '短别名不判为存档码')
ok(isOwnerCode('') === false && isOwnerCode(null) === false, '空输入不判为存档码')

/* ---- 归一化后仍可回查：大小写不敏感 ---- */
ok(normalizeAlias('MyWorld') === normalizeAlias('myworld'), '大小写变体归一到同一键（判重基础）')
ok(normalizeAlias('  MyWorld ') === normalizeAlias('myworld'), '空格 trim 后归一到同一键')

console.log(fails ? `\nFAIL  ${fails} 条断言未通过` : '\nALL PASS')
if (fails) process.exit(1)
