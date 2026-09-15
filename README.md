# termi

A browser-based terminal. Runs a small Node server that spawns real PTY sessions and streams them to a React + xterm.js frontend over WebSockets, so you can open a terminal from any browser on your Tailscale network.

## Features

- Real shell sessions via `node-pty`, multiplexed over WebSocket
- Multiple concurrent sessions, each with its own working directory and optional initial command(s)
- Native macOS folder picker for choosing a session's working directory
- Per-session local scrollback history
- Binds to your Tailscale interface automatically (falls back to `127.0.0.1`)

## Getting started

```bash
npm install
npm run dev
```

This starts the dev server (Vite + WebSocket backend) at `http://localhost:3200` (or your Tailscale IP if available).

## Production

```bash
npm run build
npm start
```

## Configuration

- `PORT` — server port (default `3200`)
- `HOST` — override the auto-detected bind address
