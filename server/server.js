/*
 * Noto server: phục vụ bản build tĩnh (dist/) và một "kho ghi chú trên máy chủ"
 * — thư mục markdown thật nằm trên Mac mini (NOTO_VAULT_DIR, mặc định /data/vault).
 *
 * Có kho trên máy chủ thì ghi chú không còn kẹt trong IndexedDB của một trình
 * duyệt: mọi máy (kể cả iPhone, nơi File System Access API không có) mở cùng
 * một kho, và dữ liệu nằm trong volume Docker để sao lưu như mọi app khác.
 *
 * API khớp 1-1 với StorageAdapter của client (src/core/types.ts).
 */
import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = process.env.NOTO_DIST_DIR || path.join(ROOT, 'dist');
const VAULT = process.env.NOTO_VAULT_DIR || '/data/vault';
const PORT = Number(process.env.PORT || 8080);
const MAX_BODY = 32 * 1024 * 1024; // một ghi chú markdown không bao giờ tới mức này
const MAX_FILE = 8 * 1024 * 1024; // file lớn hơn thế không phải ghi chú, bỏ qua khi tải kho

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.map': 'application/json; charset=utf-8',
};

/** Chặn thoát khỏi thư mục kho: chỉ nhận đường dẫn tương đối, không `..`, không ổ đĩa. */
function safeRelative(p) {
  if (typeof p !== 'string' || !p.trim()) throw new HttpError(400, 'invalid_path');
  const normalized = path.posix.normalize(p.replace(/\\/g, '/')).replace(/^\/+/, '');
  if (!normalized || normalized === '.' || normalized.startsWith('../') || normalized === '..') throw new HttpError(400, 'invalid_path');
  if (normalized.split('/').some((seg) => seg === '..' || seg === '' || seg === '.')) throw new HttpError(400, 'invalid_path');
  return normalized;
}

/** Đường dẫn tuyệt đối trong kho, có chốt chặn cuối: mọi thứ phải nằm trong VAULT. */
function abs(rel) {
  const full = path.resolve(VAULT, rel);
  if (full !== VAULT && !full.startsWith(VAULT + path.sep)) throw new HttpError(400, 'invalid_path');
  return full;
}

class HttpError extends Error {
  constructor(status, code) {
    super(code);
    this.status = status;
    this.code = code;
  }
}

async function readBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY) throw new HttpError(413, 'too_large');
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new HttpError(400, 'invalid_json');
  }
}

/** Toàn bộ kho: mọi file (không chỉ .md) và mọi thư mục, bỏ qua thư mục ẩn. */
async function loadVault() {
  const files = [];
  const folders = [];
  async function walk(rel) {
    const entries = await fs.readdir(abs(rel) || VAULT, { withFileTypes: true }).catch((err) => {
      if (err.code === 'ENOENT') return [];
      throw err;
    });
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      const child = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        folders.push(child);
        await walk(child);
      } else if (entry.isFile()) {
        const stat = await fs.stat(abs(child));
        // Kho là ghi chú văn bản: bỏ qua file quá lớn hoặc nhị phân (ảnh chép nhầm vào)
        // để một file lạ không làm hỏng cả lần tải kho.
        if (stat.size > MAX_FILE) continue;
        const buffer = await fs.readFile(abs(child));
        if (buffer.includes(0)) continue;
        files.push({ path: child, content: buffer.toString('utf8'), mtime: stat.mtimeMs });
      }
    }
  }
  await walk('');
  return { files, folders };
}

async function writeFileAt(rel, content, create) {
  const target = abs(rel);
  await fs.mkdir(path.dirname(target), { recursive: true });
  if (create) {
    try {
      await fs.writeFile(target, content, { encoding: 'utf8', flag: 'wx' });
      return;
    } catch (err) {
      if (err.code === 'EEXIST') throw new HttpError(409, 'exists');
      throw err;
    }
  }
  await fs.writeFile(target, content, 'utf8');
}

async function renamePath(oldRel, newRel) {
  const from = abs(oldRel);
  const to = abs(newRel);
  await fs.mkdir(path.dirname(to), { recursive: true });
  try {
    await fs.rename(from, to);
  } catch (err) {
    if (err.code === 'ENOENT') return; // giống các adapter khác: đổi tên thứ không có là no-op
    throw err;
  }
}

async function handleApi(req, res, url) {
  const route = `${req.method} ${url.pathname}`;
  if (route === 'GET /api/vault/ping') return json(res, 200, { ok: true });
  if (route === 'GET /api/vault') return json(res, 200, await loadVault());

  if (route === 'POST /api/vault/file') {
    const body = await readBody(req);
    const rel = safeRelative(body.path);
    await writeFileAt(rel, typeof body.content === 'string' ? body.content : '', body.create === true);
    return json(res, 200, { ok: true });
  }
  if (route === 'DELETE /api/vault/file') {
    const rel = safeRelative(url.searchParams.get('path'));
    await fs.rm(abs(rel), { force: true });
    return json(res, 200, { ok: true });
  }
  if (route === 'POST /api/vault/file/rename' || route === 'POST /api/vault/folder/rename') {
    const body = await readBody(req);
    await renamePath(safeRelative(body.oldPath), safeRelative(body.newPath));
    return json(res, 200, { ok: true });
  }
  if (route === 'POST /api/vault/folder') {
    const body = await readBody(req);
    await fs.mkdir(abs(safeRelative(body.path)), { recursive: true });
    return json(res, 200, { ok: true });
  }
  if (route === 'DELETE /api/vault/folder') {
    const rel = safeRelative(url.searchParams.get('path'));
    await fs.rm(abs(rel), { recursive: true, force: true });
    return json(res, 200, { ok: true });
  }
  throw new HttpError(404, 'not_found');
}

function json(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(body);
}

async function serveStatic(req, res, url) {
  let rel = decodeURIComponent(url.pathname).replace(/^\/+/, '');
  if (rel.includes('..')) rel = '';
  let file = rel ? path.join(DIST, rel) : path.join(DIST, 'index.html');
  let stat = await fs.stat(file).catch(() => null);
  // SPA: mọi đường dẫn không phải file thật đều trả index.html.
  if (!stat || stat.isDirectory()) {
    file = path.join(DIST, 'index.html');
    stat = await fs.stat(file).catch(() => null);
    if (!stat) return json(res, 404, { error: 'not_found' });
  }
  const ext = path.extname(file).toLowerCase();
  // Tên file trong assets/ có hash nên cache lâu; index.html luôn phải tươi.
  const cache = rel.startsWith('assets/') ? 'public, max-age=31536000, immutable' : 'no-store';
  res.writeHead(200, { 'content-type': MIME[ext] || 'application/octet-stream', 'content-length': stat.size, 'cache-control': cache });
  if (req.method === 'HEAD') return res.end();
  createReadStream(file).pipe(res);
}

const server = createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  (async () => {
    if (url.pathname === '/healthz') {
      res.writeHead(200, { 'content-type': 'text/plain' });
      return res.end('ok');
    }
    if (url.pathname.startsWith('/api/')) return await handleApi(req, res, url);
    if (req.method !== 'GET' && req.method !== 'HEAD') throw new HttpError(405, 'method_not_allowed');
    return await serveStatic(req, res, url);
  })().catch((error) => {
    const status = error instanceof HttpError ? error.status : 500;
    if (status === 500) console.error(error);
    if (!res.headersSent) json(res, status, { error: error.code || 'server_error' });
    else res.end();
  });
});

await fs.mkdir(VAULT, { recursive: true });
server.listen(PORT, () => console.log(`Noto server on :${PORT} — vault ${VAULT}, dist ${DIST}`));
