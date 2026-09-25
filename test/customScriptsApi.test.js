import { test, describe, before, after } from 'node:test';
import assert from 'node:assert';
import http from 'node:http';
import {
  loadCustomScripts,
  saveCustomScripts,
  startExecution,
  getExecution,
  cancelExecution,
  dismissExecution,
  listExecutions,
} from '../server/customScriptsManager.js';

describe('Custom Scripts HTTP API routes', () => {
  let server;
  let port;
  let baseUrl;

  before(async () => {
    server = http.createServer(async (req, res) => {
      const url = new URL(req.url, `http://${req.headers.host}`);

      if (url.pathname === '/api/custom-scripts/config' && req.method === 'GET') {
        const scripts = await loadCustomScripts();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify(scripts));
      }

      if (url.pathname === '/api/custom-scripts/config' && req.method === 'PUT') {
        let body = '';
        req.on('data', (chunk) => (body += chunk));
        req.on('end', async () => {
          try {
            const parsed = JSON.parse(body);
            const saved = await saveCustomScripts(parsed);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(saved));
          } catch (err) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: String(err) }));
          }
        });
        return;
      }

      if (url.pathname === '/api/custom-scripts' && req.method === 'GET') {
        const executions = listExecutions();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ success: true, executions }));
      }

      if (url.pathname === '/api/custom-scripts' && req.method === 'POST') {
        let body = '';
        req.on('data', (chunk) => (body += chunk));
        req.on('end', async () => {
          try {
            const payload = JSON.parse(body || '{}');
            const { command, executionId, cwd, scriptName, scriptContent, force } = payload;

            switch (command) {
              case 'list': {
                const executions = listExecutions();
                res.writeHead(200, { 'Content-Type': 'application/json' });
                return res.end(JSON.stringify({ success: true, executions }));
              }
              case 'status': {
                if (!executionId) {
                  res.writeHead(400, { 'Content-Type': 'application/json' });
                  return res.end(JSON.stringify({ error: 'Missing executionId' }));
                }
                const item = getExecution(executionId);
                if (!item) {
                  res.writeHead(404, { 'Content-Type': 'application/json' });
                  return res.end(JSON.stringify({ error: 'Execution not found' }));
                }
                res.writeHead(200, { 'Content-Type': 'application/json' });
                return res.end(JSON.stringify({ success: true, ...item }));
              }
              case 'cancel': {
                if (!executionId) {
                  res.writeHead(400, { 'Content-Type': 'application/json' });
                  return res.end(JSON.stringify({ error: 'Missing executionId' }));
                }
                const item = cancelExecution(executionId, !!force);
                if (!item) {
                  res.writeHead(404, { 'Content-Type': 'application/json' });
                  return res.end(JSON.stringify({ error: 'Execution not found' }));
                }
                res.writeHead(200, { 'Content-Type': 'application/json' });
                return res.end(JSON.stringify({ success: true, ...item }));
              }
              case 'dismiss': {
                if (!executionId) {
                  res.writeHead(400, { 'Content-Type': 'application/json' });
                  return res.end(JSON.stringify({ error: 'Missing executionId' }));
                }
                dismissExecution(executionId);
                res.writeHead(200, { 'Content-Type': 'application/json' });
                return res.end(JSON.stringify({ success: true }));
              }
              case 'start': {
                if (!scriptContent) {
                  res.writeHead(400, { 'Content-Type': 'application/json' });
                  return res.end(JSON.stringify({ error: 'Missing scriptContent' }));
                }
                const item = await startExecution({
                  cwd: cwd || process.cwd(),
                  scriptName: scriptName || 'Custom Script',
                  scriptContent,
                });
                res.writeHead(200, { 'Content-Type': 'application/json' });
                return res.end(JSON.stringify({ success: true, ...item }));
              }
              default: {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                return res.end(JSON.stringify({ error: `Unknown command: ${command}` }));
              }
            }
          } catch (err) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: String(err) }));
          }
        });
        return;
      }

      res.writeHead(404);
      res.end();
    });

    await new Promise((resolve) => {
      server.listen(0, '127.0.0.1', () => {
        port = server.address().port;
        baseUrl = `http://127.0.0.1:${port}`;
        resolve();
      });
    });
  });

  after((done) => {
    if (server) {
      server.close(done);
    } else {
      done();
    }
  });

  test('GET /api/custom-scripts/config returns scripts array', async () => {
    const res = await fetch(`${baseUrl}/api/custom-scripts/config`);
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert(Array.isArray(body));
    assert(body.length > 0);
  });

  test('POST /api/custom-scripts command:start executes script and streams status', async () => {
    const startRes = await fetch(`${baseUrl}/api/custom-scripts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        command: 'start',
        scriptName: 'API Test Echo',
        scriptContent: 'echo "hello from api test"',
      }),
    });

    assert.strictEqual(startRes.status, 200);
    const startData = await startRes.json();
    assert.strictEqual(startData.success, true);
    assert(startData.executionId);
    assert.strictEqual(startData.scriptName, 'API Test Echo');

    // Poll until completed
    let finished = false;
    let pollData;
    for (let i = 0; i < 20; i++) {
      await new Promise((r) => setTimeout(r, 100));
      const statusRes = await fetch(`${baseUrl}/api/custom-scripts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          command: 'status',
          executionId: startData.executionId,
        }),
      });
      pollData = await statusRes.json();
      if (pollData.status === 'completed' || pollData.status === 'failed') {
        finished = true;
        break;
      }
    }

    assert.strictEqual(finished, true);
    assert.strictEqual(pollData.status, 'completed');
    assert(pollData.output.includes('hello from api test'));

    // Test dismiss
    const dismissRes = await fetch(`${baseUrl}/api/custom-scripts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        command: 'dismiss',
        executionId: startData.executionId,
      }),
    });
    assert.strictEqual(dismissRes.status, 200);
  });
});
