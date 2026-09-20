/**
 * 上海如静知华信息科技有限公司 https://www.zhuatech.cn/
 * 商业授权或定制开发请微信添加微信号zhuatech或zhuatech2进行咨询。
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SignageService, createDemoService } from './domain.js';

const dirname = path.dirname(fileURLToPath(import.meta.url));
const dataFile = path.resolve(process.env.SIGNAGE_DATA_FILE || './data/signage.json');
const apiKey = process.env.SIGNAGE_API_KEY || 'zhuatech-demo-key';
const port = Number(process.env.PORT || 18081);

function loadService() {
  try { return new SignageService(JSON.parse(fs.readFileSync(dataFile, 'utf8'))); } catch { return createDemoService(); }
}
const service = loadService();
const persist = () => { fs.mkdirSync(path.dirname(dataFile), { recursive: true }); fs.writeFileSync(dataFile, JSON.stringify(service.dump(), null, 2)); };
persist();

const send = (res, status, body, type = 'application/json; charset=utf-8') => {
  res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store' });
  res.end(type.startsWith('application/json') ? JSON.stringify(body) : body);
};
const parseBody = async (req) => {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
};

const staticFiles = {
  '/': ['console.html', 'text/html; charset=utf-8'], '/console': ['console.html', 'text/html; charset=utf-8'],
  '/player': ['player.html', 'text/html; charset=utf-8'], '/styles.css': ['styles.css', 'text/css; charset=utf-8']
};

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  try {
    if (url.pathname === '/favicon.ico') { res.writeHead(204); return res.end(); }
    if (staticFiles[url.pathname]) {
      const [name, type] = staticFiles[url.pathname];
      return send(res, 200, fs.readFileSync(path.join(dirname, '..', 'public', name), 'utf8'), type);
    }
    if (url.pathname === '/health') return send(res, 200, { status: 'UP', service: 'zhuatech-signage' });
    if (!url.pathname.startsWith('/api/')) return send(res, 404, { error: 'NOT_FOUND' });
    if (req.headers['x-api-key'] !== apiKey && req.headers['x-device-token'] === undefined) return send(res, 401, { error: 'UNAUTHORIZED' });

    if (req.method === 'GET' && url.pathname === '/api/dashboard') return send(res, 200, service.dashboard());
    if (req.method === 'POST' && url.pathname === '/api/screens') {
      const result = service.enrollScreen(await parseBody(req), req.headers['x-actor'] || 'admin'); persist(); return send(res, 201, result);
    }
    if (req.method === 'POST' && url.pathname === '/api/assets') {
      const result = service.registerAsset(await parseBody(req), req.headers['x-actor'] || 'editor'); persist(); return send(res, 201, result);
    }
    if (req.method === 'POST' && url.pathname === '/api/playlists') {
      const result = service.createPlaylist(await parseBody(req), req.headers['x-actor'] || 'editor'); persist(); return send(res, 201, result);
    }
    if (req.method === 'POST' && url.pathname === '/api/campaigns') {
      const result = service.publishCampaign(await parseBody(req), req.headers['x-actor'] || 'publisher', req.headers['idempotency-key'] || ''); persist(); return send(res, 201, result);
    }
    const heartbeat = url.pathname.match(/^\/api\/screens\/([^/]+)\/heartbeat$/);
    if (req.method === 'POST' && heartbeat) { const result = service.heartbeat(heartbeat[1], await parseBody(req)); persist(); return send(res, 200, result); }
    const manifest = url.pathname.match(/^\/api\/screens\/([^/]+)\/manifest$/);
    if (req.method === 'GET' && manifest) return send(res, 200, service.buildManifest(manifest[1]));
    const proof = url.pathname.match(/^\/api\/screens\/([^/]+)\/proofs$/);
    if (req.method === 'POST' && proof) { const result = service.reportProof(proof[1], await parseBody(req)); persist(); return send(res, 202, result); }
    return send(res, 404, { error: 'NOT_FOUND' });
  } catch (error) {
    return send(res, 400, { error: 'BUSINESS_ERROR', message: error.message });
  }
});

server.listen(port, () => console.log(`ZhuaTech Signage running at http://127.0.0.1:${port}`));
