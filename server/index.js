import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { exec as execCb } from 'node:child_process';
import { promisify } from 'node:util';
import { WebSocketServer } from 'ws';
import {
  listSessions,
  createSession,
  getSession,
  attachClient,
  detachClient,
  resizeSession,
  writeToSession,
  defaultCwd,
} from './sessionManager.js';

// Tailscale assigns addresses from the CGNAT range 100.64.0.0/10.
function isTailscaleIP(ip) {
  const [a, b] = ip.split('.').map(Number);
  return a === 100 && b >= 64 && b <= 127;
}

function resolveHost() {
  if (process.env.HOST) return process.env.HOST;
  for (const addrs of Object.values(os.networkInterfaces())) {
    for (const addr of addrs ?? []) {
      if (addr.family === 'IPv4' && !addr.internal && isTailscaleIP(addr.address)) {
        return addr.address;
      }
    }
  }
  console.warn('[termi] No Tailscale interface found; binding to 127.0.0.1 only.');
  return '127.0.0.1';
}

const HOST = resolveHost();
const PORT = process.env.PORT ? Number(process.env.PORT) : 3200;
const isProd = process.env.NODE_ENV === 'production';

const PING_INTERVAL_MS = 15_000;
const PONG_TIMEOUT_MS = 10_000;

const exec = promisify(execCb);

async function readJsonBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (chunks.length === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

async function handleApi(req, res, url) {
  if (req.method === 'GET' && url.pathname === '/api/sessions') {
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(listSessions()));
    return true;
  }

  if (req.method === 'GET' && url.pathname === '/api/default-cwd') {
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ cwd: defaultCwd() }));
    return true;
  }

  if (req.method === 'POST' && url.pathname === '/api/choose-folder') {
    res.setHeader('Content-Type', 'application/json');
    if (process.platform !== 'darwin') {
      res.statusCode = 501;
      res.end(JSON.stringify({ error: 'Native folder picker is only supported on macOS' }));
      return true;
    }
    try {
      const { stdout } = await exec(
        `osascript -e 'POSIX path of (choose folder with prompt "Select working directory")'`,
      );
      res.end(JSON.stringify({ cwd: stdout.trim().replace(/\/$/, '') }));
    } catch {
      // User dismissed the dialog without choosing a folder.
      res.end(JSON.stringify({ cwd: null }));
    }
    return true;
  }

  if (req.method === 'POST' && url.pathname === '/api/sessions') {
    let body;
    try {
      body = await readJsonBody(req);
    } catch {
      res.statusCode = 400;
      res.end(JSON.stringify({ error: 'Invalid JSON body' }));
      return true;
    }

    const requestedCwd = typeof body.cwd === 'string' && body.cwd.trim() ? body.cwd : defaultCwd();
    const resolvedCwd = path.resolve(requestedCwd.replace(/^~/, process.env.HOME ?? ''));

    let stat;
    try {
      stat = await fsp.stat(resolvedCwd);
    } catch {
      res.statusCode = 400;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ error: `Directory does not exist: ${resolvedCwd}` }));
      return true;
    }
    if (!stat.isDirectory()) {
      res.statusCode = 400;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ error: `Not a directory: ${resolvedCwd}` }));
      return true;
    }

    const cmd = typeof body.cmd === 'string' ? body.cmd : '';
    const session = createSession({ cwd: resolvedCwd, cmd });
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ id: session.id, cwd: session.cwd, cmd: session.cmd }));
    return true;
  }

  return false;
}

async function createServer() {
  let vite;

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);

    try {
      if (url.pathname.startsWith('/api/')) {
        const handled = await handleApi(req, res, url);
        if (handled) return;
        res.statusCode = 404;
        res.end('Not found');
        return;
      }
    } catch (err) {
      res.statusCode = 500;
      res.end(JSON.stringify({ error: err.message }));
      return;
    }

    if (!isProd) {
      vite.middlewares(req, res);
      return;
    }

    // Production: serve the built static assets, falling back to index.html
    // for client-side routes (/, /term).
    const distDir = path.resolve(import.meta.dirname, '..', 'dist');
    const filePath = path.join(distDir, url.pathname);
    if (url.pathname !== '/' && fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
      res.end(fs.readFileSync(filePath));
      return;
    }
    res.setHeader('Content-Type', 'text/html');
    res.end(fs.readFileSync(path.join(distDir, 'index.html')));
  });

  if (!isProd) {
    const { createServer: createViteServer } = await import('vite');
    // hmr.server attaches Vite's own HMR websocket listener to our http
    // server; it only reacts to its own upgrade requests, so it coexists
    // with the /ws/pty listener registered below.
    vite = await createViteServer({
      server: { middlewareMode: true, hmr: { server } },
      appType: 'spa',
    });
  }

  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (url.pathname !== '/ws/pty') {
      // Not ours: leave it for Vite's HMR upgrade listener (dev) or drop it (prod).
      if (isProd) socket.destroy();
      return;
    }

    const sessionId = url.searchParams.get('session');
    const session = sessionId && getSession(sessionId);
    if (!session) {
      socket.destroy();
      return;
    }

    wss.handleUpgrade(req, socket, head, (ws) => {
      attachClient(session, ws);

      let alive = true;
      ws.on('pong', () => {
        alive = true;
      });
      const pingTimer = setInterval(() => {
        if (!alive) {
          ws.terminate();
          return;
        }
        alive = false;
        ws.ping();
      }, PING_INTERVAL_MS);

      ws.on('message', (raw) => {
        let msg;
        try {
          msg = JSON.parse(raw.toString());
        } catch {
          return;
        }
        if (msg.type === 'input') {
          writeToSession(session, msg.data);
        } else if (msg.type === 'resize') {
          resizeSession(session, msg.cols, msg.rows);
        }
      });

      ws.on('close', () => {
        clearInterval(pingTimer);
        detachClient(session, ws);
      });
    });
  });

  server.listen(PORT, HOST, () => {
    console.log(`termi listening on http://${HOST}:${PORT}`);
  });
}

createServer();
