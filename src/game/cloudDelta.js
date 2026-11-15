/* 存档增量计算：纯函数、无重依赖，便于在 node 里单测（不碰 textures.js 的 DOM）。

 * 输入是「按维度分表的 edits Map 数组」：current[d] 是当前内存状态，
 * last[d] 是上次成功推到云端的状态（null 表示云端还没有基线）。
 * 每个 Map 的键是 save.js 的 EKEY 格式 "x,y,z"，值是方块 id；id=0 表示挖空（空气），
 * 仍然是有意义的改动，必须照常计入 added。 */

export function parseEditKey(k) {
  const p = k.split(',')
  return { x: +p[0], y: +p[1], z: +p[2] }
}

/* 返回 { added: [{dim,x,y,z,id}], removed: [{dim,x,y,z}] }。
 * - current 里有、last 里没有或 id 不同 → added
 * - last 里有、current 里没有（被 setBlock 判回地形基准而 edits.delete）→ removed
 * 注意 id 用严格不等比较：`0` 挖空 vs 非 0 方块算不同，会触发 added。 */
export function buildEditDelta(current, last) {
  const added = []
  const removed = []
  const dims = Math.max(current ? current.length : 0, last ? last.length : 0)
  for (let d = 0; d < dims; d++) {
    const cur = (current && current[d]) || null
    const prev = (last && last[d]) || null
    if (cur) {
      for (const [k, id] of cur) {
        if (!(prev && prev.get(k) === id)) {
          const { x, y, z } = parseEditKey(k)
          added.push({ dim: d, x, y, z, id })
        }
      }
    }
    if (prev) {
      for (const [k] of prev) {
        if (!cur || !cur.has(k)) {
          const { x, y, z } = parseEditKey(k)
          removed.push({ dim: d, x, y, z })
        }
      }
    }
  }
  return { added, removed }
}
