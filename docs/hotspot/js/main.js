const API = '';
const INSTAGRAM_URL = 'https://www.instagram.com/prefeituradevirgemdalapa/';
const IS_DEMO = !window.location.hostname.match(/^\d+\.\d+\.\d+\.\d+$/) && window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1';

let currentPhone = '';
let countdownInterval = null;
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

  setupOTPInputs();

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

async function sendOTP() {
  const phone = document.getElementById('input-phone').value;
  const name = document.getElementById('input-name').value.trim();
  const email = document.getElementById('input-email')?.value.trim();

  const digits = phone.replace(/\D/g, '');
  if (digits.length < 10) {
    showAlert('error', 'Digite um número de celular válido com DDD.');
    return;
  }

  const btn = document.getElementById('btn-send-otp');
  setLoading(btn, true, 'Enviando SMS...');
  clearAlert();

  try {
    currentPhone = digits;
    document.getElementById('phone-display').textContent = formatPhone(phone);

    if (IS_DEMO) {
      await new Promise(r => setTimeout(r, 500));
      goToStep(2);
      startCountdown(60);
      showAlert('info', '[MODO DEMO] Código: 123456');
      return;
    }

    const resp = await fetch(`${API}/api/hotspot/send-otp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: digits, name, email })
    });
    const data = await resp.json();
    if (!resp.ok) throw new Error(data.error || 'Erro ao enviar SMS');

    goToStep(2);
    startCountdown(60);

    if (data.debug_code) {
      showAlert('info', `[MODO DEV] Código: ${data.debug_code}`);
    } else {
      showAlert('success', '✅ Código enviado! Verifique seu WhatsApp ou SMS.');
    }
  } catch (err) {
    showAlert('error', err.message);
  } finally {
    setLoading(btn, false, 'Receber código por SMS');
  }
}

async function verifyOTP() {
  const inputs = document.querySelectorAll('.otp-input');
  const code = Array.from(inputs).map(i => i.value).join('');

  if (code.length !== 6) {
    showAlert('error', 'Digite todos os 6 dígitos do código.');
    return;
  }

  const name = document.getElementById('input-name').value.trim();
  const email = document.getElementById('input-email')?.value.trim();

  const btn = document.getElementById('btn-verify');
  setLoading(btn, true, 'Verificando...');
  clearAlert();

  try {
    let data;

    if (IS_DEMO) {
      await new Promise(r => setTimeout(r, 500));
      data = { freeTimeMinutes: 60 };
    } else {
      const resp = await fetch(`${API}/api/hotspot/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          phone: currentPhone,
          code,
          name,
          email,
          mac: urlParams.mac,
          ip: urlParams.ip
        })
      });
      data = await resp.json();
      if (!resp.ok) throw new Error(data.error || 'Código inválido.');
    }

    clearInterval(countdownInterval);
    document.getElementById('free-time-display').textContent = data.freeTimeMinutes || 60;

    if (data.username && data.password) {
      document.getElementById('cred-user').textContent = data.username;
      document.getElementById('cred-pass').textContent = data.password;
      document.getElementById('credentials-area').classList.remove('hidden');
    }

    goToStep(3);

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
    document.querySelectorAll('.otp-input').forEach(i => {
      i.value = '';
      i.classList.remove('filled');
    });
    document.querySelectorAll('.otp-input')[0].focus();
  } finally {
    setLoading(btn, false, 'Confirmar e Conectar');
  }
}

async function resendOTP() {
  const btn = document.getElementById('resend-btn');
  btn.disabled = true;
  clearAlert();

  try {
    if (IS_DEMO) {
      await new Promise(r => setTimeout(r, 400));
      showAlert('success', 'Novo código enviado!');
      startCountdown(60);
      showAlert('info', '[MODO DEMO] Código: 123456');
      return;
    }

    const resp = await fetch(`${API}/api/hotspot/send-otp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: currentPhone })
    });
    const data = await resp.json();
    if (!resp.ok) throw new Error(data.error);
    showAlert('success', 'Novo código enviado!');
    startCountdown(60);
    if (data.debug_code) showAlert('info', `[DEV] Código: ${data.debug_code}`);
  } catch (err) {
    showAlert('error', err.message);
    btn.disabled = false;
  }
}

function goBack() {
  clearInterval(countdownInterval);
  clearAlert();
  goToStep(1);
}

function goToStep(step) {
  document.querySelectorAll('[id^="step-"]').forEach(el => el.classList.add('hidden'));
  document.querySelectorAll('.step-dot').forEach((dot, i) => {
    dot.classList.toggle('active', i + 1 === step);
    dot.classList.toggle('done', i + 1 < step);
  });
  document.getElementById(`step-${step}`).classList.remove('hidden');
}

function startCountdown(seconds) {
  clearInterval(countdownInterval);
  let remaining = seconds;
  const countdownEl = document.getElementById('countdown');
  const resendText = document.getElementById('resend-text');
  const resendBtn = document.getElementById('resend-btn');

  resendText.style.display = 'inline';
  resendBtn.style.display = 'none';
  resendBtn.disabled = true;

  countdownInterval = setInterval(() => {
    remaining--;
    countdownEl.textContent = remaining;
    if (remaining <= 0) {
      clearInterval(countdownInterval);
      resendText.style.display = 'none';
      resendBtn.style.display = 'inline';
      resendBtn.disabled = false;
    }
  }, 1000);
}

function setupOTPInputs() {
  const inputs = document.querySelectorAll('.otp-input');
  inputs.forEach((input, idx) => {
    input.addEventListener('input', e => {
      const val = e.target.value.replace(/\D/g, '');
      e.target.value = val.slice(-1);
      e.target.classList.toggle('filled', val.length > 0);
      if (val && idx < inputs.length - 1) inputs[idx + 1].focus();
      if (Array.from(inputs).every(i => i.value)) verifyOTP();
    });
    input.addEventListener('keydown', e => {
      if (e.key === 'Backspace' && !e.target.value && idx > 0) {
        inputs[idx - 1].focus();
        inputs[idx - 1].value = '';
        inputs[idx - 1].classList.remove('filled');
      }
    });
    input.addEventListener('paste', e => {
      e.preventDefault();
      const pasted = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6);
      pasted.split('').forEach((char, i) => {
        if (inputs[i]) {
          inputs[i].value = char;
          inputs[i].classList.add('filled');
        }
      });
      if (pasted.length === 6) verifyOTP();
      else if (inputs[pasted.length]) inputs[pasted.length].focus();
    });
  });
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
