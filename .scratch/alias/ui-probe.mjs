/* 别名功能端到端验收（真实 Chrome + 本地 Pages Functions/D1）。
 *
 * 用两个独立 browser context 模拟两台设备：
 *   A 设置别名并存档 → B 输入别名认领 → 应载入 A 的世界。
 * 覆盖：首次引导、判重冲突、大小写不敏感、别名跟 owner 变、
 *       导出/导入按钮已移除、零控制台报错。
 *
 * ⚠ 两个页面同时开 WebGL + swiftshader 会把第二个页面卡到不渲染，
 *   所以 A 验证完立即关掉 context 再开 B；纯 API 请求一律走 node fetch。
 *
 * 用法：PW_ROOT=<playwright 包路径> CHROME_PATH=<chrome> \
 *       node .scratch/alias/ui-probe.mjs
 * 前置：npx wrangler@3 pages dev dist --local --port 8788
 */
import { createRequire } from 'node:module'
const req = createRequire(process.env.PW_ROOT ? `${process.env.PW_ROOT}/x.js` : import.meta.url)
const { chromium } = req('playwright')

const BASE = process.env.PROBE_URL || 'http://localhost:8788'
const results = []
function check(name, ok, extra = '') {
  results.push({ name, ok })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? ' — ' + extra : ''}`)
}

const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || undefined,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
})
const errors = []
function watchErrors(page) {
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message))
}

async function dump(page, tag) {
  try {
    const d = await page.evaluate(() => {
      const v = document.querySelector('.veil')
      return {
        url: location.href,
        veilCls: v ? v.className : null,
        veilDisplay: v ? getComputedStyle(v).display : null,
        h1: !!document.querySelector('.veil .panel h1'),
        text: document.body.innerText.slice(0, 200),
        assets: performance.getEntriesByType('resource')
          .filter((r) => r.name.includes('/assets/'))
          .map((r) => r.name.split('/').pop()),
      }
    })
    console.error('DIAG', tag, JSON.stringify(d))
  } catch (e) { console.error('DIAG failed', e.message) }
}

async function api(path, owner, init = {}) {
  const headers = { ...(init.headers || {}), ...(owner ? { 'x-owner': owner } : {}) }
  return fetch(`${BASE}${path}`, { ...init, headers })
}

async function putSave(owner) {
  const body = {
    v: 1, seed: 20261116, dim: 0, flat: false, mode: 2, time: 100, selected: 0,
    player: { x: 1, y: 2, z: 3, yaw: 0, pitch: 0, hp: 20, food: 20, air: 10, spawn: [1, 2, 3], fly: false },
    inv: [], slots: [],
    edits: { added: [{ dim: 0, x: 4, y: 5, z: 6, id: 3 }], removed: [] },
  }
  const r = await api('/api/save', owner, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  return r.status
}

async function cleanupOwner(owner) {
  if (!owner) return
  await api('/api/save', owner, { method: 'DELETE' }).catch(() => {})
  await api('/api/alias', owner, { method: 'DELETE' }).catch(() => {})
}

async function openDevice() {
  const ctx = await browser.newContext({ viewport: { width: 900, height: 1000 } })
  const page = await ctx.newPage()
  watchErrors(page)
  await page.goto(BASE, { waitUntil: 'load', timeout: 60000 })
  try {
    await page.waitForSelector('.veil .panel h1', { timeout: 45000 })
  } catch (e) {
    await dump(page, 'openDevice-fail')
    await ctx.close()
    throw e
  }
  await page.waitForFunction(() => {
    const e = document.querySelector('.cloudrow .cloudstat')
    return e && !e.textContent.includes('正在连接')
  }, null, { timeout: 30000 })
  return { ctx, page }
}

let A, B, ownerA = '', ownerB = ''
try {
  /* ---------------- 设备 A：首次引导 + 设置别名 ---------------- */
  A = await openDevice()
  ownerA = (await A.page.textContent('.idrow .idcode code')).trim()
  check('A0 存档码仍是完整 UUID', /^[0-9a-f-]{36}$/i.test(ownerA), ownerA)
  check('A1 首次进入显示别名引导条', await A.page.locator('.aliasguide').isVisible())
  check('A2 导出/导入按钮已移除',
    !(await A.page.evaluate(() => document.body.innerText.includes('导出存档') || document.body.innerText.includes('导入存档'))))

  await A.page.click('.aliasguide .guidebtn:not(.ghost)')
  await A.page.waitForSelector('.claimrow input', { state: 'visible' })
  await A.page.fill('.claimrow input', 'MyWorld')
  await A.page.click('.claimrow button:not(.ghost)')
  await A.page.waitForFunction(
    () => document.querySelector('.tagbtn')?.textContent.includes('MyWorld'),
    null, { timeout: 15000 })
  check('A3 保存后别名 chip 显示 MyWorld',
    (await A.page.textContent('.tagbtn')).includes('MyWorld'))
  check('A4 设置后引导条消失', await A.page.locator('.aliasguide').count() === 0)

  /* 后端确实写进 D1：按小写键也能解析到 A */
  const resolved = await api('/api/alias?name=myworld', 'probe').then((r) => r.json())
  check('A5 别名大小写不敏感（myworld → A 的 UUID）', resolved.owner === ownerA, String(resolved.owner))

  /* 给 A 存一份云档，让 B 的认领有东西可载 */
  const putStatus = await putSave(ownerA)
  check('A6 A 的云端存档写入成功', putStatus === 200, 'status=' + putStatus)

  /* 释放 A 的 WebGL 上下文，否则 B 页面在软件渲染下会卡到不渲染 */
  await A.ctx.close()
  A = null

  /* ---------------- 设备 B：冲突 + 按别名认领 ---------------- */
  B = await openDevice()
  ownerB = (await B.page.textContent('.idrow .idcode code')).trim()
  check('B0 B 是另一台设备（owner 不同）', ownerB !== ownerA, ownerB)

  /* 同名（大小写变体）必须被判重，不能覆盖 A 的绑定 */
  await B.page.click('.tagbtn')
  await B.page.waitForSelector('.claimrow input', { state: 'visible' })
  await B.page.fill('.claimrow input', 'MYWORLD')
  await B.page.click('.claimrow button:not(.ghost)')
  await B.page.waitForFunction(
    () => document.body.innerText.includes('已被占用'), null, { timeout: 15000 })
  check('B1 同名别名被拒绝且不改身份',
    (await B.page.evaluate(() => localStorage.getItem('voxel-craft:owner'))) === ownerB)
  await B.page.click('.claimrow button.ghost')          // 关掉编辑框

  /* 「暂不」必须持久：刷新且云端状态确定后仍不出现。
   * 此时 B 还没有别名，所以这条断言真的在测 localStorage 标记，
   * 不会被「已有别名所以不引导」掩盖。 */
  await B.page.click('.aliasguide .guidebtn.ghost')
  await B.page.reload({ waitUntil: 'load', timeout: 60000 })
  await B.page.waitForSelector('.veil .panel h1', { timeout: 45000 })
  await B.page.waitForFunction(() => {
    const e = document.querySelector('.cloudrow .cloudstat')
    return e && !e.textContent.includes('正在连接')
  }, null, { timeout: 30000 })
  check('B2 「暂不」刷新后不再重复打扰', await B.page.locator('.aliasguide').count() === 0)

  /* 认领：输入别名而不是 UUID */
  await B.page.click('.cloudrow .codebtn')
  await B.page.fill('.claimrow input', 'MyWorld')
  await B.page.click('.claimrow button:not(.ghost)')
  await B.page.waitForFunction(
    (u) => localStorage.getItem('voxel-craft:owner') === u, ownerA, { timeout: 20000 })
  check('B3 输入别名后 owner 切换到 A', true, 'owner=' + ownerA)

  let hidden = false
  try {
    await B.page.waitForFunction(
      () => document.querySelector('.veil')?.classList.contains('hide'), null, { timeout: 15000 })
    hidden = true
  } catch { /* 超时即失败 */ }
  check('B4 认领后直接载入云端存档并进游戏', hidden)
  check('B5 别名随 owner 一起显示为 A 的别名',
    (await B.page.textContent('.tagbtn')).includes('MyWorld'))

  /* ---------------- 引导持久性 + 零报错 ---------------- */
  await B.page.reload({ waitUntil: 'load', timeout: 60000 })
  await B.page.waitForSelector('.veil .panel h1', { timeout: 45000 })
  check('B6 刷新后别名仍正确显示', (await B.page.textContent('.tagbtn')).includes('MyWorld'))
  check('C0 零控制台报错', errors.length === 0, errors.slice(0, 3).join(' | '))
} catch (err) {
  console.error('PROBE ERROR', err)
  if (B) await dump(B.page, 'on-error').catch(() => {})
  console.error('CONSOLE ERRORS', errors.slice(0, 6))
  results.push({ name: 'probe exception', ok: false })
} finally {
  await cleanupOwner(ownerA)
  await cleanupOwner(ownerB)
  if (A) await A.ctx.close().catch(() => {})
  if (B) await B.ctx.close().catch(() => {})
  await browser.close()
}

const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} passed`)
if (failed.length) process.exit(1)
