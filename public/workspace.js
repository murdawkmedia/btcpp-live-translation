export function workspacePrefix(path = location.pathname || '') { const match = path.match(/^\/w\/([a-f0-9]{32})(?:\/|$)/); return match ? '/w/' + match[1] : ''; }
export function scopedUrl(path) { return workspacePrefix() + path; }

export function initWorkspacePanel({ api, onLogout }) {
  const node = id => document.getElementById(id);
  let pending = false, privateCode = '';
  const message = text => { node('workspace-message').textContent = text; };
  const dismiss = () => { privateCode = ''; node('workspace-code').value = ''; node('workspace-secret').hidden = true; };
  function reveal(value, kind) {
    privateCode = value.code; node('workspace-code').value = value.code; node('workspace-secret-link').href = value.url;
    node('workspace-secret-label').textContent = `${kind}. Copy this code privately now; it will not be shown again.`;
    node('workspace-secret').hidden = false;
  }
  async function act(action) {
    if (pending) return; pending = true;
    node('workspace-create').disabled = true; node('workspace-invite').disabled = true;
    try { await action(); } catch (error) { message(error.message); }
    finally { pending = false; node('workspace-create').disabled = false; node('workspace-invite').disabled = false; }
  }
  async function load() {
    try {
      if (!workspacePrefix()) {
        const state = await api('/api/workspaces');
        if (!state.enabled) { node('workspace-panel').hidden = true; return; }
        node('workspace-panel').hidden = false; node('workspace-manage').hidden = false; node('workspace-admin').hidden = false;
        node('workspace-owner').hidden = true;
        node('workspace-summary').textContent = 'Administrator desk · keep this operator code private';
        node('workspace-logout').textContent = 'Sign out of admin desk';
        node('workspace-list').replaceChildren(...state.workspaces.map(item => {
          const row = document.createElement('div'); row.className = 'workspace-row';
          const link = document.createElement('a'); link.textContent = item.name; link.href = `/w/${item.id}/`;
          const reset = document.createElement('button'); reset.type = 'button'; reset.className = 'text-button'; reset.textContent = 'Reset owner access';
          reset.addEventListener('click', () => act(async () => {
            if (!window.confirm(`Replace owner access for ${item.name}? This stops its session and revokes all event operator codes. Its provider keys are retained.`)) return;
            reveal(await api('/api/workspaces', { action: 'recover', id: item.id }), 'Replacement owner access'); message('Owner access replaced. Share the new code privately with that operator.');
          }));
          row.append(link, reset); return row;
        }));
      } else {
        const state = await api('/api/workspace'); node('workspace-panel').hidden = false;
        node('workspace-admin').hidden = true; node('workspace-owner').hidden = state.role !== 'owner'; node('workspace-manage').hidden = false;
        node('workspace-summary').textContent = `${state.name} · ${state.role === 'owner' ? 'workspace owner' : 'event operator'}`;
        node('workspace-logout').textContent = 'Sign out of workspace';
        node('workspace-role-note').textContent = state.role === 'owner' ? 'Only this workspace uses its saved keys. Grant event access below when someone should operate using your credits.' : 'The owner has authorized you to operate this workspace using its credits. Provider keys and access controls are managed by the owner.';
        node('workspace-invites').replaceChildren(...(state.invites || []).map(item => {
          const row = document.createElement('div'); row.className = 'workspace-row';
          const text = document.createElement('span'); text.textContent = `Event operator · expires ${new Date(item.expiresAt).toLocaleString()}`;
          const revoke = document.createElement('button'); revoke.type = 'button'; revoke.className = 'text-button'; revoke.textContent = 'Revoke access';
          revoke.addEventListener('click', () => act(async () => {
            await api('/api/workspace/invites', { action: 'revoke', id: item.id }); dismiss(); await load(); message('Event access revoked. Any audio supplied by that operator has stopped.');
          })); row.append(text, revoke); return row;
        }));
      }
    } catch (error) {
      node('workspace-panel').hidden = error.status === 404;
      if (error.status !== 404) message('Workspace access could not be loaded. Refresh the desk to retry.');
    }
  }
  node('workspace-create-form').addEventListener('submit', event => {
    event.preventDefault(); return act(async () => {
      const value = await api('/api/workspaces', { name: node('workspace-name').value.trim() });
      reveal(value, 'Workspace owner access'); node('workspace-name').value = ''; await load(); message('Workspace created with no API keys. Give its owner this workspace link and code privately.');
    });
  });
  node('workspace-invite-form').addEventListener('submit', event => {
    event.preventDefault(); return act(async () => {
      if (!node('workspace-allow-budget').checked) { message('Confirm that this operator may use your workspace credits.'); return; }
      const value = await api('/api/workspace/invites', { action: 'create', allowBudget: true });
      reveal(value, 'Seven-day event operator access'); node('workspace-allow-budget').checked = false; await load(); message('Event access granted. Share the workspace link and this code privately.');
    });
  });
  node('workspace-copy').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(privateCode); message('Private access code copied.'); } catch { message('Copy the access code from the password field manually.'); }
  });
  node('workspace-dismiss').addEventListener('click', dismiss);
  node('workspace-logout').addEventListener('click', onLogout);
  return { load };
}
