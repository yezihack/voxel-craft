/* 解析 .cpuprofile，输出「自耗时」排序（self time）。
 *
 * 用法：node .scratch/perf/parse.mjs <profile.cpuprofile>
 */
import { readFileSync } from 'node:fs'
const f = process.argv[2]
const p = JSON.parse(readFileSync(f, 'utf8'))
const byId = new Map(p.nodes.map(n => [n.id, n]))
const self = new Map()
const total = p.samples.length
/* hitCount 是这个节点被采样到的次数 */
for (const n of p.nodes) self.set(n.id, n.hitCount || 0)
const rows = [...self.entries()]
  .filter(([, c]) => c > 0)
  .map(([id, c]) => {
    const n = byId.get(id)
    const cf = n.callFrame
    return { name: cf.functionName || '(anon)', url: (cf.url || '').split('/').slice(-1)[0],
             line: cf.lineNumber, c }
  })
  .sort((a, b) => b.c - a.c)
console.log(`采样点总数 ${total}`)
console.log('self%  samples  函数')
for (const r of rows.slice(0, 28)) {
  const pct = (r.c / total * 100).toFixed(1)
  console.log(`${pct.padStart(5)}%  ${String(r.c).padStart(6)}  ${r.name}  (${r.url}:${r.line})`)
}
