/* 别名弹窗 UI 探针（真实浏览器）。
 *
 * 用法：
 *   PW_ROOT=".../@playwright/cli/node_modules" \
 *   CHROME_PATH="C:/Program Files/Google/Chrome/Application/chrome.exe" \
 *   BASE_URL=http://localhost:5173/ node .scratch/alias-resume/ui-probe.mjs
 *
 * 覆盖九个局面：
 *   ① 新玩家 → 引导设置别名
 *   ② 设过别名、身份一致 → 问要不要加载
 *   ③ 设过别名、身份已换 → 提示会切回原账号
 *   ④ 身份一致 + 已拒绝 → 不再打扰（面板上有等价入口）
 *   ⑤ 身份已换即使拒绝过 → 仍要弹（回自己档的唯一通路）
 *   ⑥ StartVeil 的行内引导已被压制（不与弹窗重复冒泡）
 *   ⑦ 端到端：真造存档 → 点「加载」→ 存档真的被应用了
 *   ⑧ 设了别名但账号下没有任何存档 → 不给必然失败的「加载」按钮
 *   ⑨ 设了别名 → 本机档案真的写进了 localStorage
 *
 * 两个设计要点：
 *   ① 每个场景一个**独立 context** —— localStorage 天然隔离。
 *      （早期版本用同一个 page 反复 addInitScript，脚本会累积：
 *      后面的场景会看到前面场景留下的状态，断言就不可信了。）
 *   ② 云端用**路由拦截**模拟，不依赖 wrangler 起真后端。
 *      dev server 没有 /api/save，返回的是 index.html，cloudMeta() 解析失败
 *      只会落到 offline —— 那就永远测不到「云端确实没有这份档」这条分支。
 *
 * ⚠ headless 是 SwiftShader 软件渲染，帧率不可信；这里只看 DOM 与控制台。 */
import { createRequire } from 'node:module'
const req = createRequire(process.env.PW_ROOT ? `${process.env.PW_ROOT}/x.js` : import.meta.url)
const { chromium } = req('playwright')

const URL = process.env.BASE_URL || 'http://localhost:5173/'
const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || undefined,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
})

let fails = 0
const ok = (cond, msg) => {
  if (!cond) { fails++; console.error('  FAIL  ' + msg) } else console.log('  ok    ' + msg)
  return cond
}

/* 云端假后端。
 *
 * 默认「云端没有这份档」—— 这是最常见也最需要验的局面（玩家刚设完别名就走了）。
 * 需要「云端有档」的场景传 opts.cloudHas。
 * 业务失败一律 200 + body，与线上一致（4xx 会被浏览器记成控制台资源错误）。 */
async function fakeCloud(ctx, cloudHas = false) {
  await ctx.route(/\/api\/save/, (route) => {
    const r = route.request()
    const u = r.url()
    if (r.method() === 'PUT') {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) })
    }
    if (u.includes('meta=1')) {
      return route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify(cloudHas
          ? { has: true, t: Date.now(), dim: 0, mode: 0, flat: false, blocks: 7 }
          : { has: false }),
      })
    }
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ save: null }) })
  })
  await ctx.route(/\/api\/alias/, (route) => {
    const r = route.request()
    const u = r.url()
    if (r.method() === 'PUT') {
      return route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({ ok: true, alias: '我刚设的名字' }),
      })
    }
    if (r.method() === 'DELETE') {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) })
    }
    if (u.includes('name=')) {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ owner: null }) })
    }
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ alias: null }) })
  })
}

/* 每个场景：独立 context（localStorage 隔离）+ 独立 console 收集。 */
async function scenario(name, seed, checks, opts = {}) {
  console.log(`\n=== ${name} ===`)
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } })
  const page = await ctx.newPage()
  const errs = []
  page.on('console', (m) => { if (m.type() === 'error') errs.push('console: ' + m.text()) })
  page.on('pageerror', (e) => errs.push('pageerror: ' + e.message))
  await fakeCloud(ctx, !!opts.cloudHas)
  /* 用 addInitScript 在页面脚本执行前写好 localStorage —— 此时写才写得住。 */
  await page.addInitScript(seed)
  await page.goto(URL, { waitUntil: 'domcontentloaded' })
  /* 等弹窗出现（引擎就绪后才会决定要不要弹） */
  await page.waitForSelector('.aliasdlg', { timeout: 45000 }).catch(() => {})
  await checks(page)
  if (errs.length) {
    fails += errs.length
    for (const e of errs) console.error('  FAIL  控制台报错 ' + e)
  } else {
    console.log('  ok    零控制台报错')
  }
  await ctx.close()
}

const OWNER_A = '01603149-deaf-4713-b6c3-87218d29b52b'

/* ① 从没设过别名 */
await scenario('① 新玩家：提示设置别名', () => {
  localStorage.removeItem('voxel-craft:alias-state')
  localStorage.removeItem('voxel-craft:alias-prompt')
  localStorage.removeItem('voxel-craft:alias-guide')
}, async (page) => {
  ok(await page.locator('.aliasdlg').count() > 0, '弹窗出现')
  ok((await page.locator('.aliasdlg h1').textContent() || '').includes('起个名字'), '标题是「给存档起个名字」')
  ok(await page.locator('.aliasdlg input').count() > 0, '有别名输入框')
  ok(await page.locator('.aliasdlg .go').count() > 0, '有「保存别名」按钮')
  ok((await page.locator('.aliasdlg .ghost').textContent() || '').includes('以后再说'), '有「以后再说」按钮')
  await page.locator('.aliasdlg .ghost').click()
  await page.waitForTimeout(400)
  ok(await page.locator('.aliasdlg').count() === 0, '点「以后再说」后弹窗关闭')
  await page.waitForTimeout(600)
  ok(await page.locator('.aliasdlg').count() === 0, '关闭后不会自己冒回来')
})

/* ② 本机设过别名、身份一致，且**云端确实有这份档**（本机没档）。
 *
 * 配合 ⑦（本机有档）与 ⑧（本机云端都没档），三条分支全覆盖。 */
await scenario('② 设过别名：问要不要加载', () => {
  localStorage.setItem('voxel-craft:owner', '01603149-deaf-4713-b6c3-87218d29b52b')
  localStorage.setItem('voxel-craft:alias-state', JSON.stringify({
    alias: '我的存档', owner: '01603149-deaf-4713-b6c3-87218d29b52b', at: Date.now(),
  }))
  localStorage.removeItem('voxel-craft:alias-prompt')
}, async (page) => {
  ok(await page.locator('.aliasdlg').count() > 0, '弹窗出现')
  const h1 = await page.locator('.aliasdlg h1').textContent() || ''
  ok(h1.includes('继续上次存档'), '标题是「继续上次存档？」')
  const tag = await page.locator('.aliasdlg .tagline').textContent() || ''
  ok(tag.includes('我的存档'), '显示本机存档的别名')
  const info = await page.locator('.aliasdlg .resumeinfo').textContent() || ''
  ok(info.includes('云端有这份档'), `显示云端有这份档（实际：${info.trim()}）`)
  ok(await page.locator('.aliasdlg .go').count() > 0, '有「加载这份存档」按钮')
  await page.locator('.aliasdlg .ghost').click()
  await page.waitForTimeout(400)
  ok(await page.locator('.aliasdlg').count() === 0, '点「先不用」后弹窗关闭')
}, { cloudHas: true })

/* ③ 本机设过别名、身份已换过 */
await scenario('③ 身份已换：提示会切回原账号', () => {
  localStorage.setItem('voxel-craft:owner', 'uabc123xyz098')
  localStorage.setItem('voxel-craft:alias-state', JSON.stringify({
    alias: '旧档', owner: '01603149-deaf-4713-b6c3-87218d29b52b', at: Date.now(),
  }))
  localStorage.removeItem('voxel-craft:alias-prompt')
}, async (page) => {
  ok(await page.locator('.aliasdlg').count() > 0, '弹窗出现')
  const info = await page.locator('.aliasdlg .resumeinfo').textContent() || ''
  ok(info.includes('切回') || info.includes('换过'), '提示身份已换过、载入会切回原账号')
  ok(await page.locator('.aliasdlg .go').count() > 0, '有「加载这份存档」按钮')
})

/* ④ 身份一致 + 玩家拒绝过 → 不该再弹（面板上有等价入口） */
await scenario('④ 身份一致且已拒绝：不再打扰', () => {
  localStorage.setItem('voxel-craft:owner', '01603149-deaf-4713-b6c3-87218d29b52b')
  localStorage.setItem('voxel-craft:alias-state', JSON.stringify({
    alias: '我的存档', owner: '01603149-deaf-4713-b6c3-87218d29b52b', at: Date.now(),
  }))
  localStorage.setItem('voxel-craft:alias-prompt', JSON.stringify({
    mode: 'resume', alias: '我的存档', at: Date.now(),
  }))
}, async (page) => {
  await page.waitForTimeout(2500)
  ok(await page.locator('.aliasdlg').count() === 0, '身份一致 + 已拒绝 → 不再弹')
})

/* ⑤ 身份已换 + 拒绝过 → 仍要弹（回自己档的唯一通路） */
await scenario('⑤ 身份已换即使拒绝过：仍要弹', () => {
  localStorage.setItem('voxel-craft:owner', 'uabc123xyz098')
  localStorage.setItem('voxel-craft:alias-state', JSON.stringify({
    alias: '我的存档', owner: '01603149-deaf-4713-b6c3-87218d29b52b', at: Date.now(),
  }))
  localStorage.setItem('voxel-craft:alias-prompt', JSON.stringify({
    mode: 'resume', alias: '我的存档', at: Date.now(),
  }))
}, async (page) => {
  await page.waitForTimeout(2500)
  ok(await page.locator('.aliasdlg').count() > 0, '身份已换 → 弹窗照弹（这是回自己档的唯一通路）')
  const info = await page.locator('.aliasdlg .resumeinfo').textContent() || ''
  ok(info.includes('切回') || info.includes('换过'), '提示会切回原账号')
})

/* ⑥ StartVeil 的行内引导不该再出现（已被压制，避免两处重复） */
await scenario('⑥ 行内引导已被压制', () => {
  localStorage.removeItem('voxel-craft:alias-state')
  localStorage.removeItem('voxel-craft:alias-prompt')
  localStorage.removeItem('voxel-craft:alias-guide')
}, async (page) => {
  await page.waitForTimeout(1500)
  ok(await page.locator('.aliasguide').count() === 0, 'StartVeil 的行内引导没有出现（只留弹窗一处）')
})

/* ⑦ 端到端：真造一份本机存档 → 点「加载这份存档」→ 断言存档真的被应用了。
 *
 * 前面六个场景只验了弹窗的「形态」，这个验的是「功能」。
 *
 * 断言不靠 toast —— loadNow 发「📂 已读档」、组件紧接着发「✓ 已载入」，
 * 两者在同一微任务里，Vue 批处理后 DOM 只有最终值，中间态从没进过 DOM
 * （对玩家其实是好事：不会闪两下）。所以改成验**存档内容落到 UI 上的投影**：
 *
 *   存档 mode=1(生存) → ui.mode 变 1 → StartVeil 的生存按钮高亮 .on
 *   存档 flat=true     → ui.worldFlat 变真 → 超平坦按钮高亮 .on
 *   存档 inv 苹果×3    → 生存模式快捷栏走玩家背包 → 第 1 格显示「苹果 ×3」
 *
 * 这三条各自独立，任意一条不成立就说明读档没真的生效。 */
await scenario('⑦ 端到端：加载存档真的进游戏', () => {
  const owner = '01603149-deaf-4713-b6c3-87218d29b52b'
  localStorage.setItem('voxel-craft:owner', owner)
  localStorage.setItem('voxel-craft:alias-state', JSON.stringify({
    alias: '我的存档', owner, at: Date.now(),
  }))
  localStorage.removeItem('voxel-craft:alias-prompt')
  /* 造一份存档。v=1 是 SAVE_VERSION；mode=1 生存、flat=true 超平坦、
   * 苹果(200)×3 放在背包第 1 格 —— 三样都各自有 DOM 投影可查。 */
  localStorage.setItem('voxel-craft:save', JSON.stringify({
    v: 1, t: Date.now(), seed: 20260918, dim: 0, flat: true, mode: 1, time: 0,
    player: {
      x: 8, y: 72, z: 8, yaw: 0, pitch: 0,
      hp: 20, food: 20, air: 300, spawn: [8, 72, 8], fly: false,
    },
    inv: [[200, 3]], slots: [200, 0, 0, 0, 0, 0, 0, 0, 0],
    armor: [], ench: {}, potions: [], chests: [],
    edits: [[['8,71,8', 5]], [], [], [], [], [], [], []],
  }))
  localStorage.setItem('voxel-craft:save:meta', JSON.stringify({
    t: Date.now(), dim: 0, mode: 1, flat: true, blocks: 1,
  }))
}, async (page) => {
  ok(await page.locator('.aliasdlg').count() > 0, '弹窗出现')
  const info = await page.locator('.aliasdlg .resumeinfo').textContent() || ''
  ok(info.includes('本机存档'), '显示本机档摘要（没去查云端）')

  await page.locator('.aliasdlg .go').click()
  await page.waitForTimeout(3000)

  ok(await page.locator('.aliasdlg').count() === 0, '加载后弹窗关闭')
  /* 遮罩隐藏 = 进了游戏。veil 元素还在 DOM 里，只是加了 hide 类。 */
  ok(await page.locator('.veil.hide').count() > 0, '开始遮罩已隐藏（游戏真的开始了）')

  /* ① 模式来自存档：存档写的是生存(1)，默认是创造(0) */
  ok(await page.locator('.modes .mode[data-mode="1"].on').count() > 0, '模式来自存档（生存按钮高亮，默认是创造）')
  /* ② 世界类型来自存档：存档写的是超平坦 */
  const flatOn = await page.evaluate(() => {
    const bs = [...document.querySelectorAll('.worlds .mode')]
    return bs.some((b) => b.classList.contains('on') && b.textContent.includes('超平坦'))
  })
  ok(flatOn, '世界类型来自存档（超平坦高亮）')
  /* ③ 背包来自存档：生存模式快捷栏走玩家背包，第 1 格应是苹果 ×3 */
  const slot0 = await page.evaluate(() => {
    const s = document.querySelector('.hotbar .slot')
    if (!s) return null
    return {
      name: (s.querySelector('.nm') || {}).textContent || '',
      cnt: (s.querySelector('.cnt') || {}).textContent || '',
      on: s.classList.contains('on'),
    }
  })
  ok(!!slot0 && slot0.name.includes('苹果'), `快捷栏第 1 格是苹果（实际：${slot0 && slot0.name}）`)
  ok(!!slot0 && slot0.cnt === '3', `数量角标是 3（实际：${slot0 && slot0.cnt}）`)
  ok(!!slot0 && slot0.on, '选中的是第 1 格（selected 来自存档）')
})

/* ⑧ 设了别名但这个账号下还没有任何存档 → 不该给一个必然失败的「加载」按钮。
 *
 * 这种情况很常见：玩家在开始面板设好别名就走了，一局都没玩过。
 * 此时问「要不要加载」是骗人的 —— 点了只会得到「没找到这份存档」。 */
await scenario('⑧ 有别名但无存档：不骗人', () => {
  const owner = '01603149-deaf-4713-b6c3-87218d29b52b'
  localStorage.setItem('voxel-craft:owner', owner)
  localStorage.setItem('voxel-craft:alias-state', JSON.stringify({
    alias: '空账号', owner, at: Date.now(),
  }))
  localStorage.removeItem('voxel-craft:alias-prompt')
  /* 本机无档、云端也无档 → cloudMeta 返回 {has:false} → cloudState = 'none' */
  localStorage.removeItem('voxel-craft:save')
  localStorage.removeItem('voxel-craft:save:meta')
}, async (page) => {
  ok(await page.locator('.aliasdlg').count() > 0, '弹窗出现')
  const info = await page.locator('.aliasdlg .resumeinfo').textContent() || ''
  ok(info.includes('还没找到'), `如实告知没有存档内容（实际：${info.trim()}）`)
  ok(await page.locator('.aliasdlg .go').count() === 0, '没有「加载这份存档」按钮')
  const ghost = await page.locator('.aliasdlg .ghost').textContent() || ''
  ok(ghost.includes('知道了'), '按钮文案是「知道了」而不是「先不用」')
  await page.locator('.aliasdlg .ghost').click()
  await page.waitForTimeout(400)
  ok(await page.locator('.aliasdlg').count() === 0, '点「知道了」后弹窗关闭')
})

/* ⑨ 设了别名 → 本机档案真的写进了 localStorage。
 *
 * 这是整个功能的**存储前提**：没有这份档案，下次进来就不知道该问
 * 「要不要加载」，也就没有跨设备找回这条路了。 */
await scenario('⑨ 设别名后本机档案落盘', () => {
  localStorage.removeItem('voxel-craft:alias-state')
  localStorage.removeItem('voxel-craft:alias-prompt')
  localStorage.removeItem('voxel-craft:alias-guide')
}, async (page) => {
  ok(await page.locator('.aliasdlg').count() > 0, '弹窗出现')
  await page.locator('.aliasdlg input').fill('我刚设的名字')
  await page.locator('.aliasdlg .go').click()
  await page.waitForTimeout(1500)
  ok(await page.locator('.aliasdlg').count() === 0, '保存成功后弹窗关闭')
  const st = await page.evaluate(() => {
    const raw = localStorage.getItem('voxel-craft:alias-state')
    return raw ? JSON.parse(raw) : null
  })
  ok(!!st, 'localStorage 里写入了 alias-state')
  ok(!!st && st.alias === '我刚设的名字', `档案里记着别名（实际：${st && st.alias}）`)
  const owner = await page.evaluate(() => localStorage.getItem('voxel-craft:owner'))
  ok(!!st && st.owner === owner, `档案里记着 owner（实际：${st && st.owner}）`)
  ok(!!st && st.at > 0, '档案里记着时间戳')
  /* 展示缓存也要同步（面板上要显示这个名字） */
  const cached = await page.evaluate(() => localStorage.getItem('voxel-craft:alias'))
  ok(cached === '我刚设的名字', `展示缓存也写了（实际：${cached}）`)
})

console.log(fails === 0 ? '\nALL PASS' : `\n${fails} FAILED`)
await browser.close()
process.exit(fails === 0 ? 0 : 1)
