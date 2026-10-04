/* Mogoba online ordering: static files for /order/ and /pos/.
 * Revalidation by ETag and Last-Modified, gzip for text types (compressed once per file
 * version and kept in a small cache), and no access outside the app's own folder. */

import { promises as fsp } from 'node:fs';
import { join, resolve, sep, extname } from 'node:path';
import { gzip } from 'node:zlib';
import { promisify } from 'node:util';

const gz = promisify(gzip);

export const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.map': 'application/json; charset=utf-8',
};

const TEXT = /^(text\/|application\/(json|manifest\+json)|image\/svg)/;
const cache = new Map();
const CACHE_MAX = 200;

/* Resolve a URL path inside root, or null when it is invalid, hidden or escapes the root. */
export function resolveInside(root, rel) {
  let p;
  try {
    p = decodeURIComponent(rel);
  } catch {
    return null;
  }
  if (p.includes('\0') || p.split('/').some((s) => s.startsWith('.') && s !== '')) return null;
  const abs = resolve(root, '.' + (p.startsWith('/') ? p : '/' + p));
  return abs === root || abs.startsWith(root + sep) ? abs : null;
}

/* Serve one file. Returns false when there is nothing to serve so the caller can 404. */
export async function serveFile(req, res, file, headers) {
  let st;
  try {
    st = await fsp.stat(file);
    if (st.isDirectory()) {
      file = join(file, 'index.html');
      st = await fsp.stat(file);
    }
  } catch {
    return false;
  }
  if (!st.isFile()) return false;

  const type = MIME[extname(file).toLowerCase()] || 'application/octet-stream';
  const zip = TEXT.test(type) && st.size > 1024 && /\bgzip\b/.test(req.headers['accept-encoding'] || '');
  const tag = 'W/"' + st.size.toString(16) + '-' + Math.floor(st.mtimeMs).toString(16) + (zip ? '-gz' : '') + '"';
  const lastMod = new Date(Math.floor(st.mtimeMs / 1000) * 1000).toUTCString();
  /* Pages and code revalidate every time so a deploy shows up at once (the register's
   * service worker keeps it offline-capable); photos and fonts can sit in cache a day. */
  const longLived = /^(image|font)\//.test(type);
  const h = Object.assign({}, headers, {
    'Content-Type': type,
    ETag: tag,
    'Last-Modified': lastMod,
    'Cache-Control': longLived ? 'public, max-age=86400' : 'no-cache',
    Vary: 'Accept-Encoding',
  });

  const inm = req.headers['if-none-match'];
  const ims = req.headers['if-modified-since'];
  const fresh = inm ? inm.split(/\s*,\s*/).includes(tag) : ims ? Date.parse(ims) >= Date.parse(lastMod) : false;
  if (fresh) {
    res.writeHead(304, h);
    res.end();
    return true;
  }

  let body;
  const key = file + '|' + tag;
  if (cache.has(key)) body = cache.get(key);
  else {
    body = await fsp.readFile(file);
    if (zip) body = await gz(body, { level: 6 });
    if (zip || st.size < 256 * 1024) {
      if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value);
      cache.set(key, body);
    }
  }
  if (zip) h['Content-Encoding'] = 'gzip';
  h['Content-Length'] = body.length;
  res.writeHead(200, h);
  res.end(req.method === 'HEAD' ? undefined : body);
  return true;
}
