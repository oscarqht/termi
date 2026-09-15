import pty from 'node-pty';
import crypto from 'node:crypto';
import os from 'node:os';

// How long a session's PTY is kept alive after its WebSocket disconnects,
// so a page refresh (or brief network blip) reconnects to the same process
// instead of losing it.
const GRACE_PERIOD_MS = 12_000;

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
    createdAt: s.createdAt,
    connected: s.ws !== null,
  }));
}

export function createSession({ cwd, cmd }) {
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
    createdAt: Date.now(),
    pty: term,
    buffer: '',
    ws: null,
    killTimer: null,
  };

  term.onData((data) => {
    session.buffer += data;
    if (session.buffer.length > BUFFER_MAX_CHARS) {
      session.buffer = session.buffer.slice(session.buffer.length - BUFFER_MAX_CHARS);
    }
    if (session.ws && session.ws.readyState === session.ws.OPEN) {
      session.ws.send(JSON.stringify({ type: 'output', data }));
    }
  });

  term.onExit(({ exitCode }) => {
    if (session.ws && session.ws.readyState === session.ws.OPEN) {
      session.ws.send(JSON.stringify({ type: 'exit', code: exitCode }));
      session.ws.close();
    }
    clearTimeout(session.killTimer);
    sessions.delete(id);
  });

  if (cmd && cmd.trim().length > 0) {
    term.write(cmd + '\r');
  }

  sessions.set(id, session);
  return session;
}

export function getSession(id) {
  return sessions.get(id);
}

export function attachClient(session, ws) {
  // Replace any previous socket for this session (e.g. a stale tab reconnecting).
  if (session.ws && session.ws !== ws) {
    session.ws.close();
  }
  clearTimeout(session.killTimer);
  session.killTimer = null;
  session.ws = ws;

  if (session.buffer) {
    ws.send(JSON.stringify({ type: 'output', data: session.buffer }));
  }
}

export function detachClient(session, ws) {
  if (session.ws !== ws) return;
  session.ws = null;
  session.killTimer = setTimeout(() => {
    session.pty.kill();
    sessions.delete(session.id);
  }, GRACE_PERIOD_MS);
}

export function resizeSession(session, cols, rows) {
  if (cols > 0 && rows > 0) {
    session.pty.resize(cols, rows);
  }
}

export function writeToSession(session, data) {
  session.pty.write(data);
}

export function defaultCwd() {
  return os.homedir();
}
