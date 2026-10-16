/* 在开发服务器上驱动真实 Chrome：拿到引擎门面 → 切模式 / 开始游戏（不请求指针锁定，
 * 免得被「无用户手势」拦下）→ 逐个界面截图 + 断言。Node 22 自带 fetch / WebSocket。 */
const fs = require('fs')

const PORT = process.env.CDP_PORT || 9224
const OUT = process.argv[2]
const TARGET_URL = process.argv[3] || 'http://localhost:5173/'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function main() {
  let page = null
  for (let i = 0; i < 60; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()
      page = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl)
      if (page) break
    } catch (e) { /* 还没起来 */ }
    await sleep(300)
  }
  if (!page) throw new Error('没找到可调试的页面')

  const ws = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej })

  let id = 0
  const pending = new Map()
  const logs = []
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data)
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) }
    if (m.method === 'Runtime.consoleAPICalled') {
      const txt = (m.params.args || []).map((a) => a.value ?? a.description ?? '').join(' ')
      if (m.params.type === 'error' || m.params.type === 'warning') logs.push(`[${m.params.type}] ${txt}`)
    }
    if (m.method === 'Runtime.exceptionThrown') {
      const d = m.params.exceptionDetails
      logs.push('[exception] ' + (d.exception?.description || d.text))
    }
  }
  const send = (method, params = {}) => new Promise((res) => {
    const mid = ++id
    pending.set(mid, (m) => res(m.result))
    ws.send(JSON.stringify({ id: mid, method, params }))
  })

  await send('Runtime.enable')
  await send('Page.enable')

  const evaluate = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })
    if (r.exceptionDetails) logs.push('[eval] ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text))
    return r.result && r.result.value
  }
  const shot = async (name) => {
    const r = await send('Page.captureScreenshot', { format: 'png' })
    fs.writeFileSync(`${OUT}/${name}.png`, Buffer.from(r.data, 'base64'))
  }
  const key = async (code) => {
    await evaluate(`window.dispatchEvent(new KeyboardEvent('keydown',{code:'${code}'}));
                    window.dispatchEvent(new KeyboardEvent('keyup',{code:'${code}'})); 1`)
  }

  // 等世界生成完成
  for (let i = 0; i < 100; i++) {
    const t = await evaluate(`document.querySelector('.hint') ? document.querySelector('.hint').textContent : ''`)
    if (t && t.includes('地形就绪')) break
    await sleep(300)
  }

  // 拿引擎门面（Vite 模块注册表里是同一个实例）
  await evaluate(`(async () => {
    const m = await import('/src/engine.js');
    window.__eng = m.engine; window.__ui = m.ui; return 1;
  })()`)
  console.log('引擎就绪:', await evaluate(`!!window.__eng.startGame`))

  /* ---------- 1. 生存模式游戏内 HUD ---------- */
  await evaluate(`window.__eng.pickMode(1); window.__eng.startGame(false); 1`)
  await sleep(1200)
  await shot('01-survival-hud')
  console.log('vitals 显示:', await evaluate(`getComputedStyle(document.querySelector('.vitals')).display`))
  console.log('生命/饥饿/氧气图标:', await evaluate(
    `[document.querySelectorAll('.hearts svg').length, document.querySelectorAll('.foodRow svg').length, document.querySelectorAll('.airRow svg').length].join('/')`))
  console.log('氧气行:', await evaluate(`getComputedStyle(document.querySelector('.airRow')).visibility`))
  console.log('快捷栏 9 格标题:', await evaluate(`[...document.querySelectorAll('.hotbar .slot')].map(e=>e.title).join(' | ')`))
  console.log('HUD 状态行:', await evaluate(`document.querySelector('.hud .dim').textContent`))

  /* ---------- 2. 背包（合成台 + 54 格） ---------- */
  await key('KeyE')
  await sleep(900)
  await shot('02-bag-survival')
  console.log('背包 display:', await evaluate(`getComputedStyle(document.querySelector('.bag')).display`))
  console.log('合成格/配方/背包格:', await evaluate(
    `[document.querySelectorAll('.cslot').length, document.querySelectorAll('.booklist .bk').length, document.querySelectorAll('.invgrid .islot').length].join('/')`))
  console.log('灰掉的配方数:', await evaluate(`document.querySelectorAll('.booklist .bk.no').length`))
  console.log('背包副标题:', await evaluate(`document.querySelector('.bagpanel .sub').textContent`))
  console.log('快捷栏那一排键位号:', await evaluate(`[...document.querySelectorAll('.invgrid.hotrow .key')].map(e=>e.textContent).join('')`))

  /* ---------- 3. 展开全部格子 ---------- */
  await evaluate(`document.querySelector('.invmore').click(); 1`)
  await sleep(500)
  await shot('03-bag-expanded')
  console.log('展开后可见格数:', await evaluate(
    `[...document.querySelectorAll('.invgrid .islot')].filter(e=>e.offsetParent!==null).length`))
  console.log('按钮文案:', await evaluate(`document.querySelector('.invmore').textContent`))

  /* ---------- 4. 创造模式 + 方块库 ---------- */
  await evaluate(`window.__ui.bagOpen = false; window.__eng.pickMode(0); 1`)
  await sleep(400)
  await shot('04-creative-hud')
  console.log('创造模式下 vitals:', await evaluate(`document.querySelector('.vitals') ? '有' : '无'`))
  console.log('创造快捷栏标题:', await evaluate(`[...document.querySelectorAll('.hotbar .slot')].map(e=>e.title).join(' | ')`))
  await evaluate(`window.__ui.bagOpen = true; 1`)
  await sleep(800)
  await shot('05-library')
  console.log('方块库条目/分隔:', await evaluate(
    `[document.querySelectorAll('.baggrid .bg-item').length, document.querySelector('.libsep').textContent].join(' / ')`))
  console.log('背包标题:', await evaluate(`document.querySelector('.bagpanel h2').textContent`))
  console.log('选中态条目:', await evaluate(`document.querySelectorAll('.baggrid .bg-item.sel').length`))

  /* ---------- 5. 死亡界面 ---------- */
  await evaluate(`window.__ui.bagOpen = false; window.__ui.deathVisible = true; window.__ui.deathMsg = '生命值归零'; 1`)
  await sleep(400)
  await shot('06-death')
  console.log('死亡界面 display:', await evaluate(`getComputedStyle(document.querySelector('.death')).display`))
  console.log('死亡文案:', await evaluate(`document.querySelector('.death .tagline').textContent`))
  await evaluate(`window.__ui.deathVisible = false; 1`)

  /* ---------- 6. 暂停遮罩 ---------- */
  await sleep(300)
  await evaluate(`window.__ui.veilVisible = true; window.__ui.veilHint = '已暂停 — 点击继续，或按 <b>Esc</b> 关闭鼠标锁定'; 1`)
  await sleep(400)
  await shot('07-paused')

  /* ---------- 7. 触屏控件 ---------- */
  await evaluate(`window.__ui.veilVisible = false; window.__ui.touch = true; 1`)
  await sleep(600)
  await shot('08-touch')
  console.log('触屏控件:', await evaluate(
    `[!!document.querySelector('.stick'), !!document.querySelector('.joy2'), document.querySelectorAll('.tbtns .tb').length].join('/')`))
  console.log('摇杆尺寸:', await evaluate(
    `(()=>{const e=document.querySelector('.stick');const r=e.getBoundingClientRect();return Math.round(r.width)+'x'+Math.round(r.height)+' @ '+Math.round(r.left)+','+Math.round(r.bottom)})()`))
  await evaluate(`window.__ui.touch = false; 1`)

  console.log('\n=== 控制台错误 / 警告 ===')
  const real = logs.filter((l) => !/willReadFrequently|GL Driver Message|AudioContext/.test(l))
  console.log(real.length ? real.slice(0, 20).join('\n') : '（无）')
  ws.close()
}

main().catch((e) => { console.error('失败:', e); process.exit(1) })
