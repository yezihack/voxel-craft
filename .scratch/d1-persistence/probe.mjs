/* D1 增量存档：buildEditDelta 纯函数单测。
 * 不 import 重图（避开 textures.js 的 document.createElement 在 node 崩溃），
 * 只验「相对上次云端基线，哪些格要 added / removed」。
 * 运行：node .scratch/d1-persistence/probe.mjs */
import { buildEditDelta } from '../../src/game/cloudDelta.js'

let pass = 0, fail = 0
function ok(name, cond) {
  if (cond) { pass++; console.log('  ok  -', name) }
  else { fail++; console.log('  FAIL-', name) }
}
const M = (o) => new Map(Object.entries(o))               // {"x,y,z": id}
const arr = (...ms) => { const a = []; for (let i = 0; i < 8; i++) a.push(ms[i] || new Map()); return a }

// 1. 首次推送（基线 null）：全部当前 edits 都是 added
{
  const cur = arr(M({ '1,2,3': 5, '4,5,6': 0 }))          // dim0 两格，其中 id=0（挖空）也有意义
  const d = buildEditDelta(cur, null)
  ok('基线 null → 两格都 added', d.added.length === 2 && d.removed.length === 0)
  ok('挖空 id=0 也算 added', d.added.some(e => e.x === 4 && e.y === 5 && e.z === 6 && e.id === 0))
}

// 2. 无变化：增量空
{
  const cur = arr(M({ '1,2,3': 5 }))
  const last = arr(M({ '1,2,3': 5 }))
  const d = buildEditDelta(cur, last)
  ok('无变化 → added/removed 都空', d.added.length === 0 && d.removed.length === 0)
}

// 3. 新放一格 → added
{
  const cur = arr(M({ '1,2,3': 5, '7,8,9': 12 }))
  const last = arr(M({ '1,2,3': 5 }))
  const d = buildEditDelta(cur, last)
  ok('新增格 → added', d.added.length === 1 && d.added[0].x === 7 && d.added[0].id === 12 && d.removed.length === 0)
}

// 4. 改 id → added（带新值）
{
  const cur = arr(M({ '1,2,3': 9 }))
  const last = arr(M({ '1,2,3': 5 }))
  const d = buildEditDelta(cur, last)
  ok('改 id → added 新值', d.added.length === 1 && d.added[0].id === 9 && d.removed.length === 0)
}

// 5. 挖空（setBlock 把 key 从 Map 删掉）→ removed
{
  const cur = arr(M({}))                                  // 这格回到地形基准，被 edits.delete
  const last = arr(M({ '1,2,3': 5 }))
  const d = buildEditDelta(cur, last)
  ok('回到地形基准 → removed', d.removed.length === 1 && d.removed[0].x === 1 && d.removed[0].y === 2 && d.removed[0].z === 3 && d.added.length === 0)
}

// 6. id=0 挖空 → 非 0 方块：视为改动，added 出新值
{
  const cur = arr(M({ '1,2,3': 7 }))
  const last = arr(M({ '1,2,3': 0 }))                     // 上一基线这格是挖空
  const d = buildEditDelta(cur, last)
  ok('0→非0 → added 新值', d.added.length === 1 && d.added[0].id === 7)
}

// 7. 多维度：dim2 的改动只在 dim2
{
  const cur = arr(new Map(), new Map(), M({ '10,11,12': 3 }))
  const last = arr(new Map(), new Map(), new Map())
  const d = buildEditDelta(cur, last)
  ok('跨维度：dim2 added 且 dim 正确', d.added.length === 1 && d.added[0].dim === 2 && d.added[0].x === 10)
}

console.log(`\n${fail === 0 ? 'ALL PASS' : 'HAS FAIL'}  ${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
