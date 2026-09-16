import pty from 'node-pty';
import crypto from 'node:crypto';
import os from 'node:os';

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
    connected: s.clients.size > 0,
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
    clients: new Set(),
  };

  term.onData((data) => {
    session.buffer += data;
    if (session.buffer.length > BUFFER_MAX_CHARS) {
      session.buffer = session.buffer.slice(session.buffer.length - BUFFER_MAX_CHARS);
    }
    for (const client of session.clients) {
      if (client.readyState === 1 /* OPEN */) {
        client.send(JSON.stringify({ type: 'output', data }));
      }
    }
  });

  term.onExit(({ exitCode }) => {
    for (const client of session.clients) {
      if (client.readyState === 1 /* OPEN */) {
        client.send(JSON.stringify({ type: 'exit', code: exitCode }));
        client.close();
      }
    }
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
  session.clients.add(ws);
  if (session.buffer) {
    ws.send(JSON.stringify({ type: 'output', data: session.buffer }));
  }
}

export function detachClient(session, ws) {
  session.clients.delete(ws);
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

export function killSession(id) {
  const session = sessions.get(id);
  if (session) {
    session.pty.kill();
    sessions.delete(id);
  }
}

// Kill all sessions when server process die
function killAll() {
  for (const session of sessions.values()) {
    session.pty.kill();
  }
  sessions.clear();
}
process.on('exit', killAll);
process.on('SIGINT', () => { killAll(); process.exit(); });
process.on('SIGTERM', () => { killAll(); process.exit(); });
