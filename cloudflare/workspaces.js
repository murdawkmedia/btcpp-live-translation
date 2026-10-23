import { randomBytes, timingSafeEqual } from 'node:crypto';
import { WorkspaceAccess, accessCode, cookieValue, validWorkspaceId, workspaceSecret } from '../src/workspace-access.js';
import { secureProviderOrigin } from '../src/provider-settings.js';

const fail = (status, message) => Object.assign(Error(message), { status });
const json = (value, status = 200, headers) => Response.json(value, { status, headers });
const equal = (a, b) => typeof a === 'string' && typeof b === 'string' && Buffer.byteLength(a) === Buffer.byteLength(b) && timingSafeEqual(Buffer.from(a), Buffer.from(b));
export const workspacePath = pathname => pathname.match(/^\/w\/([a-f0-9]{32})(\/.*)?$/);

export function initializeWorkspace(stage, ctx, master) {
  stage.workspaceMaster = master;
  stage.access = new WorkspaceAccess({ get: () => ctx.storage.get('workspace-access-v1'), put: value => ctx.storage.put('workspace-access-v1', value) });
}

export async function workspaceAdmin(stage, request, body) {
  if (!stage.env.WORKSPACE_STAGE) {
    if (request.method === 'GET') return json({ enabled: false });
    throw fail(503, 'Workspace hosting is not configured.');
  }
  if (stage.workspaceAdminBusy) throw fail(409, 'Workspace administration is busy. Try again shortly.');
  stage.workspaceAdminBusy = true;
  try {
    const catalog = await stage.ctx.storage.get('workspace-catalog-v1') || [];
    if (request.method === 'GET') return json({ enabled: true, role: 'admin', workspaces: catalog });
    const recover = body.action === 'recover';
    if (body.action && !recover) throw fail(400, 'Unsupported workspace action.');
    if (recover && (!validWorkspaceId(body.id) || !catalog.some(v => v.id === body.id))) throw fail(404, 'Workspace not found.');
    if (!recover && catalog.length >= 50) throw fail(409, 'Workspace limit reached.');
    if (!recover && (typeof body.name !== 'string' || !body.name.trim() || body.name.length > 80 || /[\x00-\x1f\x7f]/.test(body.name))) throw fail(400, 'Enter a workspace name of up to 80 characters.');
    const id = recover ? body.id : randomBytes(16).toString('hex');
    const objectId = stage.env.WORKSPACE_STAGE.idFromName(id);
    const secret = workspaceSecret(stage.env.PROVIDER_SETTINGS_KEY, objectId.toString(), 'admin');
    const code = recover ? null : accessCode();
    const response = await stage.env.WORKSPACE_STAGE.get(objectId).fetch(new Request(`${new URL(request.url).origin}/w/${id}/api/workspace/bootstrap`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Workspace-Admin': secret },
      body: JSON.stringify(recover ? { action: 'recover' } : { name: body.name, ownerCode: code })
    }));
    if (!response.ok) throw fail(response.status === 409 ? 409 : 503, 'Workspace setup is unavailable or busy. Existing workspaces are unchanged.');
    const result = await response.json();
    if (!recover) await stage.ctx.storage.put('workspace-catalog-v1', [...catalog, { id, name: body.name.trim(), createdAt: Date.now() }]);
    return json({ id, url: `${new URL(request.url).origin}/w/${id}/`, code: recover ? result.code : code }, recover ? 200 : 201);
  } finally { stage.workspaceAdminBusy = false; }
}

export async function workspaceFetch(stage, request, parentFetch) {
  const url = new URL(request.url), match = workspacePath(url.pathname);
  if (!match) return json({ error: 'Workspace route not found.' }, 404);
  const prefix = `/w/${match[1]}`, path = match[2] || '/';
  try {
    await stage.access.ready;
    if (stage.access.problem) throw fail(503, stage.access.problem);
    if (path === '/api/workspace/bootstrap') {
      const expected = workspaceSecret(stage.workspaceMaster, stage.ctx.id.toString(), 'admin');
      if (request.method !== 'POST' || !equal(request.headers.get('X-Workspace-Admin'), expected)) throw fail(404, 'Not found.');
      const body = await stage.body(request);
      if (body.action === 'recover') {
        if (stage.settings.busy) throw fail(409, 'Provider settings are busy. Retry owner recovery shortly.');
        const result = await stage.access.recover(); stage.halt('Workspace owner access was reset.'); return json(result);
      }
      await stage.access.initialize(body); return json({ ok: true });
    }
    if (!stage.access.value) throw fail(404, 'Workspace not found.');
    const token = cookieValue(request.headers, 'btcpp_workspace'), grant = stage.access.authenticate(token);
    const originOK = request.headers.get('Origin') === url.origin && secureProviderOrigin(url.origin);
    if (request.method === 'POST' && !originOK) throw fail(403, 'Request origin not allowed.');
    const cookie = value => `btcpp_workspace=${value}; HttpOnly; SameSite=Strict; Path=${prefix}/; Max-Age=${value ? 43200 : 0}${url.protocol === 'https:' ? '; Secure' : ''}`;
    if (path === '/api/login' && request.method === 'POST') {
      const body = await stage.body(request);
      if (!stage.access.authenticate(body.token)) throw fail(401, 'Invalid or expired workspace access code.');
      return json({ ok: true }, 200, { 'Set-Cookie': cookie(body.token) });
    }
    if (path === '/api/logout' && request.method === 'POST') return json({ ok: true }, 200, { 'Set-Cookie': cookie('') });
    if (path === '/api/health') {
      if (request.method !== 'GET') throw fail(405, 'Method not allowed.');
      return json({ service: 'btcpp-live-translation', workspaceScoped: true, operatorAuthenticated: Boolean(grant), liveReady: grant ? stage.ready() : false });
    }
    const attendeePath = path === '/api/listener' || path === '/api/events' || /^\/api\/audio\/\d+$/.test(path);
    if (!grant && !(request.method === 'GET' && attendeePath && equal(url.searchParams.get('token'), stage.env.VIEWER_TOKEN))) throw fail(401, 'Workspace access required.');
    if (path === '/api/workspaces') throw fail(403, 'Administrator access required.');
    if (path === '/api/workspace') {
      if (request.method !== 'GET') throw fail(405, 'Method not allowed.');
      return json({ ...stage.access.info(grant.role), url: url.origin + prefix + '/' });
    }
    if (path === '/api/workspace/invites') {
      if (grant?.role !== 'owner') throw fail(403, 'Only the workspace owner can manage event access.');
      if (request.method !== 'POST') throw fail(405, 'Method not allowed.');
      const body = await stage.body(request);
      if (body.action === 'create') {
        if (body.allowBudget !== true) throw fail(400, 'Confirm permission to use this workspace’s API credits.');
        return json({ ...await stage.access.issue(), url: url.origin + prefix + '/' }, 201);
      }
      if (body.action !== 'revoke') throw fail(400, 'Unsupported event access action.');
      const result = await stage.access.revoke(body.id);
      if (stage.active?.accessId === body.id) stage.halt('Event operator access was revoked.');
      return json(result);
    }
    if (path.startsWith('/api/providers') && grant?.role !== 'owner') throw fail(403, 'Only the workspace owner can manage provider keys and checks.');
    if (stage.access.busy && (path === '/api/capture' || request.method === 'POST')) throw fail(409, 'Workspace access is busy. Try again shortly.');
    const headers = new Headers(request.headers);
    headers.delete('Cookie'); headers.delete('X-Workspace-Admin'); headers.delete('X-Workspace-Grant'); headers.delete('X-Workspace-Prefix');
    if (grant) headers.set('Cookie', `btcpp_operator=${stage.env.OPERATOR_TOKEN}`);
    headers.set('X-Workspace-Prefix', prefix); headers.set('X-Workspace-Grant', grant?.id || 'attendee');
    url.pathname = path;
    const response = await parentFetch(new Request(url, new Request(request, { headers })));
    if ((path === '/api/capture' || path === '/api/rehearsal') && grant?.expiresAt && stage.active?.accessId === grant.id) {
      const source = stage.active, delay = grant.expiresAt - Date.now();
      if (delay <= 6 * 3600000) source.accessTimer = setTimeout(() => { if (stage.active === source) stage.halt('Event operator access expired.'); }, Math.max(0, delay));
    }
    if (path === '/api/config' && response.ok) return json({ ...await response.json(), workspace: stage.access.info(grant.role) });
    return response;
  } catch (error) { return json({ error: error.status ? error.message : 'Workspace request failed.' }, error.status || 500); }
}
