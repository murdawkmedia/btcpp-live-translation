import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import { writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { WebSocket, WebSocketServer } from 'ws';

test('two hosted workspaces isolate keys, operators, captions and spending authority', { timeout: 60000 }, async t => {
  let heardKey = '', calls = 0;
  const fake = createServer(async (req, res) => { req.resume(); calls++; res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ choices: [{ message: { content: '비트코인.' } }] })); });
  const fakeWs = new WebSocketServer({ server: fake });
  fakeWs.on('connection', ws => { let first = true; ws.send(JSON.stringify({ message_type: 'session_started' })); ws.on('message', () => {
    ws.send(JSON.stringify({ message_type: first ? 'partial_transcript' : 'committed_transcript', text: 'Bitcoin.' })); first = false;
  }); });
  fake.on('upgrade', req => { heardKey = req.headers['xi-api-key']; });
  fake.listen(0, '127.0.0.1'); await once(fake, 'listening'); t.after(() => { for (const ws of fakeWs.clients) ws.terminate(); fakeWs.close(); fake.closeAllConnections(); fake.close(); });
  const reserve = createServer(); reserve.listen(0, '127.0.0.1'); await once(reserve, 'listening'); const port = reserve.address().port; await new Promise(r => reserve.close(r));
  const origin = `http://127.0.0.1:${port}`, fixture = `http://127.0.0.1:${fake.address().port}`;
  await mkdir('.runtime', { recursive: true });
  const config = { name: 'workspace-fixture', main: fileURLToPath(new URL('../cloudflare/worker.js', import.meta.url)), compatibility_date: '2026-10-19', compatibility_flags: ['nodejs_compat'],
    assets: { directory: fileURLToPath(new URL('../public', import.meta.url)), binding: 'ASSETS', run_worker_first: true, html_handling: 'none' },
    durable_objects: { bindings: [{ name: 'STAGE', class_name: 'StageSession' }, { name: 'WORKSPACE_STAGE', class_name: 'WorkspaceStage' }] },
    migrations: [{ tag: 'v1', new_sqlite_classes: ['StageSession'] }, { tag: 'v2-workspaces', new_sqlite_classes: ['WorkspaceStage'] }],
    vars: { PROFILE: 'cloud', OPERATOR_TOKEN: 'admin-fixture-only', VIEWER_TOKEN: 'legacy-viewer-fixture', PROVIDER_SETTINGS_KEY: '67'.repeat(32), STAGE_INSTANCE: 'root-fixture',
      ELEVENLABS_API_KEY: 'admin-eleven-must-not-inherit', OPENROUTER_API_KEY: 'admin-router-must-not-inherit', XAI_API_KEY: 'admin-xai-must-not-inherit', STT_URL: fixture.replace('http:', 'ws:') + '/stt', TRANSLATION_BASE_URL: fixture,
      WORKSPACE_STT_URL: fixture.replace('http:', 'ws:') + '/stt', WORKSPACE_TRANSLATION_BASE_URL: fixture } };
  await writeFile('.runtime/workspace-fixture.json', JSON.stringify(config));
  const persistence = '.runtime/workspace-fixture-state-' + Date.now();
  let child = spawn(process.execPath, ['node_modules/wrangler/bin/wrangler.js', 'dev', '--local', '--inspector-port', '0', '--config', '.runtime/workspace-fixture.json', '--port', String(port), '--persist-to', persistence], { stdio: ['ignore', 'pipe', 'pipe'] });
  let logs = ''; for (const stream of [child.stdout, child.stderr]) stream.on('data', data => { logs = (logs + data).slice(-4000); });
  t.after(async () => { child.kill('SIGTERM'); await Promise.race([once(child, 'exit'), new Promise(r => setTimeout(r, 3000))]); });
  let ready = false; for (let i = 0; i < 100; i++) { if (child.exitCode !== null) throw Error(logs); try { if ((await fetch(origin + '/api/health')).ok) { ready = true; break; } } catch {} await new Promise(r => setTimeout(r, 100)); }
  assert.ok(ready, logs);
  const admin = 'btcpp_operator=admin-fixture-only';
  const request = (path, cookie, body, from = origin) => fetch(origin + path, { method: body === undefined ? 'GET' : 'POST', headers: { ...(cookie ? { Cookie: cookie } : {}), Origin: from, 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  assert.equal((await request('/api/workspaces', null, { name: 'Bad' })).status, 401);
  const aResponse = await request('/api/workspaces', admin, { name: 'Workspace A' }); assert.equal(aResponse.status, 201);
  const a = await aResponse.json(), b = await (await request('/api/workspaces', admin, { name: 'Workspace B' })).json();
  const path = (room, route) => `/w/${room.id}${route}`;
  const login = async (room, code) => { const response = await request(path(room, '/api/login'), null, { token: code }); assert.equal(response.status, 200); const cookie = response.headers.get('set-cookie'); assert.ok(cookie.includes(`Path=/w/${room.id}/`) && cookie.includes('HttpOnly')); return cookie.split(';')[0]; };
  const ownerA = await login(a, a.code), ownerB = await login(b, b.code);
  assert.equal((await request(path(b, '/api/providers'), ownerA)).status, 401);
  assert.equal((await request(path(a, '/api/providers'), admin)).status, 401, 'Root cookie alone must not authorize a private workspace');
  const clean = await (await request(path(a, '/api/providers'), ownerA)).json();
  assert.equal(Object.values(clean.keys).some(v => v.configured), false); assert.equal(clean.options.sttProvider.includes('workers-ai'), false);
  assert.equal((await request(path(a, '/api/providers'), ownerA, { keys: { elevenlabs: 'workspace-a-eleven-private', openrouter: 'workspace-a-router-private' } })).status, 200);
  assert.equal(Object.values((await (await request(path(b, '/api/providers'), ownerB)).json()).keys).some(v => v.configured), false);
  const safe = await (await request(path(a, '/api/config'), ownerA)).json(); assert.equal(JSON.stringify(safe).includes('workspace-a-eleven-private'), false);
  const viewA = new URL(safe.viewerUrl), viewB = new URL((await (await request(path(b, '/api/config'), ownerB)).json()).viewerUrl);
  assert.equal(viewA.pathname, path(a, '/listen')); assert.notEqual(viewA.searchParams.get('token'), viewB.searchParams.get('token'));
  assert.equal((await request(path(b, '/api/listener') + viewA.search, null)).status, 401);
  assert.equal((await request(path(a, '/api/providers') + viewA.search, null)).status, 401);
  assert.equal((await request(path(a, '/api/workspace/invites'), ownerA, { action: 'create' })).status, 400);
  const invite = await (await request(path(a, '/api/workspace/invites'), ownerA, { action: 'create', allowBudget: true })).json(); const eventOperator = await login(a, invite.code);
  assert.equal((await request(path(a, '/api/providers'), eventOperator, { ttsProvider: 'xai' })).status, 403);
  assert.equal((await request(path(a, '/api/providers/connect/openrouter'), eventOperator, { action: 'begin' })).status, 403);
  const connection = await (await request(path(a, '/api/providers/connect/openrouter'), ownerA, { action: 'begin' })).json();
  const authorization = new URL(connection.url); assert.equal(new URL(authorization.searchParams.get('callback_url')).pathname, path(a, '/'));
  const connectionState = authorization.searchParams.get('state');
  assert.equal((await request(path(b, '/api/providers/connect/openrouter'), ownerB, { action: 'finish', state: connectionState, code: 'fixture-code' })).status, 400);
  assert.equal((await request(path(a, '/api/workspace/invites'), eventOperator, { action: 'create' })).status, 403);
  assert.equal((await request(path(a, '/api/workspaces'), ownerA, { name: 'Escalate' })).status, 403);
  assert.equal((await request(path(a, '/api/workspace/bootstrap'), ownerA, { name: 'Forged', ownerCode: a.code })).status, 404);
  assert.equal((await request(path(a, '/api/settings'), ownerA, { targetLanguage: 'fr' }, 'https://other.invalid')).status, 403);
  const ws = new WebSocket(origin.replace('http:', 'ws:') + path(a, '/api/capture'), { headers: { Cookie: eventOperator, Origin: origin } }); t.after(() => ws.terminate()); await once(ws, 'open');
  const opened = once(ws, 'message'); ws.send(JSON.stringify({ type: 'start' })); assert.match((await opened)[0].toString(), /ready/);
  ws.send(Buffer.alloc(3200));
  let draft;
  for (let i = 0; i < 100; i++) { draft = await (await request(path(a, '/api/listener') + viewA.search)).json(); if (draft.draft?.translated) break; await new Promise(r => setTimeout(r, 20)); }
  assert.equal(draft.draft?.english, 'Bitcoin.'); assert.equal(draft.draft?.translated, '비트코인.');
  assert.equal((await (await request(path(b, '/api/listener') + viewB.search)).json()).draft, null, 'Live drafts cannot cross workspace boundaries');
  ws.send(Buffer.alloc(3200));
  let live;
  for (let i = 0; i < 100; i++) { live = await (await request(path(a, '/api/listener') + viewA.search)).json(); if (live.history?.some(v => v.translated)) break; await new Promise(r => setTimeout(r, 20)); }
  assert.equal(heardKey, 'workspace-a-eleven-private'); assert.ok(calls > 0); assert.ok(live.history.some(v => v.translated));
  assert.deepEqual((await (await request(path(b, '/api/listener') + viewB.search)).json()).history, []);
  const closing = once(ws, 'close'); await request(path(a, '/api/workspace/invites'), ownerA, { action: 'revoke', id: invite.id }); await closing;
  assert.equal((await request(path(a, '/api/config'), eventOperator)).status, 401);
  const recovered = await (await request('/api/workspaces', admin, { action: 'recover', id: a.id })).json();
  assert.equal((await request(path(a, '/api/config'), ownerA)).status, 401); const newOwner = await login(a, recovered.code);
  assert.equal((await request(path(a, '/api/providers/connect/openrouter'), newOwner, { action: 'finish', state: connectionState, code: 'fixture-code' })).status, 400, 'Owner recovery invalidates an old owner connection');
  assert.equal((await (await request(path(a, '/api/providers'), newOwner)).json()).keys.elevenlabs.configured, true);
  assert.equal((await request('/api/listener?token=legacy-viewer-fixture')).status, 200);
  const catalog = await (await request('/api/workspaces', admin)).text(); assert.equal(catalog.includes(a.code), false); assert.equal(catalog.includes(invite.code), false);
  const exited = once(child, 'exit'); child.kill('SIGTERM'); await exited;
  child = spawn(process.execPath, ['node_modules/wrangler/bin/wrangler.js', 'dev', '--local', '--inspector-port', '0', '--config', '.runtime/workspace-fixture.json', '--port', String(port), '--persist-to', persistence], { stdio: ['ignore', 'pipe', 'pipe'] });
  for (const stream of [child.stdout, child.stderr]) stream.on('data', data => { logs = (logs + data).slice(-4000); });
  let restored;
  for (let i = 0; i < 100; i++) {
    try { const response = await request(path(a, '/api/providers'), newOwner); if (response.ok) { restored = await response.json(); break; } } catch {}
    await new Promise(r => setTimeout(r, 100));
  }
  assert.equal(restored?.keys.elevenlabs.configured, true, 'Owner access and isolated encrypted settings survive a Worker restart');
  assert.equal((await request(path(a, '/api/config'), ownerA)).status, 401);
  assert.equal((await (await request('/api/workspaces', admin)).json()).workspaces.length, 2);
});
