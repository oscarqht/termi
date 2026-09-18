import pty from 'node-pty';
import crypto from 'node:crypto';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';

// Cap on buffered output kept per session for replay to a reconnecting client.
const BUFFER_MAX_CHARS = 500_000;

const sessions = new Map();

function shell() {
  return process.env.SHELL || '/bin/zsh';
}

export function listSessions() {
  return [...sessions.values()].map((s) => ({
    id: s.id,
    cwd: s.cwd,
    cmd: s.cmd,
    title: s.title || '',
    createdAt: s.createdAt,
    connected: s.clients.size > 0,
  }));
}

export function createSession({ cwd, cmd, title }) {
  const id = crypto.randomUUID();
  const term = pty.spawn(shell(), ['-l'], {
    name: 'xterm-256color',
    cols: 80,
    rows: 24,
    cwd,
    env: process.env,
  });

  const session = {
    id,
    cwd,
    cmd,
    title: typeof title === 'string' ? title.trim() : '',
    createdAt: Date.now(),
    pty: term,
    buffer: '',
    clients: new Set(),
    uploadDir: path.join(os.tmpdir(), 'termi-uploads', id),
    exited: false,
  };

  term.on('error', (err) => {
    console.warn(`[termi] pty error on session ${id}:`, err);
  });

  term.onData((data) => {
    session.buffer += data;
    if (session.buffer.length > BUFFER_MAX_CHARS) {
      session.buffer = session.buffer.slice(session.buffer.length - BUFFER_MAX_CHARS);
    }
    for (const client of session.clients) {
      if (client.readyState === 1 /* OPEN */) {
        try {
          client.send(JSON.stringify({ type: 'output', data }));
        } catch {}
      }
    }
  });

  term.onExit(({ exitCode }) => {
    session.exited = true;
    for (const client of session.clients) {
      if (client.readyState === 1 /* OPEN */) {
        try {
          client.send(JSON.stringify({ type: 'exit', code: exitCode }));
          client.close();
        } catch {}
      }
    }
    sessions.delete(id);
    fs.rm(session.uploadDir, { recursive: true, force: true }, () => {});
  });

  if (cmd && cmd.trim().length > 0) {
    try {
      term.write(cmd + '\r');
    } catch {}
  }

  sessions.set(id, session);
  return session;
}

export function getSession(id) {
  return sessions.get(id);
}

export function updateSessionTitle(id, title) {
  const session = sessions.get(id);
  if (!session) return null;
  session.title = typeof title === 'string' ? title.trim() : '';
  return session;
}

export function attachClient(session, ws) {
  session.clients.add(ws);
  if (session.buffer) {
    try {
      ws.send(JSON.stringify({ type: 'output', data: session.buffer }));
    } catch {}
  }
}

export function detachClient(session, ws) {
  session.clients.delete(ws);
}

export function resizeSession(session, cols, rows) {
  if (!session || !session.pty || session.exited) return;
  const c = Math.floor(cols);
  const r = Math.floor(rows);
  if (c > 0 && r > 0 && Number.isFinite(c) && Number.isFinite(r)) {
    try {
      session.pty.resize(c, r);
    } catch {
      // Ignore ioctl EBADF or similar errors when the pty is closed or exiting
    }
  }
}

export function writeToSession(session, data) {
  if (!session || !session.pty || session.exited) return;
  try {
    session.pty.write(data);
  } catch {
    // Ignore errors if the pty has exited
  }
}

export function ensureUploadDir(session) {
  fs.mkdirSync(session.uploadDir, { recursive: true });
  return session.uploadDir;
}

export function defaultCwd() {
  return os.homedir();
}

export function killSession(id) {
  const session = sessions.get(id);
  if (session) {
    session.exited = true;
    try {
      session.pty.kill();
    } catch {}
    sessions.delete(id);
  }
}

// Kill all sessions when server process die
function killAll() {
  for (const session of sessions.values()) {
    session.exited = true;
    try {
      session.pty.kill();
    } catch {}
  }
  sessions.clear();
}
process.on('exit', killAll);
process.on('SIGINT', () => { killAll(); process.exit(); });
process.on('SIGTERM', () => { killAll(); process.exit(); });
