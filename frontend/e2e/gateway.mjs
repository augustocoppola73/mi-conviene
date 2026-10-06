import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
const DIST = process.argv[2];
const secret = 'e2e-secret-e2e-secret-e2e-secret-e2e-secret';
const types = { '.js': 'application/javascript', '.html': 'text/html', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json', '.ttf': 'font/ttf' };
http.createServer((req, res) => {
  if (req.url.startsWith('/rest/v1/')) {
    const opts = { host: 'localhost', port: 3099, path: req.url.slice(8), method: req.method, headers: { ...req.headers, host: 'localhost:3099' } };
    const p = http.request(opts, (r) => { res.writeHead(r.statusCode, { ...r.headers, 'access-control-allow-origin': '*' }); r.pipe(res); });
    req.pipe(p);
    return;
  }
  if (req.url.startsWith('/auth/v1/')) {
    const tok = (req.headers.authorization || '').split(' ')[1] || '';
    let claims = {};
    try { claims = JSON.parse(Buffer.from(tok.split('.')[1], 'base64url').toString()); } catch {}
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(req.url.startsWith('/auth/v1/user') ? { id: claims.sub, email: claims.email, aud: 'authenticated', role: 'authenticated' } : {}));
    return;
  }
  let f = path.join(DIST, decodeURIComponent(req.url.split('?')[0]));
  if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) f = path.join(DIST, 'index.html');
  res.writeHead(200, { 'content-type': types[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(res);
}).listen(8790);
