import { readFileSync } from 'node:fs'
const s = readFileSync('src/game/config.js', 'utf8')
// 数 BLOCKS 里的 name 出现次数（粗略）
const names = [...s.matchAll(/name:'(方块[^']*|土[^']*|石[^']*|沙[^']*|原木[^']*|树叶[^']*|木板[^']*|砖块[^']*|玻璃[^']*|水[^']*|雪块[^']*|黑曜石[^']*|萤石[^']*|南瓜[^']*|[^']*箱[^']*|附魔台[^']*)'/g)].map(m=>m[1])
console.log('候选方块名数(粗):', names.length)
