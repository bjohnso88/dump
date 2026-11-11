// Serves Dump's files from the FILES KV namespace (key = path, e.g. "/app.js").
// Deployed as the "dump" Worker on dump.bixjohnson.com. See README for how to update.
const TYPES = {
  html: 'text/html; charset=utf-8', css: 'text/css; charset=utf-8',
  js: 'text/javascript; charset=utf-8', json: 'application/manifest+json', png: 'image/png',
};
export default {
  async fetch(req, env) {
    let path = new URL(req.url).pathname;
    if (path === '/') path = '/index.html';
    const body = await env.FILES.get(path, 'arrayBuffer');
    if (!body) return new Response('Not found', { status: 404 });
    const type = TYPES[path.split('.').pop()] || 'application/octet-stream';
    return new Response(body, { headers: { 'content-type': type, 'cache-control': 'no-cache' } });
  },
};
