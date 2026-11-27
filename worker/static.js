// The app's files, bundled into the Worker (see "rules" in wrangler.jsonc).
// Served from here rather than Workers Static Assets: no separate asset upload step.
import indexHtml from '../public/index.html';
import appJs from '../public/app.js';
import styleCss from '../public/style.css';
import swJs from '../public/sw.js';
import manifest from '../public/manifest.json';
import icon192 from '../public/icon-192.png';
import icon512 from '../public/icon-512.png';
import touchIcon from '../public/apple-touch-icon.png';

const FILES = {
  '/': [indexHtml, 'text/html; charset=utf-8'],
  '/index.html': [indexHtml, 'text/html; charset=utf-8'],
  '/app.js': [appJs, 'text/javascript; charset=utf-8'],
  '/style.css': [styleCss, 'text/css; charset=utf-8'],
  '/sw.js': [swJs, 'text/javascript; charset=utf-8'],
  '/manifest.json': [manifest, 'application/manifest+json'],
  '/icon-192.png': [icon192, 'image/png'],
  '/icon-512.png': [icon512, 'image/png'],
  '/apple-touch-icon.png': [touchIcon, 'image/png'],
};

export function serveStatic(url) {
  const f = FILES[url.pathname];
  if (!f) return new Response('Not found', { status: 404 });
  return new Response(f[0], { headers: { 'content-type': f[1], 'cache-control': 'no-cache' } });
}
