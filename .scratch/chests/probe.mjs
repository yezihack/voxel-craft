/* 箱子系统验收探针。
 *
 * 分组：
 *   A 方块与物品登记   —— 4 种箱子方块 + 4 种稀有物品
 *   B 贴图登记         —— 8 张箱子贴图 + 4 张物品图标
 *   C 配方             —— 4 条箱子配方都能命中
 *   D 容器状态机       —— 惰性生成 / 幂等 / 跨维度隔离
 *   E 战利品           —— 每种箱子的战利品池合法且非空
 *   F 存档往返         —— snapshot → restore 无损 + 抗手改
 *   G 交互钩子         —— 右键开箱的钩子已装、箱子方块可识别
 */
import { createRequire } from 'node:module'
const req = createRequire(import.meta.url)
const { chromium } = req('playwright')

let pass = 0, fail = 0
const fails = []
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  PASS  ' + name) }
  else { fail++; fails.push(name + (extra ? ' :: ' + JSON.stringify(extra) : '')); console.log('  FAIL  ' + name + (extra ? ' :: ' + JSON.stringify(extra) : '')) }
}
function group(t) { console.log('\n=== ' + t + ' ===') }

const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH, args: ['--enable-gpu', '--ignore-gpu-blocklist'] })
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } })
const errs = []
page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()) })
page.on('pageerror', (e) => errs.push(String(e && e.message || e)))

await page.goto('http://localhost:5173/', { waitUntil: 'load' })
await page.waitForFunction(() => {
  const h = document.querySelector('.veil .hint')
  return h && /地形就绪/.test(h.textContent || '')
}, { timeout: 90000 })

/* 页面真实加载的模块 URL。
 * ⚠ vite 有时把 game 模块映射成 '/@fs/G:/…/src/game/xxx.js' 绝对路径 ——
 *   如果正则只认 '/src/game/xxx.js'，匹配不到就**静默回退**，浏览器会把
 *   回退 URL 当成**另一个模块实例**分发（containers Map 不共享），
 *   这就是探针双实例问题的真正来源。所以：先从已加载的任意 game 模块
 *   URL 推导出真实的 '…/src/game/' 前缀，匹配不到就抛错，绝不回退。 */
const MODS = await page.evaluate(() => {
  const res = performance.getEntriesByType('resource').map((e) => e.name)
  const anyGame = res.find((u) => /\/src\/game\/[^/]+\.js/.test(u))
  if (!anyGame) throw new Error('页面没有加载任何 /src/game/ 模块')
  const dir = anyGame.match(/^(.*\/src\/game\/)/)[1]
  const want = ['config', 'chests', 'crafting', 'state', 'generate', 'player', 'survival', 'uiActions', 'uiState', 'save', 'actions']
  const out = {}
  for (const w of want) {
    const u = res.filter((x) => x.startsWith(dir) && new RegExp('/' + w + '\\.js(\\?|$)').test(x)).pop()
    if (!u) throw new Error('页面资源里找不到 ' + w + '.js（dir=' + dir + '）')
    out[w] = u
  }
  return out
})

const R = await page.evaluate(async (MODS) => {
  const C = await import(MODS.config)
  const CH = await import(MODS.chests)
  const CR = await import(MODS.crafting)
  const out = {}

  /* ---- A 方块与物品登记 ---- */
  out.blocks = Object.entries(CH.CHEST_BLOCK).map(([id, key]) => ({
    id: +id, key,
    name: C.BLOCKS[+id] && C.BLOCKS[+id].name,
    hard: C.BLOCKS[+id] && C.BLOCKS[+id].hard,
    chestFlag: C.BLOCKS[+id] && C.BLOCKS[+id].chest,
  }))
  out.typeNames = Object.keys(CH.CHEST_TYPES)
  out.slots = Object.fromEntries(Object.entries(CH.CHEST_TYPES).map(([k, v]) => [k, v.slots]))
  out.hards = Object.fromEntries(Object.entries(CH.CHEST_TYPES).map(([k, v]) => [k, v.hard]))
  out.items = {
    BREAD: !!C.ITEMS[C.I.BREAD], EMERALD: !!C.ITEMS[C.I.EMERALD],
    ENDER_PEARL: !!C.ITEMS[C.I.ENDER_PEARL], NETHER_STAR: !!C.ITEMS[C.I.NETHER_STAR],
  }
  out.itemIds = { BREAD: C.I.BREAD, EMERALD: C.I.EMERALD, ENDER_PEARL: C.I.ENDER_PEARL, NETHER_STAR: C.I.NETHER_STAR }

  /* ---- B 贴图 ---- */
  out.tiles = C.TILE_NAMES.filter((n) => /^chest_(wood|iron|gold|ender)_/.test(n))
  out.itemTiles = ['item_bread', 'item_emerald', 'item_ender_pearl', 'item_nether_star']
    .map((n) => ({ n, has: C.TILE_INDEX[n] !== undefined }))
  out.tileTotal = C.TILE_NAMES.length

  /* ---- C 配方 ---- */
  const chestRecipes = CR.RECIPES.filter((r) =>
    r.out === C.I.BOX_WOOD || r.out === C.I.BOX_IRON ||
    r.out === C.I.BOX_GOLD || r.out === C.I.BOX_ENDER)
  out.recipes = chestRecipes.map((r) => ({ out: r.out, grid: r.grid, n: r.n }))
  /* 每条配方引用的字符都必须在 craftKeyTable 里 */
  const KT = CR.craftKeyTable()
  out.recipeCharsOk = chestRecipes.every((r) =>
    r.grid.every((row) => row.split('').every((ch) => ch === ' ' || KT[ch] !== undefined)))

  /* ---- D 容器状态机 ---- */
  CH.clearContainers()
  const woodId = CH.CHEST_OF_BLOCK.wood
  const a = CH.openChest(0, 10, 20, 30, woodId, 12345)
  const b = CH.openChest(0, 10, 20, 30, woodId, 12345)          // 幂等
  out.openA = a && { type: a.type, slots: a.slots, kinds: Object.keys(a.items).length }
  out.sameContent = JSON.stringify(a && a.items) === JSON.stringify(b && b.items)
  /* 跨维度隔离 */
  const c2 = CH.openChest(3, 10, 20, 30, woodId, 12345)
  out.dimIsolated = JSON.stringify(a.items) !== JSON.stringify(c2.items)
  /* 非箱子方块打不开 */
  out.openNonChest = CH.openChest(0, 1, 2, 3, C.I.STONE, 1) === null
  /* 写回 */
  CH.writeChest(0, 10, 20, 30, { 200: 3 })
  const d = CH.openChest(0, 10, 20, 30, woodId, 12345)
  out.writeBack = JSON.stringify(d.items) === JSON.stringify({ 200: 3 })
  /* 拆箱取内容 + 容器记录被删 */
  const taken = CH.takeChestContents(0, 10, 20, 30)
  out.taken = taken
  out.takenThenGone = CH.getContainer(0, 10, 20, 30) === undefined

  /* ---- E 战利品 ---- */
  CH.clearContainers()
  out.loot = {}
  for (const key of out.typeNames) {
    const items = CH.rollLoot(key, 0, 5, 6, 7, 999)
    const ids = Object.keys(items).map(Number)
    const blockIds = ids.filter((id) => !C.ITEMS[id] && C.BLOCKS[id])
    out.loot[key] = {
      kinds: ids.length,
      bad: ids.filter((id) => !C.ITEMS[id] && !C.BLOCKS[id]),
      max: Math.max(0, ...ids.map((id) => items[id])),
      hasBlock: blockIds.length > 0,
      blockKinds: blockIds.length,
    }
  }
  /* 24 个不同坐标的木箱，统计方块类战利品的总种类数 */
  const blockSet = new Set()
  for (let i = 0; i < 24; i++) {
    const items = CH.rollLoot('wood', 0, i * 7 + 3, 11, i * 5 + 2, 42)
    for (const k in items) {
      const id = +k
      if (!C.ITEMS[id] && C.BLOCKS[id]) blockSet.add(id)
    }
  }
  out.loot.wood.blockKindsTotal = blockSet.size
  /* 确定性：同种子两次 roll 相同 */
  out.deterministic = JSON.stringify(CH.rollLoot('gold', 0, 1, 2, 3, 77)) ===
                      JSON.stringify(CH.rollLoot('gold', 0, 1, 2, 3, 77))
  /* 不同坐标内容不同（不能所有箱子都一样） */
  out.varied = JSON.stringify(CH.rollLoot('wood', 0, 1, 1, 1, 5)) !==
               JSON.stringify(CH.rollLoot('wood', 0, 9, 9, 9, 5))
  /* 高阶箱子的战利品应当明显更好：末影箱应给出木箱给不出的东西 */
  const woodIds = new Set(Object.keys(CH.rollLoot('wood', 0, 1, 1, 1, 5)).map(Number))
  const enderIds = new Set(Object.keys(CH.rollLoot('ender', 0, 1, 1, 1, 5)).map(Number))
  out.enderHasStar = enderIds.has(C.I.NETHER_STAR)
  out.woodHasStar = woodIds.has(C.I.NETHER_STAR)

  /* ---- F 存档往返 ---- */
  CH.clearContainers()
  CH.openChest(0, 1, 2, 3, woodId, 111)
  CH.writeChest(0, 1, 2, 3, { 200: 5, [C.I.DIAMOND]: 2 })
  CH.openChest(2, 7, 8, 9, CH.CHEST_OF_BLOCK.ender, 222)
  const snap = CH.chestSnapshot()
  CH.clearContainers()
  CH.chestRestore(snap)
  const after = CH.chestSnapshot()
  out.roundTrip = JSON.stringify(snap) === JSON.stringify(after)
  out.snapLen = snap.length
  /* 抗手改：伪造的种类键 / 不存在的物品 id / 负数量都要被挡掉 */
  CH.clearContainers()
  CH.chestRestore([
    ['0:1,1,1', 'not_a_type', { 200: 1 }],       // 种类键不存在
    ['0:2,2,2', 'wood', { 999999: 5 }],          // id 既不是物品也不是方块
    ['0:3,3,3', 'wood', { 200: -5 }],            // 负数量
    ['0:4,4,4', 'wood', { 200: 99999999 }],      // 数量封顶
    ['0:5,5,5', 'wood', { 200: 2 }],              // 合法（物品）
    ['0:6,6,6', 'wood', { 4: 3 }],               // 合法（方块 id）
  ])
  const afterBad = CH.chestSnapshot()
  out.badRestoreLen = afterBad.length
  out.badRestoreKeys = afterBad.map((r) => r[0])
  out.badRestoreItems = afterBad.map((r) => r[2])
  /* 无条件恢复：undefined 要清空而不是报错 */
  CH.clearContainers()
  CH.chestRestore(undefined)
  out.restoreUndefinedOk = CH.containerCount() === 0

  return out
}, MODS)

group('A 方块与物品登记')
ok('4 种箱子方块', R.blocks.length === 4, R.blocks.map((b) => b.id))
ok('方块 id 连续且都是合法方块', R.blocks.every((b) => b.id > 0 && b.id < 200))
ok('每个箱子方块带 chest 标记', R.blocks.every((b) => b.chestFlag && b.chestFlag === b.key), R.blocks)
ok('箱子名与 CHEST_TYPES 的 block 字段一致', R.blocks.every((b) => R.typeNames.includes(b.key)))
ok('4 种箱子容量递增 9/18/27/36', JSON.stringify(R.slots) === JSON.stringify({ wood: 9, iron: 18, gold: 27, ender: 36 }), R.slots)
ok('箱子硬度递增', R.hards.wood < R.hards.iron && R.hards.iron < R.hards.gold && R.hards.gold < R.hards.ender, R.hards)
ok('4 种稀有物品已登记', Object.values(R.items).every(Boolean), R.items)

group('B 贴图登记')
/* ⚠ 正则必须排除盔甲的 item_chest_* —— 铁甲 / 钻石甲 / 星陨甲的贴图
   也叫 item_chest_iron / item_chest_diamond / item_chest_starfall。
   只匹配 item_chest_ 会把盔甲贴图一起数进来（曾误报 9 张而不是 8 张）。 */
ok('8 张箱子贴图', R.tiles.length === 8, R.tiles)
ok('贴图名不含盔甲的 item_chest_*', R.tiles.every((n) => n.startsWith('chest_')), R.tiles)
ok('4 张物品图标', R.itemTiles.every((t) => t.has), R.itemTiles)
ok('贴图总数未超 256', R.tileTotal <= 256, R.tileTotal)

group('C 配方')
ok('4 条箱子配方', R.recipes.length === 4, R.recipes)
ok('配方字符全部有效', R.recipeCharsOk)
ok('木箱配方用 8 木板', R.recipes.some((r) => r.out && r.grid.join('|').includes('P')))

group('D 容器状态机')
ok('首次打开生成内容', R.openA && R.openA.kinds > 0, R.openA)
ok('重复打开内容不变（幂等）', R.sameContent)
ok('不同维度互不干扰', R.dimIsolated)
ok('非箱子方块打不开', R.openNonChest)
ok('写回内容生效', R.writeBack)
ok('拆箱取回内容', R.taken && Object.keys(R.taken).length > 0, R.taken)
ok('拆箱后容器记录被删除', R.takenThenGone)

group('E 战利品')
ok('每种箱子都有战利品', Object.values(R.loot).every((l) => l.kinds > 0), R.loot)
ok('战利品 id 全部合法', Object.values(R.loot).every((l) => l.bad.length === 0), R.loot)
ok('战利品数量有上限', Object.values(R.loot).every((l) => l.max <= 64), R.loot)
ok('同种子结果确定', R.deterministic)
ok('不同坐标内容不同', R.varied)
ok('末影箱能出下界之星', R.enderHasStar)
ok('木箱出不了下界之星', !R.woodHasStar)
/* 方块也能进箱子（圆石、木板…）—— 只认 ITEMS 的话方块类战利品全被过滤掉，
   木箱里会只剩几件物品。单次 roll 只有 3~8 格，一种方块是正常的；
   所以用 24 个不同坐标统计**总种类数**，这才测得出「方块真的会出」。 */
ok('战利品里有方块（不全是物品）', R.loot.wood.hasBlock, R.loot.wood)
ok('多种子下方块战利品至少 5 种', R.loot.wood.blockKindsTotal >= 5, R.loot.wood)

group('F 存档往返')
ok('snapshot → restore 无损', R.roundTrip, { snapLen: R.snapLen })
ok('存了 2 只箱子', R.snapLen === 2, R.snapLen)
ok('伪造数据被挡掉（3 条合法全保留）', R.badRestoreLen === 3, R.badRestoreKeys)
ok('方块 id 也能入箱', R.badRestoreItems.some((it) => it['4'] === 3), R.badRestoreItems)
ok('非法条目全部被剔除', R.badRestoreItems.every((it) => Object.keys(it).every((k) => k === '200' || k === '4')), R.badRestoreItems)
ok('手改超大量被封顶', R.badRestoreItems.some((it) => (it['200'] | 0) > 1 && (it['200'] | 0) <= 9999), R.badRestoreItems)
ok('restore(undefined) 清空而非报错', R.restoreUndefinedOk)

group('G 交互')
const G = await page.evaluate(async (MODS) => {
  const C = await import(MODS.config)
  const A = await import(MODS.actions)
  const CH = await import(MODS.chests)
  const out = {}
  out.isChest = CH.isChestBlock(C.I.BOX_WOOD) && CH.isChestBlock(C.I.BOX_ENDER)
  out.notChest = !CH.isChestBlock(C.I.STONE) && !CH.isChestBlock(0)
  out.hookExists = typeof A.tryOpenChest === 'function'
  /* 装上钩子后，raycast 命中箱子应触发回调 */
  let hitId = null
  A.setOpenChestHook((h) => { hitId = h.id })
  out.hookInstalled = true
  return out
}, MODS)
ok('isChestBlock 认得 4 种箱子', G.isChest)
ok('isChestBlock 不误判普通方块', G.notChest)
ok('tryOpenChest 已导出', G.hookExists)

/* 页面里真实点一次箱子 */
group('H 实机交互')
const H = await page.evaluate(async (MODS) => {
  const C = await import(MODS.config)
  const CH = await import(MODS.chests)
  const S = await import(MODS.state)
  const G = await import(MODS.generate)
  const P = await import(MODS.player)
  const out = {}
  /* 在玩家脚下放一只木箱，然后开它 */
  const x = Math.floor(P.player.x) + 2
  const y = Math.floor(P.player.y)
  const z = Math.floor(P.player.z)
  G.setBlock(x, y, z, C.I.BOX_WOOD)
  const view = CH.openChest(S.dim, x, y, z, C.I.BOX_WOOD, 42)
  out.view = view && { type: view.type, slots: view.slots, kinds: Object.keys(view.items).length }
  /* 存档字段存在 */
  const SV = await import(MODS.save)
  const snap = SV.snapshot()
  out.snapHasChests = Array.isArray(snap.chests)
  /* 面板 DOM 存在 */
  out.panelExists = !!document.querySelector('.chest')
  return out
}, MODS)
ok('能打开箱子并拿到内容', H.view && H.view.kinds > 0, H.view)
ok('存档快照含 chests 字段', H.snapHasChests)
ok('箱子面板已挂载', H.panelExists)

/* 打开面板 → 点一次 → 物品应进背包 */
group('I 面板与取放')
const I = await page.evaluate(async (MODS) => {
  const C = await import(MODS.config)
  const CH = await import(MODS.chests)
  const S = await import(MODS.state)
  const G = await import(MODS.generate)
  const P = await import(MODS.player)
  const SV = await import(MODS.survival)
  const UA = await import(MODS.uiActions)
  const UI = await import(MODS.uiState)
  const out = {}
  const BREAD = C.I.BREAD
  out.BREAD = BREAD
  const x = Math.floor(P.player.x) + 3
  const y = Math.floor(P.player.y)
  const z = Math.floor(P.player.z)
  G.setBlock(x, y, z, C.I.BOX_WOOD)
  /* 造一箱已知内容 */
  CH.openChest(S.dim, x, y, z, C.I.BOX_WOOD, 42)
  CH.writeChest(S.dim, x, y, z, { [BREAD]: 7 })
  /* 开面板 */
  const opened = UA.openChest({ x, y, z, id: C.I.BOX_WOOD })
  out.opened = opened
  /* 取出 */
  const before = SV.invCount(BREAD)
  const took = UA.chestTake(BREAD)
  out.took = took
  out.invBefore = before
  out.invAfter = SV.invCount(BREAD)
  out.chestAfter = { ...UI.ui.chestItems }
  /* 存回去 —— chestPut 对应 UI 单次点击，一次只放 1 个，放 7 次 */
  let put = true
  for (let i = 0; i < 7; i++) if (!UA.chestPut(BREAD)) put = false
  out.put = put
  out.invAfterPut = SV.invCount(BREAD)
  out.chestAfterPut = { ...UI.ui.chestItems }
  /* 容量上限：塞满应被拒 */
  const cap = UA.chestCapacity()
  out.cap = cap
  UA.closeChest(true)
  return out
}, MODS)
ok('openChest 成功', I.opened === true)
ok('取出后背包数量增加', I.invAfter === I.invBefore + 7, { before: I.invBefore, after: I.invAfter })
ok('取出后箱子清空该项', I.chestAfter[I.BREAD] === undefined, I.chestAfter)
ok('放回后背包减少', I.invAfterPut === I.invBefore, I.invAfterPut)
ok('放回后箱子恢复', I.chestAfterPut[I.BREAD] === 7, I.chestAfterPut)
ok('chestCapacity 返回 9', I.cap === 9, I.cap)

console.log('\n=== 控制台 ===')
ok('零控制台错误', errs.length === 0, errs.slice(0, 3))

console.log('\n' + '='.repeat(46))
console.log(`结果：${pass} 通过 / ${fail} 失败`)
if (fails.length) { console.log('失败项：'); fails.forEach((f) => console.log('  · ' + f)) }
await browser.close()
process.exit(fail ? 1 : 0)
