import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
const code = await readFile(new URL('../public/workspace.js', import.meta.url), 'utf8').catch(() => '');

test('operator and attendee API paths stay inside the selected workspace', () => {
  assert.match(code, /workspacePrefix/);
  const id = 'a'.repeat(32), sandbox = { location: { pathname: `/w/${id}/listen` } };
  vm.runInNewContext(code.replaceAll('export function ', 'function ') + '\nthis.result = [workspacePrefix(), scopedUrl("/api/events?token=fixture")];', sandbox);
  assert.deepEqual(Array.from(sandbox.result), [`/w/${id}`, `/w/${id}/api/events?token=fixture`]);
  sandbox.location.pathname = '/'; assert.equal(vm.runInNewContext('scopedUrl("/api/config")', sandbox), '/api/config');
});

test('new owner codes are displayed privately once and can be dismissed without browser storage', async () => {
  const nodes = new Map();
  const node = id => { if (!nodes.has(id)) nodes.set(id, { handlers: {}, value: '', children: [], addEventListener(type, fn) { this.handlers[type] = fn; }, replaceChildren(...children) { this.children = children; }, append(...children) { this.children.push(...children); } }); return nodes.get(id); };
  const sandbox = { location: { pathname: '/' }, document: { getElementById: node, createElement: () => node(Math.random()) },
    navigator: { clipboard: { writeText: async () => {} } }, window: { confirm: () => true },
    api: async (path, body) => body ? { id: 'a'.repeat(32), url: '/w/' + 'a'.repeat(32) + '/', code: 'private-owner-fixture-only' } : { enabled: true, workspaces: [] } };
  vm.runInNewContext(code.replaceAll('export function ', 'function ') + '\nthis.panel = initWorkspacePanel({ api, onLogout() {} });', sandbox);
  await sandbox.panel.load(); node('workspace-name').value = 'Operator A';
  await node('workspace-create-form').handlers.submit({ preventDefault() {} });
  assert.equal(node('workspace-code').value, 'private-owner-fixture-only');
  assert.equal(node('workspace-secret').hidden, false);
  node('workspace-dismiss').handlers.click(); assert.equal(node('workspace-code').value, ''); assert.equal(node('workspace-secret').hidden, true);
  assert.equal(/localStorage|sessionStorage/.test(code), false);
});
