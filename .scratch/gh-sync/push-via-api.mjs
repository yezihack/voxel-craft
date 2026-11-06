/* GitHub 同步兜底：当本机代理拒绝 CONNECT github.com:443、git push 不可用时，
 * 走已连通的 api.github.com Git Database API 逐个重建提交，最后原子更新 main ref。
 *
 * 用法（在仓库根目录）：
 *   GH_TOKEN="$(gh auth token)" node .scratch/gh-sync/push-via-api.mjs
 *
 * 特性：
 * - 增量的。起点取远端 ref 的真实 SHA，只同步 remote..HEAD 这段。
 * - 保历史。每个本地提交重建为同 tree / 同 parent / 同 author / 同 committer /
 *   同 message 的提交；元数据完全一致时 SHA 应相同，脚本逐条打印是否一致。
 * - 幂等安全。只有最后一步 PATCH ref 会改变远端分支；中途失败只留下悬空对象，
 *   重跑即可。
 * - 二进制文件走 POST /git/blobs (base64)，文本直接内联到 tree 条目的 content。
 */
import { execFileSync } from 'node:child_process';

const REPO = 'yezihack/voxel-craft';
const API = 'https://api.github.com';
const TOKEN = process.env.GH_TOKEN;
const PROXY = process.env.https_proxy || process.env.HTTPS_PROXY || '';
if (!TOKEN) throw new Error('GH_TOKEN 未设置：GH_TOKEN="$(gh auth token)" node ...');

const git = (...args) => execFileSync('git', args, { maxBuffer: 64 * 1024 * 1024 });

function api(method, path, body) {
  const args = ['-sS'];
  if (PROXY) args.push('-x', PROXY);
  args.push(
    '-X', method,
    '-H', `Authorization: Bearer ${TOKEN}`,
    '-H', 'Accept: application/vnd.github+json',
    '-H', 'Content-Type: application/json',
    '-H', 'X-GitHub-Api-Version: 2022-11-28',
    `${API}${path}`,
  );
  let input;
  if (body !== undefined) {
    args.push('--data-binary', '@-');
    input = Buffer.from(JSON.stringify(body), 'utf8');
  }
  const out = execFileSync('curl', args, {
    input, maxBuffer: 32 * 1024 * 1024, timeout: 180000,
  }).toString('utf8');
  let json;
  try { json = JSON.parse(out); }
  catch { throw new Error(`${method} ${path} 非 JSON 响应: ${out.slice(0, 300)}`); }
  if (json.message && !json.sha && !(json.object && json.object.sha)) {
    throw new Error(`${method} ${path} 失败: ${json.message} ${JSON.stringify(json.errors || []).slice(0, 300)}`);
  }
  return json;
}

/* 从原始 commit 对象取 message / author / committer，比 git log --format 更精确，
 * 保证重建出的对象字节级一致（进而 SHA 一致）。 */
function parsePerson(line) {
  const m = line.match(/^(.*) <(.*)> (\d+) ([+-]\d{4})$/);
  if (!m) throw new Error(`无法解析身份行: ${line}`);
  const ts = Number(m[3]);
  const sign = m[4][0] === '-' ? -1 : 1;
  const off = sign * (Number(m[4].slice(1, 3)) * 3600 + Number(m[4].slice(3, 5)) * 60);
  const iso = new Date((ts + off) * 1000).toISOString().replace(/\.\d{3}Z$/, '');
  const tz = `${m[4].slice(0, 3)}:${m[4].slice(3)}`;
  return { name: m[1], email: m[2], date: `${iso}${tz}` };
}

function commitParts(c) {
  const raw = git('cat-file', 'commit', c).toString('utf8');
  const cut = raw.indexOf('\n\n');
  const header = raw.slice(0, cut);
  const message = raw.slice(cut + 2);
  const a = header.match(/^author (.*)$/m), b = header.match(/^committer (.*)$/m);
  if (!a || !b) throw new Error(`${c} 缺少 author/committer 行`);
  return { message, author: parsePerson(a[1]), committer: parsePerson(b[1]) };
}

function isText(buf) {
  if (buf.includes(0)) return false;
  try { new TextDecoder('utf-8', { fatal: true }).decode(buf); return true; }
  catch { return false; }
}

function entriesFor(c) {
  const changes = git('diff-tree', '--no-commit-id', '-r', '--no-renames', '--name-status', '-z', c)
    .toString('utf8').split('\0').filter(Boolean);
  const modes = new Map();
  for (const row of git('ls-tree', '-r', '-z', c).toString('utf8').split('\0').filter(Boolean)) {
    const tab = row.indexOf('\t');
    if (tab < 0) continue;
    modes.set(row.slice(tab + 1), row.slice(0, tab).split(' ')[0]);
  }
  const out = [];
  for (let i = 0; i + 1 < changes.length; i += 2) {
    const status = changes[i], path = changes[i + 1];
    const mode = modes.get(path) || '100644';
    if (status[0] === 'D') { out.push({ path, mode, type: 'blob', sha: null }); continue; }
    const buf = git('cat-file', 'blob', `${c}:${path}`);
    if (!isText(buf)) {
      const blob = api('POST', `/repos/${REPO}/git/blobs`, {
        content: buf.toString('base64'), encoding: 'base64',
      });
      out.push({ path, mode, type: 'blob', sha: blob.sha });
    } else {
      out.push({ path, mode, type: 'blob', content: buf.toString('utf8') });
    }
  }
  return out;
}

const ref = api('GET', `/repos/${REPO}/git/ref/heads/main`);
let parentSha = ref.object.sha;
const head = git('rev-parse', 'HEAD').toString().trim();
console.log(`远端 main ${parentSha.slice(0, 7)} / 本地 HEAD ${head.slice(0, 7)}`);
if (parentSha === head) { console.log('已同步，无需操作'); process.exit(0); }
try { git('merge-base', '--is-ancestor', parentSha, 'HEAD'); }
catch { throw new Error(`远端 ${parentSha} 不是本地 HEAD 的祖先，拒绝覆盖`); }

const commits = git('rev-list', '--reverse', `${parentSha}..HEAD`).toString().trim().split('\n').filter(Boolean);
console.log(`待同步 ${commits.length} 个提交`);
let baseTree = api('GET', `/repos/${REPO}/git/commits/${parentSha}`).tree.sha;

for (const c of commits) {
  const entries = entriesFor(c);
  const tree = api('POST', `/repos/${REPO}/git/trees`, { base_tree: baseTree, tree: entries });
  const { message, author, committer } = commitParts(c);
  const made = api('POST', `/repos/${REPO}/git/commits`, {
    message, tree: tree.sha, parents: [parentSha], author, committer,
  });
  console.log(`  ${c.slice(0, 7)} -> ${made.sha.slice(0, 7)} ${made.sha === c ? '=' : '!='} `
    + `(${entries.length} files) ${message.split('\n')[0].slice(0, 44)}`);
  parentSha = made.sha;
  baseTree = tree.sha;
}

const patched = api('PATCH', `/repos/${REPO}/git/refs/heads/main`, { sha: parentSha, force: false });
console.log(`远端 main 已更新 -> ${patched.object.sha}`);
if (parentSha === head) {
  git('update-ref', 'refs/remotes/origin/main', parentSha);
  console.log(`本地 origin/main 已对齐 ${parentSha}`);
} else {
  console.log('注意：重建 SHA 与本地 HEAD 不一致，请人工核对后再决定是否重置本地分支');
}
