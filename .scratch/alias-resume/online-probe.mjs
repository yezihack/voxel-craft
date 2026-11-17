/* 线上别名弹窗验收探针：跑在真实生产环境（CF_URL）上。
 *
 * 用法：
 *   PW_ROOT="C:/Users/htop/.workbuddy-ai/binaries/node/versions/22.22.2-6/node_modules/@playwright/cli/node_modules" \
 *   CHROME_PATH="C:/Program Files/Google/Chrome/Application/chrome.exe" \
 *   CF_URL=https://voxel-craft-516.pages.dev/ node .scratch/alias-resume/online-probe.mjs
 *
 * 与 ui-probe.mjs 的区别：
 * - ui-probe 打的是 dev server，能用 route() 拦截模拟云端；
 *   这里打的是**生产**，云端是真的，拦截不了 → 只能验证「本机档案」这条路径
 *     （它不依赖网络，是本功能的主路径）。
 * - 线上探针只能**纯 DOM 点击**（Playwright 的 pointerlock 在无头环境下不可靠），
 *   所以全程用 evaluate + dispatchEvent，不依赖坐标点击。
 *
 * 两个场景：
 *   ① 新玩家（从没设过别名）→ 应弹出「给存档起个名字」的引导
 *   ② 设过别名（本地写入 alias-state）→ 应弹出「继续上次存档？」
 */
import { createRequire } from 'node:module'
const req = createRequire(process.env.PW_ROOT ? `${process.env.PW_ROOT}/x.js` : import.meta.url)
const { chromium } = req('playwright')

const URL = process.env.CF_URL || 'https://voxel-craft-516.pages.dev/'
const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || undefined,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
})

let pass = 0
let fail = 0
const ok = (cond, label) => {
  if (cond) { pass++; console.log('  ✓ ' + label) }
  else { fail++; console.log('  ✗ ' + label) }
}

/* 每场景一个独立 context —— localStorage 天然隔离，
 * 且避免 addInitScript 在同一个 page 上累积。 */
async function scenario(name, setup, body) {
  console.log('\n--- ' + name + ' ---')
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } })
  const errs = []
  const page = await ctx.newPage()
  page.on('console', (m) => { if (m.type() === 'error') errs.push('console: ' + m.text()) })
  page.on('pageerror', (e) => errs.push('pageerror: ' + e.message))
  try {
    if (setup) {
      await ctx.addInitScript(setup)
    }
    await page.goto(URL, { waitUntil: 'load', timeout: 60000 })
    /* 等「地形就绪」—— 引擎起来之后弹窗才会出现 */
    await page.waitForFunction(
      () => /地形就绪（/.test((document.querySelector('.veil .hint') || {}).textContent || ''),
      null, { timeout: 120000 },
    )
    await page.waitForTimeout(2500)
    await body(page)
  } catch (e) {
    fail++
    console.log('  ✗ 场景异常：' + e.message)
  }
  if (errs.length) {
    fail++
    console.log('  ✗ 控制台报错：')
    for (const e of errs.slice(0, 6)) console.log('      ' + e)
  } else {
    pass++
    console.log('  ✓ 零控制台报错')
  }
  await ctx.close()
}

/* ① 新玩家：从来没设过别名 → 引导设别名 */
await scenario('① 新玩家：引导设置别名', () => {
  localStorage.clear()
}, async (page) => {
  const dlg = await page.locator('.aliasdlg').count()
  ok(dlg > 0, '弹窗出现')
  const h1 = await page.locator('.aliasdlg h1').textContent().catch(() => '')
  ok(/起个名字|存档别名|设置别名/.test(h1), `标题是引导设别名（实际：「${h1.trim()}」）`)
  const body = await page.locator('.aliasdlg').textContent().catch(() => '')
  ok(/存档|云端|换设备|找回/.test(body), '文案说清了「设别名能存档」的价值')
  /* 新玩家分支的唯一主动作是「保存别名」（提交输入框），
   * 绝不能是「加载这份存档」—— 他还没有任何存档。 */
  const go = await page.locator('.aliasdlg .go').textContent().catch(() => '')
  ok(!/加载/.test(go), `没有「加载这份存档」按钮（实际按钮：「${go.trim()}」）`)
  ok(/保存别名/.test(go), `主动作是「保存别名」（实际：「${go.trim()}」）`)
  /* 点「以后再说」应能关掉，不卡死 */
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('.aliasdlg button')]
      .find((x) => /知道了|先不用|以后再说|稍后/.test(x.textContent || ''))
    if (b) b.click()
  })
  await page.waitForTimeout(500)
  ok(await page.locator('.aliasdlg').count() === 0, '点按钮后弹窗关闭（不卡死）')
})

/* ② 设过别名：本地档案在 → 问要不要加载。
 * 身份一致时本地档可能不存在（线上每个 owner 首次访问），
 * 那会走「没找到存档」的分支 —— 那也是合法行为，
 * 关键判据是**弹出了带别名的续玩询问**。 */
await scenario('② 设过别名：问要不要加载', () => {
  localStorage.clear()
  localStorage.setItem('voxel-craft:owner', '01603149-deaf-4713-b6c3-87218d29b52b')
  localStorage.setItem('voxel-craft:alias-state', JSON.stringify({
    alias: '线上验收档', owner: '01603149-deaf-4713-b6c3-87218d29b52b', at: Date.now(),
  }))
  localStorage.removeItem('voxel-craft:alias-prompt')
}, async (page) => {
  ok(await page.locator('.aliasdlg').count() > 0, '弹窗出现')
  const tag = await page.locator('.aliasdlg .tagline').textContent().catch(() => '')
  ok(tag.includes('线上验收档'), `显示本机档案里的别名（实际：「${tag.trim()}」）`)
  const info = await page.locator('.aliasdlg .resumeinfo').textContent().catch(() => '')
  ok(info.trim().length > 0, `给出了存档来源的说明（实际：「${info.trim()}」）`)
})

console.log(`\n=== 结果：${pass} 通过 / ${fail} 失败 ===`)
await browser.close()
process.exit(fail ? 1 : 0)