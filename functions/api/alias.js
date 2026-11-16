/* Cloudflare Pages Functions：存档别名 ↔ 匿名 UUID 绑定。
 *
 * 别名是「好记的名字」，UUID 是真正的主键（saves / edits 都按 owner 存）。
 * 这里只维护映射，不碰存档内容 —— 解析到 owner 后，客户端仍走 /api/save。
 *
 * GET  /api/alias            -> { alias: <display>|null }   查当前 owner 的别名
 * GET  /api/alias?name=xxx   -> { owner: <uuid>|null }      按别名解析 owner（认领用）
 * PUT  /api/alias {name}     -> { ok, alias }                绑定 / 改名
 * DELETE /api/alias          -> { ok }                       解绑
 *
 * 所有写操作都带 x-owner 头；判重用归一化键，避免大小写变体各占一份。
 * 业务结果一律 200 + body 里的 ok/reason（含「没找到」「被占用」「格式不对」）：
 * 4xx 会被浏览器记成控制台资源错误，而验收脚本要求零报错；
 * 只有 D1 未绑定 / 数据库异常这类真故障才用 5xx。 */
import { normalizeAlias } from '../../src/game/aliasName.js'

function ownerOf(request) {
  return request.headers.get('x-owner') || 'anon'
}

export async function onRequestGet(context) {
  const { request, env } = context
  const db = env.DB
  if (!db) return Response.json({ error: 'D1 not bound' }, { status: 500 })

  const url = new URL(request.url)
  const name = url.searchParams.get('name')
  if (name != null) {
    const norm = normalizeAlias(name)
    if (!norm) return Response.json({ owner: null })
    const row = await db.prepare('SELECT owner FROM aliases WHERE alias=?').bind(norm).first()
    return Response.json({ owner: row ? row.owner : null })
  }

  const row = await db.prepare('SELECT display FROM aliases WHERE owner=?').bind(ownerOf(request)).first()
  return Response.json({ alias: row ? row.display : null })
}

export async function onRequestPut(context) {
  const { request, env } = context
  const db = env.DB
  if (!db) return Response.json({ error: 'D1 not bound' }, { status: 500 })

  let b
  try { b = await request.json() } catch {
    return Response.json({ ok: false, reason: 'invalid' })
  }
  const display = String(b && b.name != null ? b.name : '').trim()
  const norm = normalizeAlias(display)
  if (!norm) return Response.json({ ok: false, reason: 'invalid' })

  const owner = ownerOf(request)
  const taken = await db.prepare('SELECT owner FROM aliases WHERE alias=?').bind(norm).first()
  if (taken && taken.owner !== owner) {
    return Response.json({ ok: false, reason: 'taken' })
  }

  /* 改名 = 先删该 owner 的旧绑定再插入。同一 batch 内顺序执行，
   * 既满足 owner UNIQUE，也不会把别人的绑定挤掉（上面已挡住）。 */
  try {
    await db.batch([
      db.prepare('DELETE FROM aliases WHERE owner=?').bind(owner),
      db.prepare(
        `INSERT INTO aliases(alias, owner, display, created_at) VALUES(?,?,?,?)
         ON CONFLICT(alias) DO UPDATE SET owner=excluded.owner, display=excluded.display`
      ).bind(norm, owner, display, Date.now()),
    ])
  } catch (err) {
    return Response.json({ ok: false, reason: 'db' }, { status: 500 })
  }
  return Response.json({ ok: true, alias: display })
}

export async function onRequestDelete(context) {
  const { request, env } = context
  const db = env.DB
  if (!db) return Response.json({ error: 'D1 not bound' }, { status: 500 })
  await db.prepare('DELETE FROM aliases WHERE owner=?').bind(ownerOf(request)).run()
  return Response.json({ ok: true })
}
