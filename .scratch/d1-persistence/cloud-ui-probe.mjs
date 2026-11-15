/* 云端存档面板验收（真实浏览器 + 本地 Pages Functions/D1）。
 *
 * 覆盖三件事：
 *   A 匿名 UUID 真的显示出来，且云端状态能区分「无档 / 已同步 / 离线」；
 *   B 引擎就绪时序修复：云端有档时，首屏就能出现「☁️ 从云端继续」；
 *   C 存档码认领：换 owner 后能拉到另一份云端存档。
 *
 * 用法：PW_ROOT=<playwright 包路径> node .scratch/d1-persistence/cloud-ui-probe.mjs
 * 前置：npx wrangler@3 pages dev dist --local --port 8788
 */
import { createRequire } from 'node:module'
const req = createRequire(process.env.PW_ROOT ? `${process.env.PW_ROOT}/x.js` : import.meta.url)
const { chromium } = req('playwright')

const BASE = process.env.PROBE_URL || 'http://localhost:8788'
const OWNER_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const results = []
function check(name, ok, extra = '') {
  results.push({ name, ok, extra })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? ' — ' + extra : ''}`)
}

const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || undefined,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
})
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } })
const page = await ctx.newPage()
const errors = []
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message))

const put = (owner, seed, blocks) => page.evaluate(async ({ owner, seed, blocks }) => {
  const body = {
    v: 1, seed, dim: 0, flat: false, mode: 2, time: 100, selected: 0,
    player: { x: 1, y: 2, z: 3, yaw: 0, pitch: 0, hp: 20, food: 20, air: 10, spawn: [1, 2, 3], fly: false },
    inv: [], slots: [],
    edits: { added: blocks.map(([x, y, z, id]) => ({ dim: 0, x, y, z, id })), removed: [] },
  }
  const r = await fetch('/api/save', {
    method: 'PUT',
    headers: { 'content-type': 'application/json', 'x-owner': owner },
    body: JSON.stringify(body),
  })
  const text = await r.text()
  let json = null
  try { json = JSON.parse(text) } catch { /* 后端 500 时是纯文本 */ }
  return { status: r.status, json, text: text.slice(0, 120) }
}, { owner, seed, blocks })

const del = (owner) => page.evaluate(async (owner) => {
  const r = await fetch('/api/save', { method: 'DELETE', headers: { 'x-owner': owner } })
  return r.status
}, owner)

try {
  await page.goto(BASE, { waitUntil: 'load', timeout: 60000 })
  await page.waitForSelector('.veil .panel h1', { timeout: 20000 })

  /* A：UUID 可见 + 云端状态从「正在连接」变成确定的结论 */
  await page.waitForFunction(() => {
    const el = document.querySelector('.cloudrow .cloudstat')
    return el && !el.textContent.includes('正在连接')
  }, { timeout: 20000 })
  const code = (await page.textContent('.cloudrow .codebtn code')).trim()
  const labelA = (await page.textContent('.cloudrow .cloudstat')).trim()
  check('A1 存档码显示为完整 UUID', OWNER_RE.test(code), code)
  check('A2 云端状态为「尚无备份」（后端可达且已区分 404）', labelA.includes('尚无备份'), labelA)
  check('A3 localStorage 里写入了 owner', (await page.evaluate(() => localStorage.getItem('voxel-craft:owner'))) === code)

  /* B：给这个 owner 写一份云端档 → 刷新 → 首屏应出现「从云端继续」 */
  const putR = await put(code, 777, [[1, 2, 3, 4], [5, 6, 7, 0]])
  check('B0 云端 PUT 成功', putR.status === 200 && putR.json && putR.json.ok === true, putR.text)
  await page.reload({ waitUntil: 'load', timeout: 60000 })
  await page.waitForSelector('.veil .panel h1', { timeout: 20000 })
  await page.waitForFunction(() => {
    const el = document.querySelector('.cloudrow .cloudstat')
    return el && el.textContent.includes('云端已同步')
  }, { timeout: 20000 })
  const labelB = (await page.textContent('.cloudrow .cloudstat')).trim()
  const cloudBtn = await page.textContent('.savebtn').catch(() => '')
  check('B1 刷新后显示「云端已同步 · 2 格改动」', labelB.includes('2 格改动'), labelB)
  check('B2 首屏出现「☁️ 从云端继续」（engineReady 时序修复生效）', cloudBtn.includes('从云端继续'), cloudBtn.trim().slice(0, 40))

  /* C：空存档码必须被拒绝且还原身份，不能把当前世界误推到别人的空档位 */
  const other = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'
  const putR2 = await put(other, 999, [[9, 9, 9, 8]])
  check('C0 另一 owner 的云端档写入成功', putR2.status === 200, putR2.text)
  await page.click('.cloudrow .codebtn:last-child')
  await page.waitForSelector('.claimrow input', { state: 'visible' })
  await page.fill('.claimrow input', '00000000-0000-0000-0000-000000000000')
  await page.click('.claimrow button')
  await page.waitForFunction((c) => localStorage.getItem('voxel-craft:owner') === c, code, { timeout: 20000 })
  const codeAfterBad = (await page.textContent('.cloudrow .codebtn code')).trim()
  check('C1 空存档码被拒绝且身份还原', codeAfterBad === code, codeAfterBad)

  /* C2：认领有档的码 → owner 切换 + 云端存档被载入 */
  await page.fill('.claimrow input', other)
  await page.click('.claimrow button')
  await page.waitForFunction((c) => localStorage.getItem('voxel-craft:owner') === c, other, { timeout: 20000 })
  const codeC = (await page.textContent('.cloudrow .codebtn code')).trim()
  check('C2 认领后 owner 已切换', codeC === other, codeC)
  /* owner 是同步写入的，但后面还有 cloudMeta + pullFromCloud 两次往返，
   * 必须等遮罩真的隐藏再断言，否则会误判成认领失败。 */
  let veilHidden = false
  try {
    await page.waitForFunction(() => document.querySelector('.veil')?.classList.contains('hide'), null, { timeout: 15000 })
    veilHidden = true
  } catch { /* 超时即失败 */ }
  check('C3 认领后直接载入云端存档并进游戏', veilHidden, 'veil.hide=' + veilHidden)

  check('D 无控制台报错', errors.length === 0, errors.slice(0, 3).join(' | '))

  /* 清理探针数据 */
  await del(code)
  await del(other)
} catch (err) {
  console.error('PROBE ERROR', err)
  results.push({ name: 'probe exception', ok: false, extra: String(err) })
} finally {
  await browser.close()
}

const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} passed`)
if (failed.length) process.exit(1)
