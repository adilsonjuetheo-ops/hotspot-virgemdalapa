const API = '';
const INSTAGRAM_URL = 'https://www.instagram.com/prefeituradevirgemdalapa/';
const IS_DEMO = !window.location.hostname.match(/^\d+\.\d+\.\d+\.\d+$/) && window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1';

let urlParams = {};

document.addEventListener('DOMContentLoaded', async () => {
  const params = new URLSearchParams(window.location.search);
  urlParams = {
    mac: params.get('mac') || params.get('chap-id') || '',
    ip: params.get('ip') || '',
    dst: params.get('dst') || '',
    username: params.get('username') || '',
    linkLogin: params.get('link-login') || '',
    linkOrig: params.get('link-orig') || ''
  };

  if (!IS_DEMO) {
    try {
      const resp = await fetch(`${API}/api/hotspot/settings`);
      const settings = await resp.json();
      if (settings.hotspot_title) {
        document.getElementById('page-title').textContent = settings.hotspot_title;
        document.title = settings.hotspot_title + ' — Prefeitura de Virgem da Lapa';
      }
      if (settings.hotspot_subtitle) {
        document.getElementById('page-subtitle').textContent = settings.hotspot_subtitle;
      }
      if (settings.require_name === '0') {
        document.getElementById('name-group').classList.add('hidden');
      }
      if (settings.require_email === '1') {
        document.getElementById('email-group').classList.remove('hidden');
      }
    } catch (_) {}
  }

  const phoneInput = document.getElementById('input-phone');
  phoneInput.addEventListener('input', () => {
    phoneInput.value = formatPhone(phoneInput.value);
  });
});

function formatPhone(value) {
  const digits = value.replace(/\D/g, '').slice(0, 11);
  if (digits.length <= 2) return digits;
  if (digits.length <= 6) return `(${digits.slice(0,2)}) ${digits.slice(2)}`;
  if (digits.length <= 10) return `(${digits.slice(0,2)}) ${digits.slice(2,6)}-${digits.slice(6)}`;
  return `(${digits.slice(0,2)}) ${digits.slice(2,7)}-${digits.slice(7)}`;
}

async function connectWifi() {
  const phone = document.getElementById('input-phone').value;
  const name = document.getElementById('input-name').value.trim();
  const email = document.getElementById('input-email')?.value.trim();
  const acceptedTerms = document.getElementById('input-terms').checked;

  const digits = phone.replace(/\D/g, '');
  if (digits.length < 10) {
    showAlert('error', 'Digite um número de celular válido com DDD.');
    return;
  }
  if (!acceptedTerms) {
    showAlert('error', 'Você precisa aceitar os Termos de Uso e Privacidade para continuar.');
    return;
  }

  const btn = document.getElementById('btn-connect');
  setLoading(btn, true, 'Conectando...');
  clearAlert();

  try {
    let data;

    if (IS_DEMO) {
      await new Promise(r => setTimeout(r, 700));
      data = { freeTimeMinutes: 60 };
    } else {
      const resp = await fetch(`${API}/api/hotspot/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: digits, name, email, mac: urlParams.mac, ip: urlParams.ip })
      });
      data = await resp.json();
      if (!resp.ok) throw new Error(data.error || 'Não foi possível conectar. Tente novamente.');
    }

    document.getElementById('free-time-display').textContent = data.freeTimeMinutes || 60;

    if (data.username && data.password) {
      document.getElementById('cred-user').textContent = data.username;
      document.getElementById('cred-pass').textContent = data.password;
      document.getElementById('credentials-area').classList.remove('hidden');
    }

    goToStep(2);

    if (urlParams.linkLogin && data.username) {
      // Pós-login no MikroTik: destino final é o Instagram da Prefeitura
      setTimeout(() => {
        const form = document.createElement('form');
        form.method = 'POST';
        form.action = urlParams.linkLogin;
        addHidden(form, 'username', data.username);
        addHidden(form, 'password', data.password);
        addHidden(form, 'dst', INSTAGRAM_URL);
        document.body.appendChild(form);
        form.submit();
      }, 2000);
    } else {
      // Modo demo / acesso direto: redireciona para o Instagram após a tela de sucesso
      setTimeout(() => { window.location.href = INSTAGRAM_URL; }, 3000);
    }
  } catch (err) {
    showAlert('error', err.message);
  } finally {
    setLoading(btn, false, 'Conectar ao Wi-Fi');
  }
}

function goToStep(step) {
  document.querySelectorAll('[id^="step-"]').forEach(el => el.classList.add('hidden'));
  document.querySelectorAll('.step-dot').forEach((dot, i) => {
    dot.classList.toggle('active', i + 1 === step);
    dot.classList.toggle('done', i + 1 < step);
  });
  document.getElementById(`step-${step}`).classList.remove('hidden');
}

function showAlert(type, message) {
  document.getElementById('alert-area').innerHTML =
    `<div class="alert alert-${type}">${message}</div>`;
}

function clearAlert() {
  document.getElementById('alert-area').innerHTML = '';
}

function setLoading(btn, loading, text) {
  btn.disabled = loading;
  btn.innerHTML = loading ? `<span class="spinner"></span>${text}` : text;
}

function addHidden(form, name, value) {
  const input = document.createElement('input');
  input.type = 'hidden';
  input.name = name;
  input.value = value;
  form.appendChild(input);
}

// ===== Modal de Termos de Uso =====
function openTerms() {
  document.getElementById('terms-modal').classList.remove('hidden');
}

function closeTerms() {
  document.getElementById('terms-modal').classList.add('hidden');
}

document.addEventListener('keydown', e => {
  if (e.key === 'Escape') closeTerms();
});
