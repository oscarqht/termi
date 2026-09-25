import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { exec as execCb } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';

let customFolderPicker = null;
import {
  listSessions,
  createSession,
  getSession,
  attachClient,
  detachClient,
  resizeSession,
  writeToSession,
  defaultCwd,
  killSession,
  ensureUploadDir,
  updateSessionTitle,
} from './sessionManager.js';
import {
  loadRecentCwds,
  addRecentCwd,
  removeRecentCwd,
} from './recentCwds.js';
import {
  loadSavedPrompts,
  saveSavedPrompts,
} from './promptsManager.js';
import {
  loadCustomScripts,
  saveCustomScripts,
  listExecutions,
  getExecution,
  startExecution,
  cancelExecution,
  dismissExecution,
} from './customScriptsManager.js';


// Cap a single uploaded file at 100MB.
const UPLOAD_MAX_BYTES = 100 * 1024 * 1024;

const STATIC_MIME_TYPES = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

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
const isProd = process.env.NODE_ENV === 'production';
const PORT = process.env.PORT ? Number(process.env.PORT) : (isProd ? 3200 : 3201);

const PING_INTERVAL_MS = 15_000;
const PONG_TIMEOUT_MS = 10_000;

const exec = promisify(execCb);

async function readJsonBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (chunks.length === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

// Strip directory separators and other filesystem-hostile characters, keeping
// the upload's basename only.
function sanitizeFilename(name) {
  const base = path.basename(name).trim();
  const cleaned = base.replace(/[\\/\0]/g, '_').replace(/^\.+/, '');
  return cleaned || 'upload';
}

// Avoid clobbering an existing file with the same name in this session's
// upload dir by suffixing with a short random id.
function uniqueDestPath(dir, name) {
  let dest = path.join(dir, name);
  if (!fs.existsSync(dest)) return dest;
  const ext = path.extname(name);
  const stem = name.slice(0, name.length - ext.length);
  do {
    dest = path.join(dir, `${stem}-${crypto.randomUUID().slice(0, 8)}${ext}`);
  } while (fs.existsSync(dest));
  return dest;
}

function streamRequestToFile(req, destPath, maxBytes) {
  return new Promise((resolve, reject) => {
    let received = 0;
    const out = fs.createWriteStream(destPath);
    req.on('data', (chunk) => {
      received += chunk.length;
      if (received > maxBytes) {
        const err = new Error('File too large');
        err.status = 413;
        req.destroy(err);
      }
    });
    req.on('error', (err) => {
      out.destroy();
      fs.unlink(destPath, () => {});
      reject(err.status ? err : Object.assign(new Error('Upload failed'), { status: 400 }));
    });
    out.on('error', (err) => reject(err));
    out.on('finish', resolve);
    req.pipe(out);
  });
}

async function handleApi(req, res, url) {
  if (req.method === 'GET' && url.pathname === '/api/sessions') {
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(listSessions()));
    return true;
  }

  if (req.method === 'GET' && /^\/api\/sessions\/[^/]+$/.test(url.pathname)) {
    const id = url.pathname.slice('/api/sessions/'.length);
    const session = getSession(id);
    if (!session) {
      res.statusCode = 404;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ error: 'Session not found' }));
      return true;
    }
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ id: session.id, cwd: session.cwd, cmd: session.cmd, title: session.title || '' }));
    return true;
  }

  if (req.method === 'PATCH' && /^\/api\/sessions\/[^/]+$/.test(url.pathname)) {
    const id = url.pathname.slice('/api/sessions/'.length);
    const session = getSession(id);
    if (!session) {
      res.statusCode = 404;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ error: 'Session not found' }));
      return true;
    }

    let body;
    try {
      body = await readJsonBody(req);
    } catch {
      res.statusCode = 400;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ error: 'Invalid JSON body' }));
      return true;
    }

    if (typeof body.title === 'string') {
      updateSessionTitle(id, body.title);
    }

    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ id: session.id, cwd: session.cwd, cmd: session.cmd, title: session.title || '' }));
    return true;
  }

  if (req.method === 'GET' && url.pathname === '/api/default-cwd') {
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ cwd: defaultCwd() }));
    return true;
  }

  if (req.method === 'GET' && url.pathname === '/api/recent-cwds') {
    const cwds = await loadRecentCwds();
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ cwds, defaultCwd: defaultCwd() }));
    return true;
  }

  if (req.method === 'POST' && url.pathname === '/api/recent-cwds') {
    let body;
    try {
      body = await readJsonBody(req);
    } catch {
      body = {};
    }
    const cwds = await addRecentCwd(body.cwd);
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ cwds }));
    return true;
  }

  if (req.method === 'DELETE' && url.pathname === '/api/recent-cwds') {
    let target = url.searchParams.get('cwd');
    if (!target) {
      try {
        const body = await readJsonBody(req);
        target = body?.cwd;
      } catch {}
    }
    const cwds = await removeRecentCwd(target);
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ cwds }));
    return true;
  }

  if (req.method === 'GET' && url.pathname === '/api/prompts') {
    const prompts = await loadSavedPrompts();
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(prompts));
    return true;
  }

  if (req.method === 'PUT' && url.pathname === '/api/prompts') {
    let body;
    try {
      body = await readJsonBody(req);
    } catch {
      res.statusCode = 400;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ error: 'Invalid JSON body' }));
      return true;
    }
    if (!Array.isArray(body)) {
      res.statusCode = 400;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ error: 'Payload must be an array of prompts' }));
      return true;
    }
    const saved = await saveSavedPrompts(body);
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(saved));
    return true;
  }

  if (req.method === 'GET' && url.pathname === '/api/custom-scripts/config') {
    const scripts = await loadCustomScripts();
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(scripts));
    return true;
  }

  if (req.method === 'PUT' && url.pathname === '/api/custom-scripts/config') {
    let body;
    try {
      body = await readJsonBody(req);
    } catch {
      res.statusCode = 400;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ error: 'Invalid JSON body' }));
      return true;
    }
    if (!Array.isArray(body)) {
      res.statusCode = 400;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ error: 'Payload must be an array of custom scripts' }));
      return true;
    }
    const saved = await saveCustomScripts(body);
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(saved));
    return true;
  }

  if (req.method === 'GET' && url.pathname === '/api/custom-scripts') {
    const executions = listExecutions();
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ success: true, executions }));
    return true;
  }

  if (req.method === 'POST' && url.pathname === '/api/custom-scripts') {
    let body;
    try {
      body = await readJsonBody(req);
    } catch {
      res.statusCode = 400;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ error: 'Invalid JSON body' }));
      return true;
    }

    const command = body.command;

    if (command === 'list') {
      const executions = listExecutions();
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ success: true, executions }));
      return true;
    }

    const executionId = body.executionId || body.execution_id;

    if (command === 'status') {
      const execution = getExecution(executionId);
      if (!execution) {
        res.statusCode = 404;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ error: 'Execution not found' }));
        return true;
      }
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ success: true, ...execution }));
      return true;
    }

    if (command === 'cancel') {
      const execution = cancelExecution(executionId, !!body.force);
      if (!execution) {
        res.statusCode = 404;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ error: 'Execution not found' }));
        return true;
      }
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ success: true, ...execution }));
      return true;
    }

    if (command === 'dismiss') {
      dismissExecution(executionId);
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ success: true }));
      return true;
    }

    if (command === 'start') {
      try {
        const execution = startExecution({
          cwd: body.cwd,
          scriptName: body.scriptName || body.script_name,
          scriptContent: body.scriptContent || body.script_content,
        });
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ success: true, ...execution }));
      } catch (err) {
        res.statusCode = 400;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ error: err.message }));
      }
      return true;
    }

    res.statusCode = 400;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: `Unknown command: ${command}` }));
    return true;
  }

  if (req.method === 'POST' && url.pathname === '/api/choose-folder') {
    res.setHeader('Content-Type', 'application/json');
    if (customFolderPicker) {
      try {
        const cwd = await customFolderPicker();
        if (cwd) await addRecentCwd(cwd);
        res.end(JSON.stringify({ cwd: cwd || null }));
      } catch (err) {
        res.end(JSON.stringify({ cwd: null, error: err.message }));
      }
      return true;
    }
    if (process.platform === 'darwin') {
      try {
        const { stdout } = await exec(
          `osascript -e 'POSIX path of (choose folder with prompt "Select working directory")'`,
        );
        const folder = stdout.trim().replace(/\/$/, '');
        if (folder) await addRecentCwd(folder);
        res.end(JSON.stringify({ cwd: folder }));
      } catch {
        // User dismissed the dialog without choosing a folder.
        res.end(JSON.stringify({ cwd: null }));
      }
      return true;
    } else if (process.platform === 'win32') {
      try {
        const psCmd = `powershell -NoProfile -Command "Add-Type -AssemblyName System.Windows.Forms; $f = New-Object System.Windows.Forms.FolderBrowserDialog; if ($f.ShowDialog() -eq 'OK') { $f.SelectedPath }"`;
        const { stdout } = await exec(psCmd);
        const folder = stdout.trim();
        if (folder) await addRecentCwd(folder);
        res.end(JSON.stringify({ cwd: folder || null }));
      } catch {
        res.end(JSON.stringify({ cwd: null }));
      }
      return true;
    } else {
      try {
        const { stdout } = await exec('zenity --file-selection --directory 2>/dev/null || kdialog --getexistingdirectory 2>/dev/null');
        const folder = stdout.trim();
        if (folder) await addRecentCwd(folder);
        res.end(JSON.stringify({ cwd: folder || null }));
      } catch {
        res.statusCode = 501;
        res.end(JSON.stringify({ error: 'Native folder picker is not supported on this platform' }));
      }
      return true;
    }
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
    const title = typeof body.title === 'string' ? body.title : '';
    const session = createSession({ cwd: resolvedCwd, cmd, title });
    await addRecentCwd(resolvedCwd);
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ id: session.id, cwd: session.cwd, cmd: session.cmd, title: session.title || '' }));
    return true;
  }

  if (req.method === 'POST' && /^\/api\/sessions\/[^/]+\/upload$/.test(url.pathname)) {
    const id = url.pathname.slice('/api/sessions/'.length, -'/upload'.length);
    const session = getSession(id);
    if (!session) {
      res.statusCode = 404;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ error: 'Session not found' }));
      return true;
    }

    const rawName = url.searchParams.get('name') || 'upload';
    const safeName = sanitizeFilename(rawName);
    const uploadDir = ensureUploadDir(session);
    const destPath = uniqueDestPath(uploadDir, safeName);

    try {
      await streamRequestToFile(req, destPath, UPLOAD_MAX_BYTES);
    } catch (err) {
      res.statusCode = err.status ?? 500;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ error: err.message }));
      return true;
    }

    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ path: destPath, name: path.basename(destPath) }));
    return true;
  }

  if (req.method === 'DELETE' && url.pathname.startsWith('/api/sessions/')) {
    const id = url.pathname.slice('/api/sessions/'.length);
    killSession(id);
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ success: true }));
    return true;
  }


  return false;
}

export async function startServer(options = {}) {
  const isProd = options.isProd !== undefined ? options.isProd : (process.env.NODE_ENV === 'production');
  const host = options.host || resolveHost();
  const defaultPort = isProd ? 3200 : 3201;
  const initialPort = options.port || (process.env.PORT ? Number(process.env.PORT) : defaultPort);
  const autoPort = options.autoPort !== false;
  if (options.chooseFolderHandler) {
    customFolderPicker = options.chooseFolderHandler;
  }

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
      const mimeType = STATIC_MIME_TYPES[path.extname(filePath)];
      if (mimeType) res.setHeader('Content-Type', mimeType);
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

      ws.on('error', (err) => {
        // Prevent unhandled error event from crashing the server
        console.warn('[termi] WebSocket client error:', err.message);
      });

      ws.on('message', (raw) => {
        let msg;
        try {
          msg = JSON.parse(raw.toString());
        } catch {
          return;
        }
        try {
          if (msg.type === 'input') {
            writeToSession(session, msg.data);
          } else if (msg.type === 'resize') {
            resizeSession(session, msg.cols, msg.rows);
          }
        } catch (err) {
          console.warn('[termi] Error handling message:', err.message);
        }
      });

      ws.on('close', () => {
        clearInterval(pingTimer);
        detachClient(session, ws);
      });
    });
  });

  return new Promise((resolve, reject) => {
    function tryListen(portToTry) {
      const onError = (err) => {
        server.removeListener('listening', onListening);
        if (err.code === 'EADDRINUSE' && autoPort && portToTry < initialPort + 20) {
          console.warn(`[termi] Port ${portToTry} in use, trying ${portToTry + 1}...`);
          tryListen(portToTry + 1);
        } else {
          server.removeListener('error', onError);
          reject(err);
        }
      };

      const onListening = () => {
        server.removeListener('error', onError);
        const actualPort = server.address().port;
        const url = `http://${host}:${actualPort}`;
        console.log(`termi listening on ${url}`);
        resolve({
          server,
          host,
          port: actualPort,
          url,
          close: () => new Promise((res) => server.close(res)),
        });
      };

      server.once('error', onError);
      server.once('listening', onListening);
      server.listen(portToTry, host);
    }

    tryListen(initialPort);
  });
}

export { resolveHost };

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) {
  startServer().catch((err) => {
    console.error('[termi] Failed to start server:', err);
    process.exit(1);
  });
}
