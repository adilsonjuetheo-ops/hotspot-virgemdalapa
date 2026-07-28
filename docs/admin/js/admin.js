const API = '';
const IS_DEMO = !window.location.hostname.match(/^\d+\.\d+\.\d+\.\d+$/) && window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1';
let token = IS_DEMO ? 'demo-token' : localStorage.getItem('virgemlapa_token');
let adminUsername = localStorage.getItem('virgemlapa_admin') || 'Admin';
let currentPage = 1;
let searchTimeout = null;
let leadsChart = null;

// ===================== AUTH =====================
async function doLogin() {
  const username = document.getElementById('login-user').value.trim();
  const password = document.getElementById('login-pass').value;
  if (!username || !password) return showLoginAlert('error', 'Preencha usuário e senha.');

  const btn = document.getElementById('login-btn');
  btn.disabled = true;
  btn.innerHTML = '<span style="display:inline-block;width:18px;height:18px;border:3px solid rgba(255,255,255,0.3);border-top-color:white;border-radius:50%;animation:spin 0.8s linear infinite;vertical-align:middle;margin-right:8px;"></span>Entrando...';

  try {
    const resp = await apiFetch('/api/auth/login', 'POST', { username, password }, false);
    token = resp.token;
    adminUsername = resp.username;
    localStorage.setItem('virgemlapa_token', token);
    localStorage.setItem('virgemlapa_admin', adminUsername);
    showAdminApp();
  } catch (err) {
    showLoginAlert('error', err.message || 'Credenciais inválidas.');
  } finally {
    btn.disabled = false;
    btn.innerHTML = 'Entrar';
  }
}

function showLoginAlert(type, msg) {
  document.getElementById('login-alert').innerHTML = `<div class="alert alert-${type}">${msg}</div>`;
}

function logout() {
  localStorage.removeItem('virgemlapa_token');
  localStorage.removeItem('virgemlapa_admin');
  location.reload();
}

// ===================== APP =====================
function showAdminApp() {
  document.getElementById('login-page').classList.add('hidden');
  document.getElementById('admin-app').classList.remove('hidden');
  document.getElementById('admin-name-display').textContent = adminUsername;
  document.getElementById('admin-avatar').textContent = adminUsername[0].toUpperCase();
  navigate('dashboard');
}

const PAGE_TITLES = {
  'dashboard': 'Dashboard',
  'leads': 'Leads Captados',
  'sessions': 'Sessões',
  'portal-settings': 'Portal Wi-Fi',
  'mikrotik-settings': 'MikroTik',
  'account-settings': 'Minha Conta'
};

function navigate(page) {
  document.querySelectorAll('.nav-item').forEach(el => {
    el.classList.toggle('active', el.getAttribute('onclick')?.includes(`'${page}'`));
  });
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.getElementById(`page-${page}`)?.classList.add('active');
  document.getElementById('topbar-title').textContent = PAGE_TITLES[page] || page;
  closeSidebar();

  if (page === 'dashboard') loadDashboard();
  else if (page === 'leads') loadLeads();
  else if (page === 'sessions') loadSessions();
  else if (page.includes('settings')) loadSettings();
}

// ===================== DASHBOARD =====================
async function loadDashboard() {
  try {
    const data = await apiFetch('/api/admin/dashboard');
    document.getElementById('stat-total').textContent = data.totalLeads;
    document.getElementById('stat-today').textContent = data.todayLeads;
    document.getElementById('stat-month').textContent = data.thisMonthLeads;
    document.getElementById('stat-sessions').textContent = data.totalSessions;
    renderChart(data.dailyLeads);
    loadRecentLeads();
  } catch (err) {
    showAlert('dashboard-alert', 'error', 'Erro ao carregar dashboard: ' + err.message);
  }
}

function renderChart(dailyData) {
  const labels = [], values = [];
  const today = new Date();
  for (let i = 6; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const key = d.toISOString().slice(0, 10);
    labels.push(formatDateBR(key));
    const found = dailyData.find(r => r.date === key);
    values.push(found ? found.count : 0);
  }
  const ctx = document.getElementById('leadsChart').getContext('2d');
  if (leadsChart) leadsChart.destroy();
  leadsChart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        label: 'Leads',
        data: values,
        backgroundColor: 'rgba(255,158,51,0.18)',
        borderColor: '#e07a0b',
        borderWidth: 2,
        borderRadius: 6,
        borderSkipped: false
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        y: { beginAtZero: true, ticks: { stepSize: 1 } },
        x: { grid: { display: false } }
      }
    }
  });
}

async function loadRecentLeads() {
  try {
    const data = await apiFetch('/api/admin/leads?limit=5&page=1');
    const tbody = document.getElementById('recent-leads-body');
    if (!data.leads.length) {
      tbody.innerHTML = '<tr><td colspan="4"><div class="empty-state"><div class="icon">👥</div><p>Nenhum lead captado ainda.</p></div></td></tr>';
      return;
    }
    tbody.innerHTML = data.leads.map(l => `
      <tr>
        <td><strong>${l.name || '—'}</strong></td>
        <td>${formatPhone(l.phone)}</td>
        <td class="td-muted">${formatDate(l.created_at)}</td>
        <td class="td-muted">${l.mac_address || '—'}</td>
      </tr>
    `).join('');
  } catch (_) {}
}

// ===================== LEADS =====================
async function loadLeads() {
  const search = document.getElementById('search-leads')?.value || '';
  const startDate = document.getElementById('filter-start')?.value || '';
  const endDate = document.getElementById('filter-end')?.value || '';
  const params = new URLSearchParams({ page: currentPage, limit: 50, search, startDate, endDate });

  try {
    const data = await apiFetch(`/api/admin/leads?${params}`);
    const tbody = document.getElementById('leads-body');
    if (!data.leads.length) {
      tbody.innerHTML = '<tr><td colspan="7"><div class="empty-state"><div class="icon">👥</div><p>Nenhum lead encontrado.</p></div></td></tr>';
    } else {
      tbody.innerHTML = data.leads.map(l => `
        <tr>
          <td class="td-muted">#${l.id}</td>
          <td><strong>${l.name || '—'}</strong></td>
          <td>${formatPhone(l.phone)}</td>
          <td class="td-muted">${l.email || '—'}</td>
          <td class="td-muted">${l.mac_address || '—'}</td>
          <td class="td-muted">${formatDate(l.created_at)}</td>
          <td><button class="btn btn-ghost btn-sm" onclick="deleteLead(${l.id})" title="Remover">🗑️</button></td>
        </tr>
      `).join('');
    }
    const totalPages = Math.ceil(data.total / 50);
    document.getElementById('pagination-info').textContent = `${data.total} leads | Página ${currentPage} de ${totalPages || 1}`;
    document.getElementById('btn-prev').disabled = currentPage <= 1;
    document.getElementById('btn-next').disabled = currentPage >= totalPages;
  } catch (err) {
    document.getElementById('leads-body').innerHTML = `<tr><td colspan="7"><div class="alert alert-error">${err.message}</div></td></tr>`;
  }
}

function debounceSearch() {
  clearTimeout(searchTimeout);
  searchTimeout = setTimeout(() => { currentPage = 1; loadLeads(); }, 400);
}

function changePage(delta) { currentPage += delta; loadLeads(); }

function clearFilters() {
  document.getElementById('search-leads').value = '';
  document.getElementById('filter-start').value = '';
  document.getElementById('filter-end').value = '';
  currentPage = 1;
  loadLeads();
}

async function deleteLead(id) {
  if (!confirm('Remover este lead? Esta ação não pode ser desfeita.')) return;
  try {
    await apiFetch(`/api/admin/leads/${id}`, 'DELETE');
    loadLeads();
  } catch (err) { alert('Erro: ' + err.message); }
}

async function exportLeads() {
  try {
    const resp = await fetch(`${API}/api/admin/leads/export`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (!resp.ok) throw new Error('Erro ao exportar');
    const blob = await resp.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `leads_virgem_da_lapa_${new Date().toISOString().slice(0,10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  } catch (err) { alert(err.message); }
}

// ===================== SESSIONS =====================
async function loadSessions() {
  try {
    const data = await apiFetch('/api/admin/sessions');
    const activeBody = document.getElementById('active-sessions-body');
    if (!data.activeSessions.length) {
      activeBody.innerHTML = '<tr><td colspan="5"><div class="empty-state" style="padding:20px;"><p>Nenhuma sessão ativa no MikroTik.</p></div></td></tr>';
    } else {
      activeBody.innerHTML = data.activeSessions.map(s => `
        <tr>
          <td><strong>${s.user || '—'}</strong></td>
          <td class="td-muted">${s['mac-address'] || '—'}</td>
          <td class="td-muted">${s.address || '—'}</td>
          <td class="td-muted">${s.uptime || '—'}</td>
          <td><button class="btn btn-danger btn-sm" onclick="kickUser('${s['mac-address']}')">Desconectar</button></td>
        </tr>
      `).join('');
    }
    const histBody = document.getElementById('sessions-history-body');
    if (!data.sessions.length) {
      histBody.innerHTML = '<tr><td colspan="5"><div class="empty-state" style="padding:20px;"><p>Nenhuma sessão registrada.</p></div></td></tr>';
    } else {
      histBody.innerHTML = data.sessions.map(s => `
        <tr>
          <td><strong>${s.name || '—'}</strong></td>
          <td>${formatPhone(s.phone || '')}</td>
          <td class="td-muted">${s.mac_address || '—'}</td>
          <td class="td-muted">${s.ip_address || '—'}</td>
          <td class="td-muted">${formatDate(s.started_at)}</td>
        </tr>
      `).join('');
    }
  } catch (err) {
    document.getElementById('active-sessions-body').innerHTML = `<tr><td colspan="5"><div class="alert alert-error">${err.message}</div></td></tr>`;
  }
}

async function kickUser(mac) {
  if (!confirm(`Desconectar ${mac}?`)) return;
  try {
    await apiFetch(`/api/admin/sessions/${encodeURIComponent(mac)}`, 'DELETE');
    loadSessions();
  } catch (err) { alert('Erro: ' + err.message); }
}

// ===================== SETTINGS =====================
async function loadSettings() {
  try {
    const settings = await apiFetch('/api/admin/settings');
    Object.entries(settings).forEach(([key, value]) => {
      const el = document.getElementById(`setting-${key}`);
      if (el) el.value = value;
    });
  } catch (_) {}
}

async function saveSettings(alertPrefix, keys) {
  const data = {};
  keys.forEach(key => {
    const el = document.getElementById(`setting-${key}`);
    if (el) data[key] = el.value;
  });
  try {
    await apiFetch('/api/admin/settings', 'PUT', data);
    showAlert(`${alertPrefix}-alert`, 'success', '✅ Configurações salvas com sucesso!');
  } catch (err) {
    showAlert(`${alertPrefix}-alert`, 'error', 'Erro: ' + err.message);
  }
}

async function testMikrotik() {
  const btn = event.currentTarget;
  btn.disabled = true; btn.textContent = '⏳ Testando...';
  try {
    const data = await apiFetch('/api/admin/mikrotik/test', 'POST');
    if (data.success) showAlert('mikrotik-alert', 'success', `✅ Conectado! Identidade: ${data.identity}`);
    else showAlert('mikrotik-alert', 'error', `❌ Falha: ${data.error}`);
  } catch (err) {
    showAlert('mikrotik-alert', 'error', 'Erro: ' + err.message);
  } finally {
    btn.disabled = false; btn.textContent = '🔌 Testar Conexão';
  }
}

async function changePassword() {
  const currentPassword = document.getElementById('current-password').value;
  const newPassword = document.getElementById('new-password').value;
  const confirmPassword = document.getElementById('confirm-password').value;
  if (!currentPassword || !newPassword) return showAlert('account-alert', 'error', 'Preencha todos os campos.');
  if (newPassword !== confirmPassword) return showAlert('account-alert', 'error', 'As senhas não coincidem.');
  if (newPassword.length < 6) return showAlert('account-alert', 'error', 'Senha deve ter pelo menos 6 caracteres.');
  try {
    await apiFetch('/api/auth/change-password', 'POST', { currentPassword, newPassword });
    showAlert('account-alert', 'success', '✅ Senha alterada com sucesso!');
    ['current-password','new-password','confirm-password'].forEach(id => document.getElementById(id).value = '');
  } catch (err) {
    showAlert('account-alert', 'error', 'Erro: ' + err.message);
  }
}

// ===================== API / DEMO =====================
async function apiFetch(url, method = 'GET', body = null, useAuth = true) {
  if (IS_DEMO) return demoResponse(url, method);
  const headers = { 'Content-Type': 'application/json' };
  if (useAuth && token) headers['Authorization'] = `Bearer ${token}`;
  const opts = { method, headers };
  if (body) opts.body = JSON.stringify(body);
  const resp = await fetch(`${API}${url}`, opts);
  if (resp.status === 401) { logout(); throw new Error('Sessão expirada.'); }
  const data = await resp.json();
  if (!resp.ok) throw new Error(data.error || 'Erro desconhecido');
  return data;
}

async function demoResponse(url) {
  await new Promise(r => setTimeout(r, 380));
  if (url.includes('/auth/login')) return { token: 'demo', username: 'admin' };
  if (url.includes('/dashboard')) return {
    totalLeads: 183, todayLeads: 9, thisMonthLeads: 67, totalSessions: 141,
    dailyLeads: [
      {date: new Date(Date.now()-6*86400000).toISOString().slice(0,10), count: 6},
      {date: new Date(Date.now()-5*86400000).toISOString().slice(0,10), count: 12},
      {date: new Date(Date.now()-4*86400000).toISOString().slice(0,10), count: 8},
      {date: new Date(Date.now()-3*86400000).toISOString().slice(0,10), count: 15},
      {date: new Date(Date.now()-2*86400000).toISOString().slice(0,10), count: 5},
      {date: new Date(Date.now()-1*86400000).toISOString().slice(0,10), count: 14},
      {date: new Date().toISOString().slice(0,10), count: 9}
    ]
  };
  if (url.includes('/leads')) return { total: 183, page: 1, limit: 50, leads: [
    {id:1, name:'João Silva',    phone:'38988090001', email:'joao@email.com',  mac_address:'AA:BB:CC:DD:EE:01', created_at:'2026-06-21T08:12:00'},
    {id:2, name:'Maria Oliveira',phone:'38988090002', email:'',               mac_address:'AA:BB:CC:DD:EE:02', created_at:'2026-06-21T08:45:00'},
    {id:3, name:'Pedro Santos',  phone:'38988090003', email:'pedro@email.com', mac_address:'AA:BB:CC:DD:EE:03', created_at:'2026-06-21T09:00:00'},
    {id:4, name:'Ana Costa',     phone:'38988090004', email:'',               mac_address:'AA:BB:CC:DD:EE:04', created_at:'2026-06-21T09:30:00'},
    {id:5, name:'Carlos Lima',   phone:'38988090005', email:'carlos@email.com',mac_address:'AA:BB:CC:DD:EE:05', created_at:'2026-06-21T10:05:00'},
  ]};
  if (url.includes('/sessions')) return {
    activeSessions: [
      {user:'lead_38988090001', 'mac-address':'AA:BB:CC:DD:EE:01', address:'192.168.10.21', uptime:'00:18:34'},
      {user:'lead_38988090003', 'mac-address':'AA:BB:CC:DD:EE:03', address:'192.168.10.23', uptime:'00:04:11'},
    ],
    sessions: [
      {name:'João Silva',    phone:'38988090001', mac_address:'AA:BB:CC:DD:EE:01', ip_address:'192.168.10.21', started_at:'2026-06-21T08:12:00'},
      {name:'Maria Oliveira',phone:'38988090002', mac_address:'AA:BB:CC:DD:EE:02', ip_address:'192.168.10.22', started_at:'2026-06-21T08:45:00'},
    ]
  };
  if (url.includes('/settings')) return {
    hotspot_title:'Wi-Fi Grátis Prefeitura de Virgem da Lapa', hotspot_subtitle:'Conecte-se e aproveite a internet pública da Prefeitura!',
    hotspot_free_time:'60', require_name:'1', require_email:'0',
    mikrotik_host:'192.168.88.1', mikrotik_port:'8728',
    mikrotik_user:'admin', mikrotik_hotspot_server:'hotspot1'
  };
  if (url.includes('/mikrotik/test')) return { success: true, identity: 'VIRGEMLAPA-RB' };
  if (url.includes('/auth/change-password')) return { success: true };
  return { success: true };
}

// ===================== UTILS =====================
function showAlert(containerId, type, message) {
  const el = document.getElementById(containerId);
  if (!el) return;
  el.innerHTML = `<div class="alert alert-${type}">${message}</div>`;
  setTimeout(() => { el.innerHTML = ''; }, 5000);
}

function formatPhone(phone) {
  if (!phone) return '—';
  const d = phone.replace(/\D/g, '');
  if (d.length === 11) return `(${d.slice(0,2)}) ${d.slice(2,7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0,2)}) ${d.slice(2,6)}-${d.slice(6)}`;
  return phone;
}

function formatDate(dt) {
  if (!dt) return '—';
  return new Date(dt).toLocaleString('pt-BR', {day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'});
}

function formatDateBR(isoDate) {
  const [,m,d] = isoDate.split('-');
  return `${d}/${m}`;
}

function toggleSidebar() {
  document.getElementById('sidebar').classList.toggle('open');
  document.getElementById('sidebar-overlay').classList.toggle('open');
}

function closeSidebar() {
  document.getElementById('sidebar').classList.remove('open');
  document.getElementById('sidebar-overlay').classList.remove('open');
}

document.addEventListener('DOMContentLoaded', () => {
  if (token) showAdminApp();
  document.getElementById('login-pass')?.addEventListener('keydown', e => {
    if (e.key === 'Enter') doLogin();
  });
});
