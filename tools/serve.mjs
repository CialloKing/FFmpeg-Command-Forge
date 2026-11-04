import http from 'node:http';
import { readFile } from 'node:fs/promises';
const server = http.createServer(async (_request, response) => {
  try { const html = await readFile('FFmpeg Command Forge.html'); response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }); response.end(html); }
  catch { response.writeHead(503); response.end('请先运行 npm run build'); }
});
server.listen(4173, '127.0.0.1', () => console.log('Local: http://127.0.0.1:4173'));
