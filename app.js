/* ============================================================
   TGForward Panel â€“ Complete SPA Logic
   ============================================================ */

'use strict';

// â”€â”€â”€ Config â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const IS_FILE_PROTOCOL = window.location.protocol === 'file:';
const CONFIG_API_BASE = window.TG_FORWARD_API_BASE || localStorage.getItem('tgpanel_api_base') || '';
const API_ACTIVE_KEY = 'tgpanel_active_api_base';
const SAVED_ACTIVE_API_BASE = localStorage.getItem(API_ACTIVE_KEY) || '';
const API_BASE = CONFIG_API_BASE || (IS_FILE_PROTOCOL
  ? 'http://127.0.0.1:7860/api'
  : `${window.location.origin}/api`);
const EXTRA_API_CANDIDATES = Array.isArray(window.TG_FORWARD_API_CANDIDATES)
  ? window.TG_FORWARD_API_CANDIDATES
  : [];
const API_BASE_CANDIDATES = Array.from(new Set([
  ...(SAVED_ACTIVE_API_BASE ? [SAVED_ACTIVE_API_BASE] : []),
  API_BASE,
  ...EXTRA_API_CANDIDATES,
  ...(CONFIG_API_BASE ? [] : [
    'https://tg-forward-bot.discloud.app/api',
    'https://universo-hot.discloud.app/api',
    'http://127.0.0.1:7860/api'
  ])
])).filter(Boolean);
let activeApiBase = SAVED_ACTIVE_API_BASE || API_BASE;
const WS_URL = CONFIG_API_BASE
  ? CONFIG_API_BASE.replace(/^http/, 'ws').replace(/\/api\/?$/, '/ws/logs')
  : (IS_FILE_PROTOCOL
  ? 'ws://127.0.0.1:7860/ws/logs'
  : `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}/ws/logs`);
const TOKEN_KEY = 'tgpanel_token';
const USER_KEY  = 'tgpanel_user';

async function fetchWithApiFallback(path, options = {}) {
  const bases = Array.from(new Set([activeApiBase, ...API_BASE_CANDIDATES]));
  let lastError = null;

  for (const base of bases) {
    try {
      const res = await fetch(`${base}${path}`, options);
      const contentType = res.headers.get('content-type') || '';
      if (CONFIG_API_BASE || res.status !== 404) {
        if (path.startsWith('/auth/') && !contentType.includes('application/json')) {
          lastError = new Error(`API invalida em ${base}: resposta nao e JSON`);
          continue;
        }
        activeApiBase = base;
        localStorage.setItem(API_ACTIVE_KEY, base);
        return res;
      }
      lastError = new Error(`API nao encontrada em ${base}`);
    } catch (err) {
      lastError = err;
    }
  }

  throw lastError || new Error('Servidor web offline ou inacessivel.');
}

async function readJsonResponse(res) {
  const text = await res.text();
  if (!text.trim()) {
    throw new Error(`Resposta vazia da API em ${activeApiBase}`);
  }
  try {
    return JSON.parse(text);
  } catch (_) {
    throw new Error(`Resposta invalida da API em ${activeApiBase}. O site esta apontando para o dominio errado ou a API nao esta ativa.`);
  }
}

function getWsUrl() {
  if (activeApiBase) {
    return activeApiBase.replace(/^http/, 'ws').replace(/\/api\/?$/, '/ws/logs');
  }
  return WS_URL;
}

// â”€â”€â”€ State â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
let currentSection   = 'dashboard';
let wsConnection     = null;
let autoRefreshTimer = null;
let logAutoScroll    = true;
let currentLogFilter = 'all';
let logLines         = [];

// â”€â”€â”€ Utility: Safe Element â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const $ = id => document.getElementById(id);
const q = sel => document.querySelector(sel);

// â”€â”€â”€ Auth â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}

function setToken(token) {
  localStorage.setItem(TOKEN_KEY, token);
}

function clearAuth() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
}

function isAuthenticated() {
  return !!getToken();
}

async function login(user, pass) {
  let res;
  try {
    res = await fetchWithApiFallback('/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: user, password: pass })
    });
  } catch (err) {
    throw new Error(err.message || 'Servidor web offline ou API da Discloud inacessivel.');
  }

  if (!res.ok) {
    const err = await readJsonResponse(res).catch(() => ({}));
    throw new Error(err.error || err.detail || err.message || 'Credenciais invalidas');
  }

  const data = await readJsonResponse(res);
  const token = data.access_token || data.token || data.access || '';
  if (!token) throw new Error('Login sem token de acesso');

  setToken(token);
  localStorage.setItem(USER_KEY, JSON.stringify({
    username: data.username || user,
    role: data.role || (data.is_admin ? 'Admin' : 'User'),
    user_id: data.user_id,
    is_admin: !!data.is_admin
  }));
  return true;
}

async function logout() {
  try {
    await apiFetch('/auth/logout', { method: 'POST' });
  } catch (_) {}
  clearAuth();
  if (wsConnection) { wsConnection.close(); wsConnection = null; }
  if (autoRefreshTimer) clearInterval(autoRefreshTimer);
  showLoginScreen();
}

async function refreshCurrentUser() {
  const data = await apiFetch('/auth/me');
  localStorage.setItem(USER_KEY, JSON.stringify({
    username: data.username,
    role: data.role || (data.is_admin ? 'Admin' : 'User'),
    user_id: data.user_id,
    is_admin: !!data.is_admin
  }));
  return data;
}

// â”€â”€â”€ API Fetch â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
async function apiFetch(path, options = {}) {
  const token = getToken();
  const headers = {
    'Content-Type': 'application/json',
    ...(options.headers || {}),
    ...(token ? { 'Authorization': `Bearer ${token}` } : {})
  };

  let res;
  try {
    res = await fetchWithApiFallback(path, { ...options, headers });
  } catch (_) {
    throw new Error('Servidor web offline ou inacessivel.');
  }

  if (res.status === 401) {
    clearAuth();
    showLoginScreen();
    throw new Error('NÃ£o autorizado â€” faÃ§a login novamente');
  }

  if (!res.ok) {
    let msg = `Erro ${res.status}`;
    try {
      const body = await readJsonResponse(res);
      msg = body.error || body.detail || body.message || msg;
    } catch (_) {}
    if (res.status === 404) {
      msg = `API nao encontrada em ${activeApiBase}. Abra o site pela Discloud ou atualize o frontend para apontar para a API da Discloud.`;
    }
    throw new Error(msg);
  }

  const contentType = res.headers.get('content-type') || '';
  if (contentType.includes('application/json')) return readJsonResponse(res);
  return res.text();
}

async function waitForQueuedCommand(response, timeoutMs = 12000) {
  const cmdId = response && (response.queued_command_id || response.command_id);
  if (!cmdId) return response;

  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    await new Promise(resolve => setTimeout(resolve, 900));
    const data = await apiFetch(`/commands/${cmdId}`);
    if (data.status === 'done') return data;
    if (data.status === 'failed') {
      throw new Error(data.result_text || 'O bot nao conseguiu executar o comando.');
    }
  }
  return response;
}

// â”€â”€â”€ Toast Notifications â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const TOAST_ICONS = {
  success: 'âœ…',
  error:   'âŒ',
  info:    'â„¹ï¸',
  warning: 'âš ï¸'
};

const TOAST_TITLES = {
  success: 'Sucesso',
  error:   'Erro',
  info:    'InformaÃ§Ã£o',
  warning: 'AtenÃ§Ã£o'
};

function showToast(message, type = 'info', title = null, duration = 4000) {
  const container = $('toast-container');
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `
    <span class="toast-icon">${TOAST_ICONS[type] || 'â„¹ï¸'}</span>
    <div class="toast-body">
      <div class="toast-title">${title || TOAST_TITLES[type]}</div>
      <div class="toast-msg">${message}</div>
    </div>
    <button class="toast-close" onclick="dismissToast(this.parentElement)">âœ•</button>
  `;
  container.appendChild(toast);

  const timer = setTimeout(() => dismissToast(toast), duration);
  toast._timer = timer;

  return toast;
}

function dismissToast(toast) {
  if (!toast || toast._dismissed) return;
  toast._dismissed = true;
  if (toast._timer) clearTimeout(toast._timer);
  toast.classList.add('hiding');
  setTimeout(() => toast.remove(), 350);
}

// â”€â”€â”€ Navigation â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function navigateTo(sectionId) {
  // Hide all sections
  document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
  // Deactivate all nav items
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));

  // Show target section
  const section = $(`section-${sectionId}`);
  if (section) section.classList.add('active');

  // Activate nav item
  const navItem = document.querySelector(`.nav-item[data-section="${sectionId}"]`);
  if (navItem) navItem.classList.add('active');

  currentSection = sectionId;

  // Update header title
  const titles = {
    dashboard:    { title: 'Dashboard',            sub: 'VisÃ£o geral do sistema' },
    users:        { title: 'UsuÃ¡rios',              sub: 'Gerenciar contas e sessÃµes' },
    forward:      { title: 'Forward / Listeners',   sub: 'Monitorar tarefas de escuta' },
    clone:        { title: 'Clone',                 sub: 'Tarefas de clonagem de canais' },
    forwarder:    { title: 'Encaminhadora',          sub: 'Loops de envio automÃ¡tico' },
    replace:      { title: 'SubstituiÃ§Ãµes',          sub: 'Regras de substituiÃ§Ã£o de texto' },
    vip:          { title: 'VIP Mover',              sub: 'MovimentaÃ§Ã£o de conteÃºdo VIP' },
    admin:        { title: 'AdministraÃ§Ã£o',          sub: 'Gerenciar usuÃ¡rios e permissÃµes' },
    logs:         { title: 'Logs ao Vivo',           sub: 'Stream em tempo real' }
  };

  const t = titles[sectionId] || { title: sectionId, sub: '' };
  const hTitle = q('#top-header .header-title h1');
  const hSub   = q('#top-header .header-title p');
  if (hTitle) hTitle.textContent = t.title;
  if (hSub)   hSub.textContent   = t.sub;

  // Load section data
  loadSection(sectionId);

  // Close mobile sidebar
  closeMobileSidebar();
}

function loadSection(id) {
  const loaders = {
    dashboard: loadDashboard,
    users:     loadUsers,
    forward:   loadForwardTasks,
    clone:     loadCloneTasks,
    forwarder: loadForwarderTasks,
    replace:   loadReplaceRules,
    vip:       loadVipTasks,
    admin:     loadAdminUsers,
    logs:      () => connectLogs()
  };
  const fn = loaders[id];
  if (fn) fn();
}

// â”€â”€â”€ Render Helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function renderSkeletonRows(n, cols) {
  const widths = ['short', 'medium', 'long', 'medium', 'short'];
  return Array.from({ length: n }).map(() => `
    <tr class="skeleton-row">
      ${Array.from({ length: cols }).map((_, i) => `
        <td><span class="skeleton ${widths[i % widths.length]}"></span></td>
      `).join('')}
    </tr>
  `).join('');
}

function renderStatusBadge(active, labelOn = 'ATIVO', labelOff = 'INATIVO') {
  return active
    ? `<span class="badge badge-green">${labelOn}</span>`
    : `<span class="badge badge-red">${labelOff}</span>`;
}

function renderProgressBar(done, total) {
  const pct = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0;
  return `
    <div class="prog-wrap">
      <div class="prog-bar">
        <div class="prog-fill" style="width:${pct}%"></div>
      </div>
      <span class="prog-pct">${pct}%</span>
    </div>
    <div class="text-sm text-muted mt-4">${formatNum(done)} / ${formatNum(total)}</div>
  `;
}

function renderToggle(checked, onchangeCall, id = '') {
  return `
    <label class="toggle" title="${checked ? 'Ativo â€” clique para desativar' : 'Inativo â€” clique para ativar'}">
      <input type="checkbox" ${checked ? 'checked' : ''} onchange="${onchangeCall}" id="${id}">
      <span class="toggle-slider"></span>
    </label>
  `;
}

function formatNum(n) {
  if (n == null) return 'â€”';
  return Number(n).toLocaleString('pt-BR');
}

function formatDate(d) {
  if (!d) return 'â€”';
  try {
    return new Date(d).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
  } catch (_) { return String(d); }
}

function timeAgo(d) {
  if (!d) return 'â€”';
  const diff = (Date.now() - new Date(d).getTime()) / 1000;
  if (diff < 60)   return `${Math.round(diff)}s atrÃ¡s`;
  if (diff < 3600) return `${Math.round(diff/60)}min atrÃ¡s`;
  if (diff < 86400) return `${Math.round(diff/3600)}h atrÃ¡s`;
  return `${Math.round(diff/86400)}d atrÃ¡s`;
}

// â”€â”€â”€ Dashboard â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
async function loadDashboard() {
  // Show skeleton in stat cards
  ['stat-users', 'stat-listeners', 'stat-clones', 'stat-forwarders'].forEach(id => {
    const el = $(id);
    if (el) { el.innerHTML = '<span class="spinner"></span>'; }
  });

  try {
    const data = await apiFetch('/status');
    updateDashboardStats(data);
  } catch (e) {
    showToast('NÃ£o foi possÃ­vel carregar o status: ' + e.message, 'error');
    // Show demo values
    updateDashboardStats({
      active_users: 0, running_listeners: 0,
      active_clones: 0, active_forwarders: 0,
      ram_used_mb: 0, ram_total_mb: 0, uptime_seconds: 0,
      tasks_total: 0
    });
  }
}

function updateDashboardStats(data) {
  const set = (id, val) => { const e = $(id); if (e) e.textContent = val; };

  set('stat-users',      formatNum(data.active_users      ?? data.users      ?? 0));
  set('stat-listeners',  formatNum(data.running_listeners ?? data.listeners  ?? 0));
  set('stat-clones',     formatNum(data.active_clones     ?? data.clones     ?? 0));
  set('stat-forwarders', formatNum(data.active_forwarders ?? data.forwarders ?? 0));

  // RAM bar
  const ramUsed  = data.ram_used_mb   || data.ram_used  || 0;
  const ramTotal = data.ram_total_mb  || data.ram_total || 1;
  const ramPct   = Math.min(100, Math.round((ramUsed / ramTotal) * 100));

  const ramFill  = $('ram-fill');
  const ramVal   = $('ram-value');
  const uptimeEl = $('uptime-value');
  const tasksEl  = $('tasks-value');

  if (ramFill) ramFill.style.width  = ramPct + '%';
  if (ramVal)  ramVal.textContent   = `${ramUsed} MB / ${ramTotal} MB (${ramPct}%)`;

  if (uptimeEl) {
    const s = data.uptime_seconds || 0;
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
    uptimeEl.textContent = `${h}h ${m}m`;
  }

  if (tasksEl) tasksEl.textContent = formatNum(data.tasks_total ?? 0);

  // Header stat pills
  const hRam    = $('header-ram');
  const hUptime = $('header-uptime');
  const hTasks  = $('header-tasks');
  if (hRam)    hRam.textContent    = `${ramPct}%`;
  if (hUptime) {
    const s = data.uptime_seconds || 0;
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
    hUptime.textContent = `${h}h${m}m`;
  }
  if (hTasks)  hTasks.textContent  = formatNum(data.tasks_total ?? 0);
}

// â”€â”€â”€ Users â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
async function loadUsers() {
  const tbody = $('users-tbody');
  if (!tbody) return;
  tbody.innerHTML = renderSkeletonRows(5, 6);

  try {
    const data = await apiFetch('/users');
    const users = Array.isArray(data) ? data : (data.users || []);

    if (!users.length) {
      tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;padding:40px;">
        <div class="empty-state"><div class="empty-icon">ðŸ‘¥</div><p>Nenhum usuÃ¡rio encontrado</p></div>
      </td></tr>`;
      return;
    }

    tbody.innerHTML = users.map(renderUserRow).join('');
  } catch (e) {
    tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;color:var(--red);padding:20px;">${e.message}</td></tr>`;
    showToast('Erro ao carregar usuÃ¡rios: ' + e.message, 'error');
  }
}

function renderUserRow(user) {
  const tipo  = user.type || user.tipo || 'DAUGHTER';
  const isVip = user.vip  || user.is_vip || false;
  const conn  = user.connected || user.status === 'connected' || false;

  return `
    <tr>
      <td class="monospace text-sm">#${user.id || user.user_id || 'â€”'}</td>
      <td class="monospace">${user.phone || user.telefone || 'â€”'}</td>
      <td>${tipo === 'MOTHER'
          ? '<span class="badge badge-purple">MOTHER</span>'
          : '<span class="badge badge-cyan">DAUGHTER</span>'}</td>
      <td>${isVip
          ? '<span class="badge badge-yellow">â­ VIP</span>'
          : '<span class="badge" style="background:rgba(100,116,139,.12);color:#64748b;border:1px solid rgba(100,116,139,.2)">FREE</span>'}</td>
      <td>${renderStatusBadge(conn, 'Conectado', 'Desconectado')}</td>
      <td>
        <div class="btn-group">
          <button class="btn btn-ghost btn-sm" onclick="viewUserTasks('${user.id || user.user_id}')">ðŸ“‹ Tasks</button>
          <button class="btn btn-danger btn-sm" onclick="disconnectUser('${user.id || user.user_id}', '${user.phone || ''}')">ðŸ”Œ Desconectar</button>
        </div>
      </td>
    </tr>
  `;
}

async function disconnectUser(userId, phone) {
  if (!confirm(`Desconectar usuÃ¡rio ${phone || userId}?`)) return;
  try {
    await apiFetch(`/users/${userId}/disconnect`, { method: 'POST' });
    showToast(`UsuÃ¡rio ${phone || userId} desconectado`, 'success');
    loadUsers();
  } catch (e) {
    showToast('Erro ao desconectar: ' + e.message, 'error');
  }
}

function viewUserTasks(userId) {
  showToast(`Abrindo tasks do usuÃ¡rio #${userId}`, 'info');
  navigateTo('forward');
}

// â”€â”€â”€ Forward / Listeners â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
async function loadForwardTasks() {
  const grid = $('forward-grid');
  if (!grid) return;
  grid.innerHTML = `<div style="grid-column:1/-1;text-align:center;padding:40px;">
    <span class="spinner"></span><p style="margin-top:12px;color:var(--text-muted);">Carregando listeners...</p>
  </div>`;

  try {
    const data = await apiFetch('/forward/tasks');
    const tasks = Array.isArray(data) ? data : (data.tasks || data.users || []);

    if (!tasks.length) {
      grid.innerHTML = `<div style="grid-column:1/-1;">
        <div class="empty-state"><div class="empty-icon">ðŸ”€</div><p>Nenhuma tarefa de forward encontrada</p></div>
      </div>`;
      return;
    }

    // Group by user if needed
    let grouped;
    if (tasks[0] && tasks[0].tasks) {
      // Already grouped: [{userId, phone, tasks:[...]}]
      grouped = tasks;
    } else {
      // Flat: group by user_id
      const map = {};
      tasks.forEach(t => {
        const uid = t.user_id || t.userId || 'unknown';
        if (!map[uid]) map[uid] = { userId: uid, phone: t.phone || uid, tasks: [] };
        map[uid].tasks.push(t);
      });
      grouped = Object.values(map);
    }

    grid.innerHTML = grouped.map(renderForwardCard).join('');
  } catch (e) {
    grid.innerHTML = `<div style="grid-column:1/-1;text-align:center;color:var(--red);padding:20px;">${e.message}</div>`;
    showToast('Erro ao carregar listeners: ' + e.message, 'error');
  }
}

function renderForwardCard(group) {
  const { userId, phone, tasks } = group;
  const activeCnt = tasks.filter(t => t.active || t.status === 'running').length;

  return `
    <div class="forward-user-card">
      <div class="fwd-card-header">
        <div class="fwd-avatar">ðŸ“¡</div>
        <div class="fwd-title">
          <h4>${phone || userId}</h4>
          <span>${tasks.length} tarefa(s) Â· ${activeCnt} ativa(s)</span>
        </div>
        ${renderStatusBadge(activeCnt > 0)}
      </div>
      <div class="fwd-tasks-list">
        ${tasks.map(t => renderForwardTaskItem(userId, t)).join('')}
      </div>
    </div>
  `;
}

function renderForwardTaskItem(userId, task) {
  const name   = task.rule_name || task.name || task.task_name || task.nome || '-';
  const src    = task.source || task.source_id || task.origem || '-';
  const dsts   = Array.isArray(task.destinations || task.destinos)
                   ? (task.destinations || task.destinos).length
                   : (Array.isArray(task.dests) ? task.dests.length : (task.dest_count || 0));
  const active = task.running || task.active || task.status === 'running' || false;

  return `
    <div class="fwd-task-item">
      <div class="fwd-task-info">
        <div class="fwd-task-name">${name}</div>
        <div class="fwd-task-meta">ðŸ“¤ ${src} â†’ ${dsts} destino(s)</div>
      </div>
      ${renderStatusBadge(active)}
      <div class="btn-group">
        <button class="btn btn-success btn-sm" onclick="startListener('${userId}','${name}')" title="Iniciar">â–¶</button>
        <button class="btn btn-danger btn-sm"  onclick="stopListener('${userId}','${name}')"  title="Parar">â¹</button>
        <button class="btn btn-warning btn-sm" onclick="restartListener('${userId}','${name}')" title="Reiniciar">ðŸ”„</button>
        <button class="btn btn-ghost btn-sm" onclick="editForwardTask('${userId}','${name}','${src}','${(task.dests || []).join(',')}')">âœ</button>
        <button class="btn btn-danger btn-sm" onclick="deleteForwardTask('${userId}','${name}')">ðŸ—‘</button>
      </div>
    </div>
  `;
}

async function startListener(userId, taskName) {
  try {
    const res = await apiFetch(`/forward/${userId}/${encodeURIComponent(taskName)}/start`, { method: 'POST' });
    await waitForQueuedCommand(res);
    showToast(`Listener "${taskName}" iniciado`, 'success');
    loadForwardTasks();
  } catch (e) {
    showToast('Erro ao iniciar: ' + e.message, 'error');
  }
}

async function stopListener(userId, taskName) {
  try {
    const res = await apiFetch(`/forward/${userId}/${encodeURIComponent(taskName)}/stop`, { method: 'POST' });
    await waitForQueuedCommand(res);
    showToast(`Listener "${taskName}" parado`, 'success');
    loadForwardTasks();
  } catch (e) {
    showToast('Erro ao parar: ' + e.message, 'error');
  }
}

async function restartListener(userId, taskName) {
  try {
    const res = await apiFetch(`/forward/${userId}/${encodeURIComponent(taskName)}/restart`, { method: 'POST' });
    await waitForQueuedCommand(res, 16000);
    showToast(`Listener "${taskName}" reiniciado`, 'info');
    loadForwardTasks();
  } catch (e) {
    showToast('Erro ao reiniciar: ' + e.message, 'error');
  }
}

async function createForwardTask() {
  const uid = getCurrentUserId();
  const rule_name = prompt('Nome da tarefa forward:');
  if (!rule_name) return;
  const source_id = prompt('ID de origem:');
  if (!source_id) return;
  const dest_ids = prompt('IDs de destino (separados por vÃ­rgula):');
  if (!dest_ids) return;
  try {
    await apiFetch(`/forward/${uid}/upsert`, { method: 'POST', body: JSON.stringify({ rule_name, source_id, dest_ids }) });
    showToast('Forward salvo', 'success');
    loadForwardTasks();
  } catch (e) { showToast('Erro: ' + e.message, 'error'); }
}

async function editForwardTask(userId, ruleName, src, dests) {
  const source_id = prompt('Editar origem:', src || '');
  if (!source_id) return;
  const dest_ids = prompt('Editar destinos (vÃ­rgula):', dests || '');
  if (!dest_ids) return;
  try {
    await apiFetch(`/forward/${userId}/upsert`, { method: 'POST', body: JSON.stringify({ rule_name: ruleName, source_id, dest_ids }) });
    showToast('Forward atualizado', 'success');
    loadForwardTasks();
  } catch (e) { showToast('Erro: ' + e.message, 'error'); }
}

async function deleteForwardTask(userId, ruleName) {
  if (!confirm(`Excluir forward ${ruleName}?`)) return;
  try {
    await apiFetch(`/forward/${userId}/${encodeURIComponent(ruleName)}`, { method: 'DELETE' });
    showToast('Forward removido', 'success');
    loadForwardTasks();
  } catch (e) { showToast('Erro: ' + e.message, 'error'); }
}

// â”€â”€â”€ Clone â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
async function loadCloneTasks() {
  const tbody = $('clone-tbody');
  if (!tbody) return;
  tbody.innerHTML = renderSkeletonRows(4, 6);

  try {
    const data = await apiFetch('/clone/tasks');
    const tasks = Array.isArray(data) ? data : (data.tasks || []);

    if (!tasks.length) {
      tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;padding:40px;">
        <div class="empty-state"><div class="empty-icon">ðŸ“‹</div><p>Nenhuma tarefa de clone</p></div>
      </td></tr>`;
      return;
    }

    tbody.innerHTML = tasks.map(renderCloneRow).join('');
  } catch (e) {
    tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;color:var(--red);padding:20px;">${e.message}</td></tr>`;
    showToast('Erro ao carregar clones: ' + e.message, 'error');
  }
}

function renderCloneRow(task) {
  const id     = task.id   || task.task_id   || 'â€”';
  const name   = task.name || task.nome      || 'â€”';
  const src    = task.source || task.source_id || task.origem || '-';
  const dsts   = Array.isArray(task.destinations || task.destinos)
                   ? (task.destinations || task.destinos).join(', ')
                   : (task.destination || task.destino || 'â€”');
  const done   = task.cloned  || task.done    || 0;
  const total  = task.total   || task.messages || 0;
  const status = task.status  || (task.active ? 'running' : 'paused');

  const statusBadge = {
    running: '<span class="badge badge-green">RODANDO</span>',
    paused:  '<span class="badge badge-yellow">PAUSADO</span>',
    stopped: '<span class="badge badge-red">PARADO</span>',
    done:    '<span class="badge badge-cyan">CONCLUÃDO</span>'
  }[status] || renderStatusBadge(false);

  return `
    <tr>
      <td>${name}</td>
      <td class="monospace text-sm">${src}</td>
      <td class="text-sm" style="max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${dsts}">${dsts}</td>
      <td>${renderProgressBar(done, total)}</td>
      <td>${statusBadge}</td>
      <td>
        <div class="btn-group">
          <button class="btn btn-success btn-sm" onclick="startClone('${id}')">â–¶ Iniciar</button>
          <button class="btn btn-warning btn-sm" onclick="pauseClone('${id}')">â¸ Pausar</button>
          <button class="btn btn-danger btn-sm"  onclick="stopClone('${id}')">â¹ Parar</button>
          <button class="btn btn-ghost btn-sm" onclick="editCloneTask('${id}','${src}','${String(task.dest_ids || '').replace(/'/g, '&#39;')}','${task.source_topic_id || 0}','${task.dest_topic_id || 0}','${task.start_id || 0}','${task.limit_id || 0}')">âœ</button>
          <button class="btn btn-danger btn-sm" onclick="deleteCloneTask('${id}')">ðŸ—‘</button>
        </div>
      </td>
    </tr>
  `;
}

async function startClone(taskId) {
  try {
    const res = await apiFetch(`/clone/${taskId}/start`, { method: 'POST' });
    await waitForQueuedCommand(res);
    showToast('Clone iniciado', 'success');
    loadCloneTasks();
  } catch (e) { showToast('Erro: ' + e.message, 'error'); }
}

async function pauseClone(taskId) {
  try {
    const res = await apiFetch(`/clone/${taskId}/pause`, { method: 'POST' });
    await waitForQueuedCommand(res);
    showToast('Clone pausado', 'warning');
    loadCloneTasks();
  } catch (e) { showToast('Erro: ' + e.message, 'error'); }
}

async function stopClone(taskId) {
  if (!confirm('Parar este clone?')) return;
  try {
    const res = await apiFetch(`/clone/${taskId}/stop`, { method: 'POST' });
    await waitForQueuedCommand(res);
    showToast('Clone parado', 'info');
    loadCloneTasks();
  } catch (e) { showToast('Erro: ' + e.message, 'error'); }
}

async function createCloneTask() {
  const name = prompt('Nome da tarefa clone:'); if (!name) return;
  const source_id = prompt('ID origem:'); if (!source_id) return;
  const dest_ids = prompt('IDs destino (vÃ­rgula):'); if (!dest_ids) return;
  const source_topic_id = Number(prompt('TÃ³pico origem (0=nenhum):', '0') || 0);
  const dest_topic_id = Number(prompt('TÃ³pico destino (0=nenhum):', '0') || 0);
  const start_id = Number(prompt('ID inicial (0=inÃ­cio):', '0') || 0);
  const limit_id = Number(prompt('ID final (0=sem limite):', '0') || 0);
  try {
    await apiFetch('/clone/create', { method: 'POST', body: JSON.stringify({ name, source_id, dest_ids, source_topic_id, dest_topic_id, start_id, limit_id }) });
    showToast('Clone criado', 'success');
    loadCloneTasks();
  } catch (e) { showToast('Erro: ' + e.message, 'error'); }
}

async function editCloneTask(taskId, source, dests, st, dt, startId, limitId) {
  const source_id = prompt('ID origem:', source || ''); if (!source_id) return;
  const dest_ids = prompt('IDs destino (vÃ­rgula):', dests || ''); if (!dest_ids) return;
  const source_topic_id = Number(prompt('TÃ³pico origem:', String(st || 0)) || 0);
  const dest_topic_id = Number(prompt('TÃ³pico destino:', String(dt || 0)) || 0);
  const start_id = Number(prompt('ID inicial:', String(startId || 0)) || 0);
  const limit_id = Number(prompt('ID final:', String(limitId || 0)) || 0);
  try {
    await apiFetch(`/clone/${taskId}`, { method: 'PATCH', body: JSON.stringify({ source_id, dest_ids, source_topic_id, dest_topic_id, start_id, limit_id }) });
    showToast('Clone atualizado', 'success');
    loadCloneTasks();
  } catch (e) { showToast('Erro: ' + e.message, 'error'); }
}

async function deleteCloneTask(taskId) {
  if (!confirm('Excluir este clone?')) return;
  try {
    await apiFetch(`/clone/${taskId}`, { method: 'DELETE' });
    showToast('Clone removido', 'success');
    loadCloneTasks();
  } catch (e) { showToast('Erro: ' + e.message, 'error'); }
}

// â”€â”€â”€ Forwarder (Encaminhadora) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
async function loadForwarderTasks() {
  const tbody = $('forwarder-tbody');
  if (!tbody) return;
  tbody.innerHTML = renderSkeletonRows(4, 6);

  try {
    const data = await apiFetch('/forwarder/tasks');
    const tasks = Array.isArray(data) ? data : (data.tasks || []);

    if (!tasks.length) {
      tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;padding:40px;">
        <div class="empty-state"><div class="empty-icon">âš¡</div><p>Nenhuma encaminhadora configurada</p></div>
      </td></tr>`;
      return;
    }

    tbody.innerHTML = tasks.map(renderForwarderRow).join('');
  } catch (e) {
    tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;color:var(--red);padding:20px;">${e.message}</td></tr>`;
    showToast('Erro ao carregar encaminhadoras: ' + e.message, 'error');
  }
}

function renderForwarderRow(task) {
  const id       = task.id || task.task_id || 'â€”';
  const name     = task.name || task.nome  || 'â€”';
  const stock    = task.estoque || task.stock_channel || 'â€”';
  const dest     = task.destination || task.destino   || 'â€”';
  const interval = task.interval || task.intervalo    || 'â€”';
  const lastSent = task.last_sent || task.ultimo_envio || null;
  const active   = task.active || task.status === 'running' || false;

  return `
    <tr>
      <td>${name}</td>
      <td class="monospace text-sm">${stock}</td>
      <td class="monospace text-sm">${dest}</td>
      <td>${interval}s</td>
      <td>${formatDate(lastSent)}</td>
      <td>
        <div class="toggle-wrap">
          ${renderToggle(active, `toggleForwarder(event,'${id}')`, `fwd-toggle-${id}`)}
          <span class="text-sm text-muted">${active ? 'Ativo' : 'Inativo'}</span>
        </div>
        <div class="btn-group mt-4">
          <button class="btn btn-ghost btn-sm" onclick="editForwarderTask('${id}','${stock}','${dest}','${task.interval_mins || 30}')">âœ</button>
          <button class="btn btn-danger btn-sm" onclick="deleteForwarderTask('${id}')">ðŸ—‘</button>
        </div>
      </td>
    </tr>
  `;
}

async function toggleForwarder(event, taskId) {
  const chk = event.target;
  const prev = !chk.checked;
  try {
    const data = await apiFetch(`/forwarder/${taskId}/toggle`, { method: 'POST' });
    await waitForQueuedCommand(data);
    const now = data.active ?? chk.checked;
    showToast(`Encaminhadora ${now ? 'ativada' : 'desativada'}`, now ? 'success' : 'info');
    loadForwarderTasks();
  } catch (e) {
    chk.checked = prev; // Revert
    showToast('Erro ao alternar: ' + e.message, 'error');
  }
}

async function createForwarderTask() {
  const name = prompt('Nome da encaminhadora:'); if (!name) return;
  const source_id = prompt('ID origem (estoque):'); if (!source_id) return;
  const dest_id = prompt('ID destino:'); if (!dest_id) return;
  const interval_mins = Number(prompt('Intervalo em minutos:', '30') || 30);
  try {
    await apiFetch('/forwarder/create', { method: 'POST', body: JSON.stringify({ name, source_id, dest_id, interval_mins }) });
    showToast('Encaminhadora criada', 'success');
    loadForwarderTasks();
  } catch (e) { showToast('Erro: ' + e.message, 'error'); }
}

async function editForwarderTask(taskId, source, dest, interval) {
  const source_id = prompt('ID origem:', source || ''); if (!source_id) return;
  const dest_id = prompt('ID destino:', dest || ''); if (!dest_id) return;
  const interval_mins = Number(prompt('Intervalo em minutos:', String(interval || 30)) || 30);
  try {
    await apiFetch(`/forwarder/${taskId}`, { method: 'PATCH', body: JSON.stringify({ source_id, dest_id, interval_mins }) });
    showToast('Encaminhadora atualizada', 'success');
    loadForwarderTasks();
  } catch (e) { showToast('Erro: ' + e.message, 'error'); }
}

async function deleteForwarderTask(taskId) {
  if (!confirm('Excluir encaminhadora?')) return;
  try {
    await apiFetch(`/forwarder/${taskId}`, { method: 'DELETE' });
    showToast('Encaminhadora removida', 'success');
    loadForwarderTasks();
  } catch (e) { showToast('Erro: ' + e.message, 'error'); }
}

// â”€â”€â”€ Replace Rules (SubstituiÃ§Ãµes) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
async function loadReplaceRules() {
  const container = $('replace-container');
  if (!container) return;
  container.innerHTML = `<div style="text-align:center;padding:40px;">
    <span class="spinner"></span>
    <p style="margin-top:12px;color:var(--text-muted);">Carregando regras...</p>
  </div>`;

  try {
    const data = await apiFetch('/replace/rules');
    const items = Array.isArray(data) ? data : (data.rules || data.users || []);

    if (!items.length) {
      container.innerHTML = `<div class="empty-state"><div class="empty-icon">âœï¸</div><p>Nenhuma regra de substituiÃ§Ã£o</p></div>`;
      return;
    }

    // Group by user
    let grouped;
    if (items[0] && items[0].rules) {
      grouped = items;
    } else {
      const map = {};
      items.forEach(r => {
        const uid = r.user_id || r.userId || 'global';
        if (!map[uid]) map[uid] = { userId: uid, phone: r.phone || uid, rules: [] };
        map[uid].rules.push(r);
      });
      grouped = Object.values(map);
    }

    container.innerHTML = grouped.map(renderReplaceGroup).join('');
  } catch (e) {
    container.innerHTML = `<div style="text-align:center;color:var(--red);padding:20px;">${e.message}</div>`;
    showToast('Erro ao carregar substituiÃ§Ãµes: ' + e.message, 'error');
  }
}

function renderReplaceGroup(group) {
  const { userId, phone, rules } = group;
  return `
    <div class="card mb-16">
      <div class="section-header" style="margin-bottom:16px;">
        <div class="section-title">
          <span class="icon">âœï¸</span>
          <div>
            <h2 style="font-size:1rem;">${phone || userId}</h2>
            <p>${rules.length} regra(s)</p>
          </div>
        </div>
      </div>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Buscar</th>
              <th>Substituir por</th>
              <th>Ativo</th>
            </tr>
          </thead>
          <tbody>
            ${rules.map(r => renderReplaceRow(userId, r)).join('')}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

function renderReplaceRow(userId, rule) {
  const id      = rule.id || rule.rule_id || Math.random();
  const find    = rule.find    || rule.buscar      || 'â€”';
  const replace = rule.replace || rule.substituir  || 'â€”';
  const active  = rule.active  || rule.ativo       || false;

  return `
    <tr>
      <td class="monospace">${escapeHtml(find)}</td>
      <td class="monospace">${escapeHtml(replace)}</td>
      <td>
        <div class="toggle-wrap">
          ${renderToggle(active, `toggleReplace(event,'${userId}','${id}')`, `rep-toggle-${id}`)}
        </div>
        <button class="btn btn-ghost btn-sm mt-4" onclick="linkReplaceTasks('${userId}','${id}')">Vincular tasks</button>
      </td>
    </tr>
  `;
}

async function toggleReplace(event, userId, ruleId) {
  const chk = event.target;
  const prev = !chk.checked;
  try {
    await apiFetch(`/replace/${userId}/${ruleId}/toggle`, { method: 'POST' });
    showToast('Regra atualizada', 'success');
  } catch (e) {
    chk.checked = prev;
    showToast('Erro: ' + e.message, 'error');
  }
}

async function linkReplaceTasks(userId, ruleId) {
  const task_names = prompt('Nomes das tasks forward vinculadas (vÃ­rgula):', '');
  if (task_names == null) return;
  try {
    await apiFetch(`/replace/${userId}/${ruleId}/link`, { method: 'POST', body: JSON.stringify({ task_names }) });
    showToast('VÃ­nculos atualizados', 'success');
  } catch (e) {
    showToast('Erro: ' + e.message, 'error');
  }
}

// â”€â”€â”€ VIP Mover â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
async function loadVipTasks() {
  const tbody = $('vip-tbody');
  if (!tbody) return;
  tbody.innerHTML = renderSkeletonRows(4, 6);

  try {
    const data = await apiFetch('/vip/tasks');
    const tasks = Array.isArray(data) ? data : (data.tasks || []);

    if (!tasks.length) {
      tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;padding:40px;">
        <div class="empty-state"><div class="empty-icon">â­</div><p>Nenhuma tarefa VIP configurada</p></div>
      </td></tr>`;
      return;
    }

    tbody.innerHTML = tasks.map(renderVipRow).join('');
  } catch (e) {
    tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;color:var(--red);padding:20px;">${e.message}</td></tr>`;
    showToast('Erro ao carregar tarefas VIP: ' + e.message, 'error');
  }
}

function renderVipRow(task) {
  const id       = task.id || task.task_id || 'â€”';
  const name     = task.name || task.nome  || 'â€”';
  const channel  = task.channel || task.canal       || 'â€”';
  const category = task.category || task.categoria  || 'â€”';
  const freq     = task.frequency || task.frequencia || 'â€”';
  const active   = task.active || task.status === 'running' || false;

  return `
    <tr>
      <td>${name}</td>
      <td class="monospace text-sm">${channel}</td>
      <td><span class="badge badge-purple">${category}</span></td>
      <td>${freq}</td>
      <td>
        <div class="toggle-wrap">
          ${renderToggle(active, `toggleVip(event,'${id}')`, `vip-toggle-${id}`)}
          <span class="text-sm text-muted">${active ? 'Ativo' : 'Inativo'}</span>
        </div>
        <div class="btn-group mt-4">
          <button class="btn btn-ghost btn-sm" onclick="editVipTask('${id}','${channel}','${category}','${freq}')">âœ</button>
          <button class="btn btn-danger btn-sm" onclick="deleteVipTask('${id}')">ðŸ—‘</button>
        </div>
      </td>
    </tr>
  `;
}

async function toggleVip(event, taskId) {
  const chk = event.target;
  const prev = !chk.checked;
  try {
    const res = await apiFetch(`/vip/${taskId}/toggle`, { method: 'POST' });
    await waitForQueuedCommand(res);
    showToast(`Tarefa VIP ${chk.checked ? 'ativada' : 'desativada'}`, chk.checked ? 'success' : 'info');
    loadVipTasks();
  } catch (e) {
    chk.checked = prev;
    showToast('Erro: ' + e.message, 'error');
  }
}

async function createVipTask() {
  const name = prompt('Nome da tarefa VIP:'); if (!name) return;
  const channel_id = prompt('ID do canal origem:'); if (!channel_id) return;
  const category = prompt('Categoria:', 'VAZADOS') || 'VAZADOS';
  const frequency = prompt('FrequÃªncia (3x_day,2x_day,1x_day,every_other_day):', '1x_day') || '1x_day';
  try {
    await apiFetch('/vip/create', { method: 'POST', body: JSON.stringify({ name, channel_id, category, frequency }) });
    showToast('VIP task criada', 'success');
    loadVipTasks();
  } catch (e) { showToast('Erro: ' + e.message, 'error'); }
}

async function editVipTask(taskId, channel, category, freq) {
  const channel_id = prompt('ID do canal origem:', channel || ''); if (!channel_id) return;
  const newCategory = prompt('Categoria:', category || 'VAZADOS') || category;
  const frequency = prompt('FrequÃªncia:', freq || '1x_day') || freq;
  try {
    await apiFetch(`/vip/${taskId}`, { method: 'PATCH', body: JSON.stringify({ channel_id, category: newCategory, frequency }) });
    showToast('VIP task atualizada', 'success');
    loadVipTasks();
  } catch (e) { showToast('Erro: ' + e.message, 'error'); }
}

async function deleteVipTask(taskId) {
  if (!confirm('Excluir tarefa VIP?')) return;
  try {
    await apiFetch(`/vip/${taskId}`, { method: 'DELETE' });
    showToast('VIP task removida', 'success');
    loadVipTasks();
  } catch (e) { showToast('Erro: ' + e.message, 'error'); }
}

// â”€â”€â”€ Admin â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
async function loadAdminUsers() {
  const grid = $('admin-grid');
  if (!grid) return;
  grid.innerHTML = `<div style="grid-column:1/-1;text-align:center;padding:40px;">
    <span class="spinner"></span>
  </div>`;

  try {
    const data = await apiFetch('/admin/users');
    const users = Array.isArray(data) ? data : (data.users || []);

    if (!users.length) {
      grid.innerHTML = `<div style="grid-column:1/-1;">
        <div class="empty-state"><div class="empty-icon">ðŸ‘‘</div><p>Nenhum usuÃ¡rio no painel admin</p></div>
      </div>`;
      return;
    }

    grid.innerHTML = users.map(renderAdminUserCard).join('');
  } catch (e) {
    grid.innerHTML = `<div style="grid-column:1/-1;text-align:center;color:var(--red);padding:20px;">${e.message}</div>`;
    showToast('Erro ao carregar admin: ' + e.message, 'error');
  }
}

function renderAdminUserCard(user) {
  const id   = user.id || user.user_id || 'â€”';
  const name = user.username || user.phone || user.name || `User #${id}`;
  const role = user.role || (user.vip ? 'VIP' : 'FREE');
  const ban  = user.banned || user.is_banned || false;
  const initials = String(name).substring(0, 2).toUpperCase();

  return `
    <div class="admin-user-card">
      <div class="admin-avatar">${initials}</div>
      <div class="admin-info">
        <div class="aname">${name}</div>
        <div class="ameta">#${id} Â· ${ban ? '<span style="color:var(--red)">ðŸš« Banido</span>' : role}</div>
      </div>
      <div class="admin-actions">
        <button class="btn btn-warning btn-sm" onclick="setUserVip('${id}','VIP')" title="Tornar VIP">â­ VIP</button>
        <button class="btn btn-ghost btn-sm" onclick="setUserVip('${id}','FREE')" title="Tornar FREE">FREE</button>
        <button class="btn btn-danger btn-sm" onclick="banUser('${id}', ${ban})" title="${ban ? 'Desbanir' : 'Banir'}">
          ${ban ? 'âœ… Desbanir' : 'ðŸš« Banir'}
        </button>
      </div>
    </div>
  `;
}

async function setUserVip(userId, type) {
  try {
    await apiFetch(`/admin/users/${userId}/vip`, {
      method: 'POST',
      body: JSON.stringify({ sub_type: type === 'VIP' ? 'LIFETIME' : 'FREE' })
    });
    showToast(`UsuÃ¡rio #${userId} definido como ${type}`, 'success');
    loadAdminUsers();
  } catch (e) { showToast('Erro: ' + e.message, 'error'); }
}

async function banUser(userId, currentlyBanned) {
  const action = currentlyBanned ? 'desbanir' : 'banir';
  if (!confirm(`Deseja ${action} o usuÃ¡rio #${userId}?`)) return;
  try {
    await apiFetch(`/admin/users/${userId}/${currentlyBanned ? 'unban' : 'ban'}`, { method: 'POST' });
    showToast(`UsuÃ¡rio #${userId} ${currentlyBanned ? 'desbanido' : 'banido'}`, currentlyBanned ? 'success' : 'warning');
    loadAdminUsers();
  } catch (e) { showToast('Erro: ' + e.message, 'error'); }
}

// â”€â”€â”€ Logs WebSocket â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function connectLogs() {
  if (wsConnection && wsConnection.readyState === WebSocket.OPEN) return;

  updateLogStatus(false);
  const output = $('log-output');
  if (!output) return;

  try {
    const token = getToken();
    const baseWsUrl = getWsUrl();
    const wsUrl = token ? `${baseWsUrl}?token=${encodeURIComponent(token)}` : baseWsUrl;
    wsConnection = new WebSocket(wsUrl);

    wsConnection.onopen = () => {
      updateLogStatus(true);
      appendLog('[sistema] ConexÃ£o WebSocket estabelecida', 'success');
    };

    wsConnection.onmessage = (event) => {
      let text = event.data;
      try {
        const json = JSON.parse(text);
        text = json.message || json.log || json.text || JSON.stringify(json);
      } catch (_) {}
      appendLog(text);
    };

    wsConnection.onclose = (ev) => {
      updateLogStatus(false);
      appendLog(`[sistema] ConexÃ£o fechada (cÃ³digo: ${ev.code})`, 'warn');
      // Attempt reconnect after 5s if we're still on logs section
      setTimeout(() => {
        if (currentSection === 'logs' && isAuthenticated()) connectLogs();
      }, 5000);
    };

    wsConnection.onerror = (err) => {
      updateLogStatus(false);
      appendLog('[sistema] Erro na conexÃ£o WebSocket', 'error');
    };

  } catch (e) {
    appendLog(`[sistema] NÃ£o foi possÃ­vel conectar: ${e.message}`, 'error');
    updateLogStatus(false);
  }
}

function updateLogStatus(connected) {
  const dot = q('.log-dot');
  const label = $('log-status-label');
  if (dot) dot.className = `log-dot ${connected ? '' : 'disconnected'}`;
  if (label) label.textContent = connected ? 'Conectado Â· Stream ativo' : 'Desconectado';
}

function appendLog(text, forcedClass = null) {
  const output = $('log-output');
  if (!output) return;

  const now = new Date().toLocaleTimeString('pt-BR', { hour12: false });
  let cls = forcedClass || detectLogClass(text);
  if (currentLogFilter !== 'all' && cls !== currentLogFilter) return;

  const line = document.createElement('span');
  line.className = `log-line ${cls}`;
  line.innerHTML = `<span class="log-time">[${now}]</span>${escapeHtml(text)}`;

  logLines.push({ text, cls, time: now });
  if (logLines.length > 2000) logLines.shift();

  output.appendChild(line);

  if (logAutoScroll) {
    output.scrollTop = output.scrollHeight;
  }
}

function detectLogClass(text) {
  const t = text.toLowerCase();
  if (t.includes('error') || t.includes('erro') || t.includes('exception') || t.includes('traceback')) return 'error';
  if (t.includes('warn') || t.includes('aviso')) return 'warn';
  if (t.includes('success') || t.includes('sucesso') || t.includes('conectado') || t.includes('iniciado')) return 'success';
  if (t.includes('[sistema]') || t.includes('[system]')) return 'dim';
  return 'info';
}

function clearLogs() {
  const output = $('log-output');
  if (output) output.innerHTML = '';
  logLines = [];
}

function setLogFilter(filter) {
  currentLogFilter = filter;
  document.querySelectorAll('.log-filter-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.filter === filter);
  });
  // Re-render visible log lines
  const output = $('log-output');
  if (!output) return;
  output.innerHTML = '';
  logLines.forEach(l => {
    if (filter !== 'all' && l.cls !== filter) return;
    const line = document.createElement('span');
    line.className = `log-line ${l.cls}`;
    line.innerHTML = `<span class="log-time">[${l.time}]</span>${escapeHtml(l.text)}`;
    output.appendChild(line);
  });
  if (logAutoScroll) output.scrollTop = output.scrollHeight;
}

// â”€â”€â”€ Auto Refresh â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function startAutoRefresh() {
  if (autoRefreshTimer) clearInterval(autoRefreshTimer);
  autoRefreshTimer = setInterval(() => {
    if (document.visibilityState === 'hidden') return;
    if (currentSection !== 'logs') loadSection(currentSection);
    // Always update header stats
    apiFetch('/status').then(data => updateDashboardStats(data)).catch(() => {});
  }, 10000);
}

// â”€â”€â”€ Screens â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function showLoginScreen() {
  if (autoRefreshTimer) clearInterval(autoRefreshTimer);
  $('login-overlay').style.display = 'flex';
  $('app').style.display = 'none';
}

function showAppScreen() {
  $('login-overlay').style.display = 'none';
  $('app').style.display = 'flex';

  // Populate user chip
  try {
    const u = JSON.parse(localStorage.getItem(USER_KEY) || '{}');
    const nameEl = q('.user-info .name');
    const roleEl = q('.user-info .role');
    const avatarEl = q('.user-avatar');
    if (nameEl) nameEl.textContent = u.username || 'Admin';
    if (roleEl) roleEl.textContent = u.role || 'Administrador';
    if (avatarEl) avatarEl.textContent = (u.username || 'A').substring(0, 2).toUpperCase();
    
    // Esconder itens de menu admin
    const isAdmin = !!u.is_admin || u.role === 'Admin' || u.role === 'Administrador';
    document.querySelectorAll('.admin-only').forEach(el => {
      el.style.display = isAdmin ? '' : 'none';
    });
  } catch (_) {}

  ensureSectionActions();
  navigateTo('dashboard');
  startAutoRefresh();
}

// â”€â”€â”€ Mobile sidebar â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function openMobileSidebar() {
  $('sidebar').classList.add('open');
  $('sidebar-overlay').style.display = 'block';
}

function closeMobileSidebar() {
  $('sidebar').classList.remove('open');
  $('sidebar-overlay').style.display = 'none';
}

// â”€â”€â”€ Utility â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function getCurrentUser() {
  try { return JSON.parse(localStorage.getItem(USER_KEY) || '{}'); }
  catch (_) { return {}; }
}

function getCurrentUserId() {
  const u = getCurrentUser();
  const uid = u.user_id || u.id;
  if (!uid) throw new Error('Sessao sem usuario. Faca login novamente.');
  return uid;
}

function ensureSectionActions() {
  const cfg = [
    { id: 'section-forward', label: 'Novo Forward', fn: 'createForwardTask' },
    { id: 'section-clone', label: 'Novo Clone', fn: 'createCloneTask' },
    { id: 'section-forwarder', label: 'Nova Encaminhadora', fn: 'createForwarderTask' },
    { id: 'section-vip', label: 'Nova VIP Task', fn: 'createVipTask' }
  ];
  cfg.forEach(c => {
    const section = $(c.id);
    if (!section || section.querySelector(`.web-action-${c.fn}`)) return;
    const header = section.querySelector('.section-header');
    if (!header) return;
    const el = document.createElement('div');
    el.className = `web-action-${c.fn}`;
    el.innerHTML = `<button class="btn btn-primary btn-sm" onclick="${c.fn}()">${c.label}</button>`;
    header.appendChild(el);
  });
}

// â”€â”€â”€ Login Form Handler â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function normalizeApiBase(value) {
  let base = String(value || '').trim();
  if (!base) return '';
  base = base.replace(/\/+$/, '');
  if (!base.endsWith('/api')) base += '/api';
  return base;
}

function initApiConfig() {
  const toggle = $('api-config-toggle');
  const panel = $('api-config-panel');
  const input = $('api-base-input');
  const save = $('api-base-save');
  const clear = $('api-base-clear');
  if (!toggle || !panel || !input || !save || !clear) return;

  input.value = CONFIG_API_BASE || SAVED_ACTIVE_API_BASE || activeApiBase || '';
  toggle.addEventListener('click', () => {
    panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
  });
  save.addEventListener('click', () => {
    const base = normalizeApiBase(input.value);
    if (!base) return;
    localStorage.setItem('tgpanel_api_base', base);
    localStorage.setItem(API_ACTIVE_KEY, base);
    activeApiBase = base;
    const errEl = $('login-error');
    if (errEl) {
      errEl.textContent = `API salva: ${base}. Tente entrar novamente.`;
      errEl.style.display = 'block';
    }
  });
  clear.addEventListener('click', () => {
    localStorage.removeItem('tgpanel_api_base');
    localStorage.removeItem(API_ACTIVE_KEY);
    input.value = '';
    activeApiBase = API_BASE;
    const errEl = $('login-error');
    if (errEl) {
      errEl.textContent = 'API manual removida. Recarregue a pagina e tente novamente.';
      errEl.style.display = 'block';
    }
  });
}

function initLoginForm() {
  const form    = $('login-form');
  const errEl   = $('login-error');
  const btn     = $('login-btn');
  const btnText = $('login-btn-text');
  const btnSpin = $('login-btn-spinner');

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    errEl.style.display = 'none';

    const user = $('login-user').value.trim();
    const pass = $('login-pass').value;

    if (!user || !pass) {
      errEl.textContent = 'Preencha todos os campos';
      errEl.style.display = 'block';
      return;
    }

    btn.disabled = true;
    if (btnText) btnText.textContent = 'Entrando...';
    if (btnSpin) btnSpin.style.display = 'inline-block';

    try {
      await login(user, pass);
      showToast('Login realizado com sucesso!', 'success');
      showAppScreen();
    } catch (err) {
      errEl.textContent = err.message || 'Credenciais invalidas';
      errEl.style.display = 'block';
    } finally {
      btn.disabled = false;
      if (btnText) btnText.textContent = 'Entrar';
      if (btnSpin) btnSpin.style.display = 'none';
    }
  });
}

// â”€â”€â”€ Init â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
document.addEventListener('DOMContentLoaded', () => {
  initApiConfig();
  initLoginForm();

  // Nav items
  document.querySelectorAll('.nav-item[data-section]').forEach(item => {
    item.addEventListener('click', () => navigateTo(item.dataset.section));
  });

  // Logout button
  const logoutBtn = $('logout-btn');
  if (logoutBtn) logoutBtn.addEventListener('click', logout);

  // Hamburger
  const hamBtn = $('hamburger-btn');
  if (hamBtn) hamBtn.addEventListener('click', openMobileSidebar);

  // Sidebar overlay
  const overlay = $('sidebar-overlay');
  if (overlay) overlay.addEventListener('click', closeMobileSidebar);

  // Log auto-scroll toggle
  const logOutput = $('log-output');
  if (logOutput) {
    logOutput.addEventListener('scroll', () => {
      const nearBottom = logOutput.scrollHeight - logOutput.scrollTop - logOutput.clientHeight < 60;
      logAutoScroll = nearBottom;
    });
  }

  // Log filter buttons
  document.querySelectorAll('.log-filter-btn').forEach(btn => {
    btn.addEventListener('click', () => setLogFilter(btn.dataset.filter));
  });

  // Clear logs button
  const clearBtn = $('clear-logs-btn');
  if (clearBtn) clearBtn.addEventListener('click', clearLogs);

  // Reconnect logs button
  const reconnectBtn = $('reconnect-logs-btn');
  if (reconnectBtn) reconnectBtn.addEventListener('click', () => {
    if (wsConnection) wsConnection.close();
    wsConnection = null;
    connectLogs();
  });

  // Check auth
  if (isAuthenticated()) {
    refreshCurrentUser()
      .then(() => showAppScreen())
      .catch(() => {
        clearAuth();
        showLoginScreen();
      });
  } else {
    showLoginScreen();
  }
});
