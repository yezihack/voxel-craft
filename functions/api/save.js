/* Cloudflare Pages Functions：存档读写后端。
 *
 * 浏览器不能直接连 D1（服务端绑定），所以这是唯一能碰 DB 的地方。
 * owner 取自 x-owner 头（匿名 UUID，由客户端生成并存 localStorage）。
 *
 * GET  /api/save        -> { save: <与 localStorage 同构的快照> }，无档 404
 * GET  /api/save?meta=1 -> { has, t, dim, mode, flat, blocks }，无档 404
 * PUT  /api/save         -> 增量写入（saves upsert + edits 逐格 upsert/delete），全部走 db.batch
 */

const SLOT = 0
const SAVE_VERSION = 1

function ownerOf(request) {
  return request.headers.get('x-owner') || 'anon'
}

/* 把 DB 行 + edits 行重组成客户端 applySave 能直接吃的快照。 */
function rowToSnapshot(row, editsRows) {
  const edits = []
  for (const e of editsRows) {
    if (!edits[e.dim]) edits[e.dim] = []
    edits[e.dim].push([`${e.x},${e.y},${e.z}`, e.id])
  }
  // 维度补齐成 DIM_N=8 个数组（空维度也是 [])
  for (let d = 0; d < 8; d++) if (!edits[d]) edits[d] = []
  return {
    v: row.v ?? SAVE_VERSION,
    t: row.updated_at,
    seed: row.seed,
    dim: row.dim,
    flat: !!row.flat,
    mode: row.mode,
    time: row.time,
    selected: row.selected,
    player: {
      x: row.px, y: row.py, z: row.pz,
      yaw: row.yaw, pitch: row.pitch,
      hp: row.hp, food: row.food, air: row.air,
      spawn: [row.spawn_x, row.spawn_y, row.spawn_z],
      fly: !!row.fly,
    },
    inv: JSON.parse(row.inv || '[]'),
    slots: JSON.parse(row.slots || '[]'),
    armor: JSON.parse(row.armor || 'null'),
    ench: JSON.parse(row.ench || 'null'),
    potions: JSON.parse(row.potions || 'null'),
    chests: JSON.parse(row.chests || 'null'),
    edits,
  }
}

export async function onRequestGet(context) {
  const { request, env } = context
  const owner = ownerOf(request)
  const db = env.DB
  if (!db) return new Response('D1 not bound', { status: 500 })

  const row = await db.prepare('SELECT * FROM saves WHERE owner=? AND slot=?').bind(owner, SLOT).first()
  if (!row) return new Response(null, { status: 404 })

  const url = new URL(request.url)
  if (url.searchParams.get('meta') === '1') {
    const c = await db.prepare('SELECT COUNT(*) AS c FROM edits WHERE owner=? AND slot=?').bind(owner, SLOT).first()
    return Response.json({
      has: true,
      t: row.updated_at,
      dim: row.dim,
      mode: row.mode,
      flat: !!row.flat,
      blocks: c ? c.c : 0,
    })
  }

  const editsRows = await db.prepare('SELECT dim,x,y,z,id FROM edits WHERE owner=? AND slot=?').bind(owner, SLOT).all()
  return Response.json({ save: rowToSnapshot(row, (editsRows && editsRows.results) || []) })
}

export async function onRequestPut(context) {
  const { request, env } = context
  const owner = ownerOf(request)
  const db = env.DB
  if (!db) return new Response('D1 not bound', { status: 500 })

  let b
  try { b = await request.json() } catch { return new Response('bad json', { status: 400 }) }
  if (!b || typeof b !== 'object') return new Response('bad body', { status: 400 })

  const now = Date.now()
  const p = b.player || {}
  const spawn = Array.isArray(p.spawn) ? p.spawn : [0, 0, 0]

  const queries = [
    db.prepare(
      `INSERT INTO saves(owner,slot,seed,dim,flat,mode,time,px,py,pz,yaw,pitch,hp,food,air,
        spawn_x,spawn_y,spawn_z,fly,selected,inv,slots,armor,ench,potions,chests,v,updated_at)
       VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT(owner,slot) DO UPDATE SET
         seed=excluded.seed, dim=excluded.dim, flat=excluded.flat, mode=excluded.mode, time=excluded.time,
         px=excluded.px, py=excluded.py, pz=excluded.pz, yaw=excluded.yaw, pitch=excluded.pitch,
         hp=excluded.hp, food=excluded.food, air=excluded.air,
         spawn_x=excluded.spawn_x, spawn_y=excluded.spawn_y, spawn_z=excluded.spawn_z,
         fly=excluded.fly, selected=excluded.selected,
         inv=excluded.inv, slots=excluded.slots, armor=excluded.armor, ench=excluded.ench,
         potions=excluded.potions, chests=excluded.chests, v=excluded.v, updated_at=excluded.updated_at`
    ).bind(
      owner, SLOT,
      b.seed ?? null, b.dim ?? null, b.flat ? 1 : 0, b.mode ?? null, b.time ?? null,
      p.x ?? null, p.y ?? null, p.z ?? null, p.yaw ?? null, p.pitch ?? null,
      p.hp ?? null, p.food ?? null, p.air ?? null,
      spawn[0] ?? null, spawn[1] ?? null, spawn[2] ?? null,
      p.fly ? 1 : 0, b.selected ?? 0,
      JSON.stringify(b.inv || []), JSON.stringify(b.slots || []),
      JSON.stringify(b.armor ?? null), JSON.stringify(b.ench ?? null),
      JSON.stringify(b.potions ?? null), JSON.stringify(b.chests ?? null),
      b.v ?? SAVE_VERSION, now
    ),
  ]

  const added = (b.edits && b.edits.added) || []
  const removed = (b.edits && b.edits.removed) || []
  for (const e of added) {
    if (e == null || e.dim == null || e.x == null || e.y == null || e.z == null) continue
    queries.push(
      db.prepare(
        `INSERT INTO edits(owner,slot,dim,x,y,z,id) VALUES(?,?,?,?,?,?,?)
         ON CONFLICT(owner,slot,dim,x,y,z) DO UPDATE SET id=excluded.id`
      ).bind(owner, SLOT, e.dim | 0, e.x | 0, e.y | 0, e.z | 0, e.id | 0)
    )
  }
  for (const e of removed) {
    if (e == null || e.dim == null || e.x == null || e.y == null || e.z == null) continue
    queries.push(
      db.prepare('DELETE FROM edits WHERE owner=? AND slot=? AND dim=? AND x=? AND y=? AND z=?')
        .bind(owner, SLOT, e.dim | 0, e.x | 0, e.y | 0, e.z | 0)
    )
  }

  try {
    await db.batch(queries)
  } catch (err) {
    return new Response('db error: ' + (err && err.message ? err.message : String(err)), { status: 500 })
  }
  return Response.json({ ok: true, updated_at: now, written: added.length, deleted: removed.length })
}

export async function onRequestDelete(context) {
  const { request, env } = context
  const owner = ownerOf(request)
  const db = env.DB
  if (!db) return new Response('D1 not bound', { status: 500 })
  try {
    await db.batch([
      db.prepare('DELETE FROM saves WHERE owner=? AND slot=?').bind(owner, SLOT),
      db.prepare('DELETE FROM edits WHERE owner=? AND slot=?').bind(owner, SLOT),
    ])
  } catch (err) {
    return new Response('db error: ' + (err && err.message ? err.message : String(err)), { status: 500 })
  }
  return Response.json({ ok: true })
}
