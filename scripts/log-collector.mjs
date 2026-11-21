import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';

const PORT = 17321;
const LOG_DIR = path.resolve(process.cwd(), 'logs');
const LOG_FILE = path.join(LOG_DIR, 'runtime.log');

fs.mkdirSync(LOG_DIR, { recursive: true });

const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, logFile: LOG_FILE }));
    return;
  }

  if (req.method === 'POST' && req.url === '/log') {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk.toString();
      if (body.length > 64 * 1024) req.destroy();
    });
    req.on('end', () => {
      try {
        const entry = JSON.parse(body);
        const line = `[${entry.ts || new Date().toISOString()}] [${String(entry.level || 'info').toUpperCase()}] [${entry.source || 'ext'}] ${entry.message || ''}${entry.url ? ` | url=${entry.url}` : ''}${entry.detail ? `\n  detail: ${entry.detail}` : ''}\n`;
        fs.appendFileSync(LOG_FILE, line, 'utf8');
        process.stdout.write(line);
      } catch {
        // Ignore malformed payload
      }
      res.writeHead(204);
      res.end();
    });
    return;
  }

  res.writeHead(404);
  res.end();
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[OpenDual Log Collector] Listening on http://127.0.0.1:${PORT}/log`);
  console.log(`[OpenDual Log Collector] Writing logs to ${LOG_FILE}`);
});
