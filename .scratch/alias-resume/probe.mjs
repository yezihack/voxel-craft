/* 别名档案（本机记忆）探针。
 *
 * 覆盖三组：
 *   ① aliasState.js 的读写 / 清除 / 判定，以及损坏数据的降级
 *   ② save.js 的 seam：setAlias 成功后自动写本机档案、deleteSave 清档案
 *   ③ 与 save.js 展示缓存 cachedAlias 的语义隔离（两者不能互相覆盖）
 *
 * 用法：node .scratch/alias-resume/probe.mjs
 *
 * ⚠ save.js 依赖 mesher / mobs / player 等引擎模块（要 GL 上下文），
 *   所以这里只对**纯函数**部分做断言；引擎链路交给 ui-probe 验。
 *   ② 里的 seam 断言用的是源码静态检查（确认调用点存在且在正确分支），
 *   不是运行时 —— 因为真正跑 setAlias 需要一个活的 fetch。 */
import {
  ALIAS_GUIDE_KEY, ALIAS_PROMPT_KEY, ALIAS_STATE_KEY,
  clearAliasPrompt, clearAliasState, hasAliasState,
  readAliasPrompt, readAliasState, readInlineGuideDismissed,
  suppressInlineGuide, writeAliasPrompt, writeAliasState,
} from '../../src/game/aliasState.js'

let fails = 0
const ok = (cond, msg) => {
  if (!cond) { fails++; console.error('  FAIL  ' + msg) } else console.log('  ok    ' + msg)
  return cond
}

/* ---- localStorage 桩：node 里没有，用内存表替代 ---- */
const mem = new Map()
globalThis.localStorage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => { mem.set(k, String(v)) },
  removeItem: (k) => { mem.delete(k) },
  clear: () => mem.clear(),
}

/* ================= ① 档案读写 ================= */

ok(!hasAliasState(), '初始：本机没有别名档案 → 判定为新玩家')
ok(readAliasState().alias === '', '初始：读到空档案')

const OWNER = '01603149-deaf-4713-b6c3-87218d29b52b'
const st = writeAliasState('小明', OWNER, 1700000000000)
ok(st.alias === '小明' && st.owner === OWNER && st.at === 1700000000000, '写入后返回结构正确')
ok(hasAliasState(), '写入后判定为「设过别名」')

const back = readAliasState()
ok(back.alias === '小明', '读回别名一致')
ok(back.owner === OWNER, '读回 owner 一致（这是换回存档的钥匙）')
ok(back.at === 1700000000000, '读回时间戳一致')

/* ================= ② 归一化与缺字段降级 ================= */

writeAliasState('  我的世界  ', OWNER)
ok(readAliasState().alias === '我的世界', '别名首尾空格被 trim')

writeAliasState('x', OWNER)
ok(readAliasState().alias === 'x' && hasAliasState(), '1 字别名也接受（合法性由 aliasName.js 管，这里只管存取）')

/* owner 为空 → 视为清空：只有别名没有 owner 是反查不回去的 */
writeAliasState('孤儿', '')
ok(!hasAliasState() && readAliasState().alias === '', 'owner 为空 → 档案清空（只有别名没法反查存档）')

writeAliasState('', OWNER)
ok(!hasAliasState(), '别名为空 → 档案清空')

/* ================= ③ 损坏数据必须降级而不是崩 ================= */
/* 这条路径启动时一定会跑，抛异常等于白屏 */
mem.set(ALIAS_STATE_KEY, '{不是合法JSON')
ok(readAliasState().alias === '', 'JSON 损坏 → 退化成空档案，不抛异常')
ok(!hasAliasState(), 'JSON 损坏 → 判定为新玩家')

mem.set(ALIAS_STATE_KEY, 'null')
ok(readAliasState().alias === '', 'JSON 为 null → 退化成空档案')

mem.set(ALIAS_STATE_KEY, '"一个字符串"')
ok(readAliasState().alias === '', 'JSON 是字符串 → 退化成空档案')

mem.set(ALIAS_STATE_KEY, '{"alias":"只有别名"}')
ok(!hasAliasState(), '只有 alias 没有 owner → 不算设过（反查不回去）')

mem.set(ALIAS_STATE_KEY, '{"alias":"x","owner":"","at":1}')
ok(!hasAliasState(), 'owner 为空串 → 不算设过')

mem.set(ALIAS_STATE_KEY, '{"alias":123,"owner":"o"}')
ok(!hasAliasState(), 'alias 类型错（数字）→ 不算设过')

mem.set(ALIAS_STATE_KEY, '{"alias":"x","owner":"o","at":"不是数字"}')
ok(readAliasState().at === 0, 'at 不是数字 → 归零，不影响其余字段')
ok(hasAliasState(), 'at 坏掉不影响「设过」判定')

/* ================= ④ 清除 ================= */

writeAliasState('小明', OWNER)
clearAliasState()
ok(!hasAliasState(), 'clearAliasState 后判定为新玩家')
ok(!mem.has(ALIAS_STATE_KEY), 'clearAliasState 真的删掉了键')

/* ================= ⑤ 提示状态 ================= */

ok(readAliasPrompt() === null, '初始没有提示状态')
const p = writeAliasPrompt('resume', '小明')
ok(p && p.mode === 'resume' && p.alias === '小明', '写提示状态结构正确')
ok(readAliasPrompt().mode === 'resume', '读回提示状态一致')

clearAliasPrompt()
ok(readAliasPrompt() === null, 'clearAliasPrompt 清空')

mem.set(ALIAS_PROMPT_KEY, '坏JSON')
ok(readAliasPrompt() === null, '提示状态 JSON 损坏 → 退化成 null')

/* ================= ⑥ 行内引导抑制 ================= */

ok(!readInlineGuideDismissed(), '初始：行内引导没被拒绝过')
suppressInlineGuide()
ok(readInlineGuideDismissed(), 'suppressInlineGuide 后：行内引导被压制')
ok(mem.get(ALIAS_GUIDE_KEY) === '1', '抑制写的是 StartVeil 认的那个键')

/* ================= ⑦ 语义隔离：不能覆盖 save.js 的展示缓存 ================= */
/* save.js 的 cachedAlias 键是 'voxel-craft:alias'，本模块是 'voxel-craft:alias-state'。
 * 两者必须互不干扰：cachedAlias 随身份变（setOwner 会清），aliasState 不随身份变
 * （换回来还要用它找存档）。 */
mem.set('voxel-craft:alias', '展示缓存')
writeAliasState('档案别名', OWNER)
ok(mem.get('voxel-craft:alias') === '展示缓存', '写本机档案不碰 save.js 的展示缓存')
ok(mem.get(ALIAS_STATE_KEY).includes('档案别名'), '本机档案独立存放')

mem.clear()
writeAliasState('档案别名', OWNER)
mem.set('voxel-craft:alias', '展示缓存')
clearAliasState()
ok(mem.get('voxel-craft:alias') === '展示缓存', '清本机档案不碰 save.js 的展示缓存')

/* ================= ⑧ save.js 的 seam（源码静态检查） ================= */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const saveSrc = readFileSync(resolve(here, '../../src/game/save.js'), 'utf8')

/* setAlias 成功后必须写本机档案 —— 这是「所有入口都记上」的保证点。
 * 漏了它，玩家从 StartVeil 面板设的别名就不会被记住。 */
const setAliasBody = saveSrc.slice(saveSrc.indexOf('export async function setAlias'))
  .slice(0, saveSrc.indexOf('export async function setAlias') + 1200)
ok(/writeAliasState\s*\(/.test(setAliasBody), 'setAlias 里调用了 writeAliasState')
ok(setAliasBody.indexOf('writeAliasState') < setAliasBody.indexOf('return d'),
  'writeAliasState 在 return 之前（成功分支才写）')
ok(/if\s*\(\s*d\s*&&\s*d\.ok\s*\)/.test(setAliasBody), 'writeAliasState 在 ok 判断的分支内')

/* deleteSave 必须清本机档案 —— 否则删档后还会问「要不要加载这份存档」。 */
const delBody = saveSrc.slice(saveSrc.indexOf('export function deleteSave'))
  .slice(0, 400)
ok(/clearAliasState\s*\(/.test(delBody), 'deleteSave 里调用了 clearAliasState')

/* setOwner 换身份**不**清本机档案 —— 那是换回自己存档的钥匙。
 * 真正该清的是展示缓存 cacheAlias。 */
const ownerBody = saveSrc.slice(saveSrc.indexOf('export function setOwner'))
  .slice(0, 600)
ok(!/clearAliasState\s*\(/.test(ownerBody), 'setOwner 不清本机档案（换回来还要用）')
ok(/cacheAlias\s*\(\s*''\s*\)/.test(ownerBody), 'setOwner 仍清展示缓存')

/* ================= ⑨ App.vue 挂载顺序 ================= */
const appSrc = readFileSync(resolve(here, '../../src/App.vue'), 'utf8')
const iAlias = appSrc.indexOf('<AliasResume />')
const iVeil = appSrc.indexOf('<StartVeil />')
ok(iAlias > 0 && iVeil > 0, 'App.vue 里两个组件都挂上了')
ok(iAlias < iVeil, 'AliasResume 排在 StartVeil 之前（抑制行内引导依赖这个顺序）')

/* ================= ⑩ 组件的关键判据（源码静态检查） ================= */
const compSrc = readFileSync(resolve(here, '../../src/components/AliasResume.vue'), 'utf8')

/* 「身份已换时每次都弹」是跨设备找回能不能落地的关键：
 * 身份一致 + 拒绝过 → 不再弹；身份已换 → 每次都弹。
 * 判据在 watch 里，反例是「一律记 refused 就再也不弹」——那会让玩家
 * 认领完别人的档之后再也找不到自己的档。 */
ok(/ownerMatches\(\)\s*\)\s*return/.test(compSrc), '身份一致且已拒绝 → 直接 return（不再弹）')
ok(/refused\s*&&\s*ownerMatches\(\)/.test(compSrc), '「不再弹」的前提是身份一致（refused && ownerMatches）')
ok(/writeAliasPrompt\(\s*'resume'/.test(compSrc), '拒绝时记 resume 提示状态')

/* dismiss 的记录必须也带身份判断：身份已换时不记，下次才还会弹。 */
const dismissBody = compSrc.slice(compSrc.indexOf('function dismiss()')).slice(0, 400)
ok(/ownerMatches\(\)[\s\S]*writeAliasPrompt/.test(dismissBody), 'dismiss 里也按 ownerMatches 决定要不要记')

/* nothingToLoad：确实没东西可加载时不给出必然失败的「加载」按钮。 */
ok(/nothingToLoad/.test(compSrc), '组件里有 nothingToLoad 判据')
ok(/v-if="!nothingToLoad"/.test(compSrc), '加载按钮受 nothingToLoad 控制')
/* 云端不可达时不能当成「没有」—— 那会让离线玩家永远加载不了自己的档。 */
const ntlBody = compSrc.slice(compSrc.indexOf('const nothingToLoad')).slice(0, 400)
ok(!/offline/.test(ntlBody.replace(/\/\*[\s\S]*?\*\//g, '')), 'nothingToLoad 不把 offline 当成「没有」')

/* 加载路径：身份不一致时必须先换 owner，且只能走云端。
 * 换之前就 loadNow() 会把「别人的世界」加载进来。 */
const resumeBody = compSrc.slice(compSrc.indexOf('async function resume()')).slice(0, 1600)
ok(/setOwner\(\s*s\.owner\s*\)/.test(resumeBody), '身份不一致时先 setOwner 换回原账号')
ok(/!switching\s*&&[\s\S]*loadNow/.test(resumeBody), 'loadNow 只在身份一致时调用')
ok(/loadFromCloud/.test(resumeBody), '拉不到本机档时回落云端')
/* 拉失败要把身份换回去，别把玩家留在别人的身份上。 */
ok(/setOwner\(\s*prevOwner\s*\)/.test(resumeBody), '失败时把身份换回原值')

/* probe：身份不一致时不去白查云端（查的是当前 owner 的档）。 */
const probeBody = compSrc.slice(compSrc.indexOf('async function probe()')).slice(0, 900)
ok(/!ownerMatches\(\)[\s\S]*'switch'[\s\S]*return/.test(probeBody), '身份不一致时直接标 switch，不发云端请求')

/* ================= 结果 ================= */
console.log(fails === 0 ? '\nALL PASS' : `\n${fails} FAILED`)
process.exit(fails === 0 ? 0 : 1)
