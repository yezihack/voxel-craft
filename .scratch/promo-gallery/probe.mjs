/* 宣传页素材库 + 全屏查看器的验收脚本。
 *
 * 用法（先起一个静态服务器指向 dist）：
 *   npx vite preview --port 5181 --strictPort
 *   PW_ROOT=... CHROME_PATH=... node .scratch/promo-gallery/probe.mjs
 *
 * 验证点：素材卡片数量、点开视频/截图、← → 翻页、Esc 关闭、主图入口、
 * 体积一栏真的读到了 Content-Length、游戏页有宣传页入口、零控制台报错。
 */
import { createRequire } from 'node:module'
const req = createRequire(process.env.PW_ROOT ? `${process.env.PW_ROOT}/x.js` : import.meta.url)
const { chromium } = req('playwright')

const BASE = process.env.PROBE_BASE || 'http://localhost:5181'
const OUT = '.scratch/promo-gallery/'

let pass = 0, fail = 0
const ok = (cond, label, extra = '') => {
  if (cond) { pass++; console.log(`  ok   ${label}${extra ? `  · ${extra}` : ''}`) }
  else { fail++; console.log(`  FAIL ${label}${extra ? `  · ${extra}` : ''}`) }
}

const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || undefined,
  args: ['--enable-gpu', '--ignore-gpu-blocklist'],
})
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
const errs = []
page.on('pageerror', (e) => errs.push('pageerror: ' + e.message))
page.on('console', (m) => { if (m.type() === 'error') errs.push('console: ' + m.text()) })

await page.goto(BASE + '/intro.html', { waitUntil: 'load' })
await page.waitForTimeout(1200)

/* ---------- A. 素材库结构 ---------- */
const cards = await page.$$eval('#media .mcard', (els) =>
  els.map((e) => {
    const sz = e.querySelector('[data-size]')
    return {
      title: e.querySelector('.mt').textContent.trim(),
      size: sz ? sz.textContent.trim() : null,
      dl: !!e.querySelector('a.dl[download]'),
      lb: e.querySelector('.hit').getAttribute('data-lb'),
    }
  }))
ok(cards.length === 8, '素材库有 8 张卡片', String(cards.length))
ok(cards.every((c) => c.dl), '每张卡片都有下载链接')
ok(cards.every((c) => c.lb !== null), '每张卡片都能点开查看')
console.log('     ' + cards.map((c) => `${c.title}(${c.size || '无体积'})`).join(' / '))
/* 二维码是矢量图，刻意不报体积（gzip 后报出来的数和磁盘上的对不上） */
const sized = cards.filter((c) => c.size !== null)
ok(sized.length === 7, '除矢量图外 7 张卡片都有体积', String(sized.length))
ok(sized.every((c) => c.size !== '—'), '体积一栏读到了真实 Content-Length')
ok(/MB$/.test(cards[0].size), '视频体积按 MB 显示', cards[0].size)

/* ---------- B. 点开视频 ---------- */
const lbOpen = () => page.evaluate(() => {
  const lb = document.getElementById('lb')
  return { open: lb.classList.contains('open'), aria: lb.getAttribute('aria-hidden') }
})
let st = await lbOpen()
ok(!st.open, '初始状态查看器是关的')

await page.click('#media .mcard:nth-child(1) .hit')
await page.waitForTimeout(700)
st = await lbOpen()
ok(st.open && st.aria === 'false', '点视频卡片 → 查看器打开')
const vidInfo = await page.evaluate(() => {
  const v = document.querySelector('#lbStage video')
  return v ? { tag: 'video', srcs: [...v.querySelectorAll('source')].map((s) => s.type), controls: v.controls } : null
})
ok(vidInfo && vidInfo.tag === 'video', '舞台上真的是 <video> 而不是图片')
ok(vidInfo && vidInfo.srcs.length === 2, '同时给了 mp4 / webm 两个源', vidInfo ? vidInfo.srcs.join(',') : '')
ok(vidInfo && vidInfo.controls, '带原生控件（能拖进度条、调音量）')
ok((await page.textContent('#lbTitle')).includes('实机演示'), '标题正确', await page.textContent('#lbTitle'))
ok((await page.textContent('#lbIdx')) === '1 / 8', '计数 1 / 8', await page.textContent('#lbIdx'))
const dlHref = await page.getAttribute('#lbDl', 'href')
ok(dlHref === '/media/demo.mp4', '下载按钮指向当前素材', dlHref)

await page.screenshot({ path: OUT + 'lb-video.png' })

/* ---------- C. ← → 翻页 ---------- */
await page.keyboard.press('ArrowRight')
await page.waitForTimeout(500)
ok((await page.textContent('#lbIdx')) === '2 / 8', '→ 翻到第 2 件', await page.textContent('#lbIdx'))
const nowImg = await page.evaluate(() => {
  const im = document.querySelector('#lbStage img')
  const v = document.querySelector('#lbStage video')
  return { img: im ? im.getAttribute('src') : null, video: !!v }
})
ok(nowImg.img === '/media/shot-survival.webp', '第 2 件是生存模式截图', String(nowImg.img))
ok(!nowImg.video, '切到图片时视频节点被移除（不会在后台继续播）')

await page.keyboard.press('ArrowLeft')
await page.waitForTimeout(400)
ok((await page.textContent('#lbIdx')) === '1 / 8', '← 翻回第 1 件')

/* 首尾环绕 */
await page.keyboard.press('ArrowLeft')
await page.waitForTimeout(400)
ok((await page.textContent('#lbIdx')) === '8 / 8', '第 1 件再往左 → 环绕到 8 / 8', await page.textContent('#lbIdx'))

/* ---------- D. Esc 关闭 ---------- */
await page.keyboard.press('Escape')
await page.waitForTimeout(400)
st = await lbOpen()
ok(!st.open && st.aria === 'true', 'Esc 关闭查看器')
const bodyLock = await page.evaluate(() => document.body.classList.contains('lb-open'))
ok(!bodyLock, '关闭后恢复页面滚动')
const leftovers = await page.evaluate(() => document.querySelectorAll('#lbStage img,#lbStage video').length)
ok(leftovers === 0, '关闭后舞台被清空（视频真的停了）', String(leftovers))

/* ---------- E. 主图入口：跟着当前缩略图走 ---------- */
await page.click('#galThumbs button:nth-child(3)')
await page.waitForTimeout(500)
await page.click('#galOpen')
await page.waitForTimeout(600)
ok((await page.textContent('#lbIdx')) === '3 / 5', '主图打开的是当前那张（3 / 5）', await page.textContent('#lbIdx'))
ok((await page.textContent('#lbTitle')).includes('方块库'), '标题跟着缩略图走', await page.textContent('#lbTitle'))
const prevHidden = await page.getAttribute('#lbPrev', 'hidden')
ok(prevHidden === null, '多张时显示翻页键')
await page.screenshot({ path: OUT + 'lb-shot.png' })
await page.keyboard.press('Escape')
await page.waitForTimeout(300)

/* ---------- F. hero 的放大键 ---------- */
await page.click('#expBtn')
await page.waitForTimeout(600)
ok((await page.textContent('#lbIdx')) === '1 / 8', 'hero 放大键直接打开视频', await page.textContent('#lbIdx'))
await page.keyboard.press('Escape')
await page.waitForTimeout(300)

/* ---------- G. 游戏页有宣传页入口 ---------- */
await page.goto(BASE + '/', { waitUntil: 'load' })
await page.waitForTimeout(1500)
const promo = await page.evaluate(() => {
  const a = document.querySelector('.promolink')
  return a ? { href: a.getAttribute('href'), text: a.textContent.trim() } : null
})
ok(promo && promo.href === '/intro.html', '游戏页有通往宣传页的入口', promo ? promo.href : '没有')
console.log('     入口文案：' + (promo ? promo.text.replace(/\s+/g, ' ') : ''))

/* ---------- H. 手机视口 ---------- */
await page.goto(BASE + '/intro.html', { waitUntil: 'load' })
await page.setViewportSize({ width: 390, height: 844 })
await page.waitForTimeout(800)
await page.evaluate(() => document.getElementById('media').scrollIntoView())
await page.waitForTimeout(600)
await page.screenshot({ path: OUT + 'media-mobile.png' })
await page.click('#media .mcard:nth-child(2) .hit')
await page.waitForTimeout(600)
await page.screenshot({ path: OUT + 'lb-mobile.png' })
const overflowX = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
ok(overflowX <= 0, '手机视口没有横向溢出', String(overflowX))
await page.keyboard.press('Escape')

/* ---------- 桌面整体截图 ---------- */
await page.setViewportSize({ width: 1280, height: 900 })
await page.waitForTimeout(400)
await page.evaluate(() => document.getElementById('media').scrollIntoView())
await page.waitForTimeout(600)
await page.screenshot({ path: OUT + 'media-desktop.png' })

console.log('\n页面报错:', errs.length ? errs.join(' | ') : '无')
ok(errs.length === 0, '零控制台报错')

await browser.close()
console.log(`\n结果：${pass} 过 / ${fail} 挂`)
process.exit(fail ? 1 : 0)
