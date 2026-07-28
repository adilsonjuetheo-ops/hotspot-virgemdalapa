const API = '';
const IS_DEMO = window.location.hostname.endsWith('github.io');
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
  'routers': 'MikroTiks',
  'portal-settings': 'Portal Wi-Fi',
  'account-settings': 'Minha Conta'
};

function navigate(page) {
  // Atualiza nav
  document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
  event?.currentTarget?.classList.add('active');
  document.querySelectorAll('.nav-item').forEach(el => {
    if (el.getAttribute('onclick')?.includes(`'${page}'`)) el.classList.add('active');
  });

  // Mostra página
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.getElementById(`page-${page}`)?.classList.add('active');
  document.getElementById('topbar-title').textContent = PAGE_TITLES[page] || page;

  closeSidebar();

  // Carrega dados
  if (page === 'dashboard') loadDashboard();
  else if (page === 'leads') loadLeads();
  else if (page === 'sessions') loadSessions();
  else if (page === 'routers') loadRouters();
  else if (page.includes('settings')) loadSettings(page);
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
  const labels = [];
  const values = [];
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
        backgroundColor: 'rgba(201,24,24,0.15)',
        borderColor: '#c91818',
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
          <td><strong>${l.name || '—'}</strong>${l.router_name ? `<br><span class="td-muted" style="font-size:12px;">📡 ${l.router_name}</span>` : ''}</td>
          <td>${formatPhone(l.phone)}</td>
          <td class="td-muted">${l.email || '—'}</td>
          <td class="td-muted">${l.mac_address || '—'}</td>
          <td class="td-muted">${formatDate(l.created_at)}</td>
          <td style="white-space:nowrap;">
            <a class="btn btn-sm btn-whatsapp" href="https://wa.me/55${l.phone}" target="_blank" rel="noopener" title="Conversar com ${l.name || 'o cliente'} no WhatsApp">
              <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413Z"/></svg>
              Conectar com o cliente
            </a>
            <button class="btn btn-ghost btn-sm" onclick="deleteLead(${l.id})" title="Remover">🗑️</button>
          </td>
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

function changePage(delta) {
  currentPage += delta;
  loadLeads();
}

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
  } catch (err) {
    alert('Erro: ' + err.message);
  }
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
    a.download = `leads_virgemdalapa_${new Date().toISOString().slice(0,10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  } catch (err) {
    alert(err.message);
  }
}

// ===================== SESSIONS =====================
async function loadSessions() {
  try {
    const data = await apiFetch('/api/admin/sessions');

    // Ativas no MikroTik
    const activeBody = document.getElementById('active-sessions-body');
    if (!data.activeSessions.length) {
      activeBody.innerHTML = '<tr><td colspan="5"><div class="empty-state" style="padding:20px;"><p>Nenhuma sessão ativa no MikroTik.</p></div></td></tr>';
    } else {
      activeBody.innerHTML = data.activeSessions.map(s => `
        <tr>
          <td><strong>${s.user || '—'}</strong>${s.router_name ? ` <span class="td-muted">· ${s.router_name}</span>` : ''}</td>
          <td class="td-muted">${s['mac-address'] || '—'}</td>
          <td class="td-muted">${s.address || '—'}</td>
          <td class="td-muted">${s.uptime || '—'}</td>
          <td>
            <button class="btn btn-danger btn-sm" onclick="kickUser('${s['mac-address']}')">Desconectar</button>
          </td>
        </tr>
      `).join('');
    }

    // Histórico
    const histBody = document.getElementById('sessions-history-body');
    if (!data.sessions.length) {
      histBody.innerHTML = '<tr><td colspan="5"><div class="empty-state" style="padding:20px;"><p>Nenhuma sessão registrada.</p></div></td></tr>';
    } else {
      histBody.innerHTML = data.sessions.map(s => `
        <tr>
          <td><strong>${s.name || '—'}</strong>${s.router_name ? ` <span class="td-muted">· ${s.router_name}</span>` : ''}</td>
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
  } catch (err) {
    alert('Erro: ' + err.message);
  }
}

// ===================== ROTEADORES (MULTI-MIKROTIK) =====================
async function loadRouters() {
  try {
    const data = await apiFetch('/api/admin/routers');
    const tbody = document.getElementById('routers-body');
    if (!data.routers.length) {
      tbody.innerHTML = '<tr><td colspan="6"><div class="empty-state"><div class="icon">📡</div><p>Nenhum MikroTik cadastrado.</p></div></td></tr>';
      return;
    }
    tbody.innerHTML = data.routers.map(r => `
      <tr style="${r.active ? '' : 'opacity:0.5;'}">
        <td><strong>${r.name}</strong>${r.active ? '' : ' <span class="td-muted">(desativado)</span>'}</td>
        <td class="td-muted">${r.host}:${r.port}</td>
        <td class="td-muted">${r.hotspot_server}</td>
        <td class="td-muted" id="router-status-${r.id}">—</td>
        <td style="white-space:nowrap;">
          <button class="btn btn-outline btn-sm" onclick="testRouter(${r.id})">🔌 Testar</button>
          <button class="btn btn-ghost btn-sm" onclick="toggleRouter(${r.id}, ${r.active ? 0 : 1})" title="${r.active ? 'Desativar' : 'Ativar'}">${r.active ? '⏸️' : '▶️'}</button>
          <button class="btn btn-ghost btn-sm" onclick="deleteRouter(${r.id})" title="Remover">🗑️</button>
        </td>
        <td class="td-muted">${r.id}</td>
      </tr>
    `).join('');
  } catch (err) {
    showAlert('routers-alert', 'error', 'Erro: ' + err.message);
  }
}

async function addRouter() {
  const data = {
    name: document.getElementById('router-name').value.trim(),
    host: document.getElementById('router-host').value.trim(),
    port: document.getElementById('router-port').value || 8728,
    username: document.getElementById('router-user').value.trim(),
    password: document.getElementById('router-pass').value,
    hotspot_server: document.getElementById('router-server').value.trim() || 'hotspot1',
    user_profile: document.getElementById('router-profile').value.trim() || 'virgemdalapa-default'
  };
  if (!data.name || !data.host || !data.username || !data.password) {
    return showAlert('routers-alert', 'error', 'Preencha nome, IP, usuário e senha.');
  }
  try {
    const resp = await apiFetch('/api/admin/routers', 'POST', data);
    showAlert('routers-alert', 'success', `✅ MikroTik "${data.name}" cadastrado! Página de login para este roteador: <strong>/mikrotik-login/${resp.id}</strong> — veja as instruções abaixo.`);
    ['router-name','router-host','router-user','router-pass','router-server','router-profile'].forEach(id => document.getElementById(id).value = '');
    document.getElementById('router-port').value = '';
    loadRouters();
  } catch (err) {
    showAlert('routers-alert', 'error', 'Erro: ' + err.message);
  }
}

async function testRouter(id) {
  const cell = document.getElementById(`router-status-${id}`);
  cell.textContent = '⏳ testando...';
  try {
    const data = await apiFetch(`/api/admin/routers/${id}/test`, 'POST');
    cell.innerHTML = data.success
      ? `<span style="color:#1f9d55;">✅ ${data.identity}</span>`
      : `<span style="color:#d64545;">❌ ${data.error}</span>`;
  } catch (err) {
    cell.innerHTML = `<span style="color:#d64545;">❌ ${err.message}</span>`;
  }
}

async function toggleRouter(id, active) {
  try {
    await apiFetch(`/api/admin/routers/${id}`, 'PUT', { active });
    loadRouters();
  } catch (err) {
    showAlert('routers-alert', 'error', 'Erro: ' + err.message);
  }
}

async function deleteRouter(id) {
  if (!confirm('Remover este MikroTik? Os leads capturados por ele são mantidos.')) return;
  try {
    await apiFetch(`/api/admin/routers/${id}`, 'DELETE');
    loadRouters();
  } catch (err) {
    showAlert('routers-alert', 'error', 'Erro: ' + err.message);
  }
}

// ===================== SETTINGS =====================
async function loadSettings() {
  try {
    const settings = await apiFetch('/api/admin/settings');
    Object.entries(settings).forEach(([key, value]) => {
      const el = document.getElementById(`setting-${key}`);
      if (el) el.value = value;
    });
    // Campo de validade do OTP só faz sentido com SMS ativado
    const otpGroup = document.getElementById('otp-expiry-group');
    if (otpGroup) otpGroup.style.display = settings.otp_enabled === '1' ? '' : 'none';
  } catch (_) {}
}

async function saveSettings(alertPrefix, keys) {
  const data = {};
  keys.forEach(key => {
    const el = document.getElementById(`setting-${key}`);
    if (el) data[key] = el.value;
  });

  try {
    const resp = await apiFetch('/api/admin/settings', 'PUT', data);
    showAlert(`${alertPrefix}-alert`, 'success', '✅ ' + (resp.message || 'Configurações salvas com sucesso!'));
  } catch (err) {
    showAlert(`${alertPrefix}-alert`, 'error', 'Erro: ' + err.message);
  }
}

async function testMikrotik() {
  const btn = event.currentTarget;
  btn.disabled = true;
  btn.textContent = '⏳ Testando...';
  try {
    const data = await apiFetch('/api/admin/mikrotik/test', 'POST');
    if (data.success) {
      showAlert('mikrotik-alert', 'success', `✅ Conectado! Identidade: ${data.identity}`);
    } else {
      showAlert('mikrotik-alert', 'error', `❌ Falha: ${data.error}`);
    }
  } catch (err) {
    showAlert('mikrotik-alert', 'error', 'Erro: ' + err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = '🔌 Testar Conexão';
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
    document.getElementById('current-password').value = '';
    document.getElementById('new-password').value = '';
    document.getElementById('confirm-password').value = '';
  } catch (err) {
    showAlert('account-alert', 'error', 'Erro: ' + err.message);
  }
}

// ===================== UTILS =====================
async function apiFetch(url, method = 'GET', body = null, useAuth = true) {
  // Modo demonstração para GitHub Pages
  if (IS_DEMO) return demoResponse(url, method, body);

  const headers = { 'Content-Type': 'application/json' };
  if (useAuth && token) headers['Authorization'] = `Bearer ${token}`;

  const opts = { method, headers };
  if (body) opts.body = JSON.stringify(body);

  const resp = await fetch(`${API}${url}`, opts);

  if (resp.status === 401) {
    logout();
    throw new Error('Sessão expirada. Faça login novamente.');
  }

  const data = await resp.json();
  if (!resp.ok) throw new Error(data.error || 'Erro desconhecido');
  return data;
}

async function demoResponse(url) {
  await new Promise(r => setTimeout(r, 400));
  {
    if (url.includes('/auth/login')) return { token: 'demo', username: 'admin' };
    if (url.includes('/dashboard')) return {
      totalLeads: 247, todayLeads: 12, thisMonthLeads: 89, totalSessions: 198,
      dailyLeads: [
        {date: new Date(Date.now()-6*86400000).toISOString().slice(0,10), count: 8},
        {date: new Date(Date.now()-5*86400000).toISOString().slice(0,10), count: 15},
        {date: new Date(Date.now()-4*86400000).toISOString().slice(0,10), count: 11},
        {date: new Date(Date.now()-3*86400000).toISOString().slice(0,10), count: 20},
        {date: new Date(Date.now()-2*86400000).toISOString().slice(0,10), count: 7},
        {date: new Date(Date.now()-1*86400000).toISOString().slice(0,10), count: 18},
        {date: new Date().toISOString().slice(0,10), count: 12}
      ]
    };
    if (url.includes('/leads/export')) return {};
    if (url.includes('/leads')) return { total: 247, page: 1, limit: 50, leads: [
      {id:1, name:'João Silva', phone:'38988090001', email:'joao@email.com', mac_address:'AA:BB:CC:DD:EE:01', ip_address:'192.168.10.21', created_at:'2026-06-13T10:30:00'},
      {id:2, name:'Maria Oliveira', phone:'38988090002', email:'', mac_address:'AA:BB:CC:DD:EE:02', ip_address:'192.168.10.22', created_at:'2026-06-13T10:45:00'},
      {id:3, name:'Pedro Santos', phone:'38988090003', email:'pedro@email.com', mac_address:'AA:BB:CC:DD:EE:03', ip_address:'192.168.10.23', created_at:'2026-06-13T11:00:00'},
      {id:4, name:'Ana Costa', phone:'38988090004', email:'', mac_address:'AA:BB:CC:DD:EE:04', ip_address:'192.168.10.24', created_at:'2026-06-13T11:15:00'},
      {id:5, name:'Carlos Lima', phone:'38988090005', email:'carlos@email.com', mac_address:'AA:BB:CC:DD:EE:05', ip_address:'192.168.10.25', created_at:'2026-06-13T11:30:00'},
    ]};
    if (url.includes('/sessions')) return {
      activeSessions: [
        {user:'lead_38988090001', 'mac-address':'AA:BB:CC:DD:EE:01', address:'192.168.10.21', uptime:'00:23:14'},
        {user:'lead_38988090003', 'mac-address':'AA:BB:CC:DD:EE:03', address:'192.168.10.23', uptime:'00:05:42'},
      ],
      sessions: [
        {name:'João Silva', phone:'38988090001', mac_address:'AA:BB:CC:DD:EE:01', ip_address:'192.168.10.21', started_at:'2026-06-13T10:30:00'},
        {name:'Maria Oliveira', phone:'38988090002', mac_address:'AA:BB:CC:DD:EE:02', ip_address:'192.168.10.22', started_at:'2026-06-13T10:45:00'},
      ]
    };
    if (url.includes('/settings')) return {
      hotspot_title:'Acesse o Wi-Fi Grátis', hotspot_subtitle:'Conecte-se agora e aproveite a internet pública da Prefeitura!',
      hotspot_free_time:'60', otp_expiry_minutes:'5', require_name:'1', require_email:'0',
      zenvia_from:'VirgemLapa', mikrotik_host:'192.168.88.1', mikrotik_port:'8728',
      mikrotik_user:'admin', mikrotik_hotspot_server:'hotspot1'
    };
    if (url.includes('/mikrotik/test')) return { success: true, identity: 'VIRGEMDALAPA-RB' };
    if (url.includes('/auth/change-password')) return { success: true };
    return { success: true };
  }
}

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
  const d = new Date(dt);
  return d.toLocaleString('pt-BR', { day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit' });
}

function formatDateBR(isoDate) {
  const [y, m, d] = isoDate.split('-');
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

// ===================== INIT =====================
document.addEventListener('DOMContentLoaded', () => {
  if (token) {
    showAdminApp();
  }

  // Submissão via Enter no login
  document.getElementById('login-pass')?.addEventListener('keydown', e => {
    if (e.key === 'Enter') doLogin();
  });
});
