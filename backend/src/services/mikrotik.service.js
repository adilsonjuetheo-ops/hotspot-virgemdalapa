const RouterOSAPI = require('node-routeros').RouterOSAPI;
const { db } = require('../config/database');

// Busca um roteador pelo id; sem id, retorna o primeiro ativo
function getRouter(id) {
  if (id) {
    const r = db.prepare('SELECT * FROM routers WHERE id = ? AND active = 1').get(id);
    if (r) return r;
  }
  return db.prepare('SELECT * FROM routers WHERE active = 1 ORDER BY id LIMIT 1').get();
}

function getActiveRouters() {
  return db.prepare('SELECT * FROM routers WHERE active = 1 ORDER BY id').all();
}

function createClient(router) {
  return new RouterOSAPI({
    host: router.host,
    user: router.username,
    password: router.password,
    port: parseInt(router.port) || 8728,
    timeout: 10
  });
}

async function authorizeUser(router, macAddress, ipAddress, phone, freeTimeMinutes) {
  if (!router) throw new Error('Nenhum MikroTik ativo cadastrado.');
  const client = createClient(router);
  const server = router.hotspot_server || 'hotspot1';
  const username = `lead_${phone.replace(/\D/g, '')}`;
  const password = generatePassword();
  const timeLimit = `${freeTimeMinutes || 60}m`;

  try {
    await client.connect();

    // Remove usuário antigo com mesmo nome se existir
    try {
      const existing = await client.write('/ip/hotspot/user/print', [
        `?name=${username}`
      ]);
      if (existing && existing.length > 0) {
        await client.write('/ip/hotspot/user/remove', [
          `=.id=${existing[0]['.id']}`
        ]);
      }
    } catch (_) {}

    // Cria o usuário hotspot
    await client.write('/ip/hotspot/user/add', [
      `=name=${username}`,
      `=password=${password}`,
      `=server=${server}`,
      `=profile=${router.user_profile || 'default'}`,
      `=mac-address=${macAddress || ''}`,
      `=limit-uptime=${timeLimit}`,
      `=comment=Lead-${phone}`
    ]);

    // Faz login do usuário via API
    if (ipAddress) {
      try {
        await client.write('/ip/hotspot/active/login', [
          `=user=${username}`,
          `=password=${password}`,
          `=ip=${ipAddress}`,
          `=mac-address=${macAddress || ''}`
        ]);
      } catch (_) {
        // Nem todos os MikroTik suportam active/login via API — cliente faz login pelo browser
      }
    }

    client.close();
    return { success: true, username, password };
  } catch (error) {
    console.error(`Erro MikroTik (${router.name}):`, error.message);
    client.close();
    throw new Error('Não foi possível conectar ao MikroTik: ' + error.message);
  }
}

// Sessões ativas de todos os roteadores ativos, com o nome de cada um
async function getActiveSessions() {
  const routers = getActiveRouters();
  const all = [];
  for (const router of routers) {
    const client = createClient(router);
    try {
      await client.connect();
      const sessions = await client.write('/ip/hotspot/active/print');
      client.close();
      sessions.forEach(s => all.push({ ...s, router_name: router.name, router_id: router.id }));
    } catch (error) {
      client.close();
      console.error(`Erro ao buscar sessões (${router.name}):`, error.message);
    }
  }
  return all;
}

async function disconnectUser(macAddress) {
  const routers = getActiveRouters();
  for (const router of routers) {
    const client = createClient(router);
    try {
      await client.connect();
      const active = await client.write('/ip/hotspot/active/print', [
        `?mac-address=${macAddress}`
      ]);
      if (active && active.length > 0) {
        await client.write('/ip/hotspot/active/remove', [
          `=.id=${active[0]['.id']}`
        ]);
        client.close();
        return { success: true, router: router.name };
      }
      client.close();
    } catch (error) {
      client.close();
    }
  }
  throw new Error('Sessão não encontrada em nenhum MikroTik.');
}

async function testConnection(router) {
  if (!router) return { success: false, error: 'Roteador não encontrado.' };
  const client = createClient(router);
  try {
    await client.connect();
    const identity = await client.write('/system/identity/print');
    client.close();
    return { success: true, identity: identity[0]?.name || 'MikroTik' };
  } catch (error) {
    client.close();
    return { success: false, error: error.message };
  }
}

// Atualiza o perfil de usuário (velocidade/reconexão) em um roteador
async function updateUserProfile(router, { rateLimit, macCookieDays }) {
  const client = createClient(router);
  const profileName = router.user_profile || 'default';
  try {
    await client.connect();
    const profiles = await client.write('/ip/hotspot/user/profile/print', [
      `?name=${profileName}`
    ]);
    if (!profiles || profiles.length === 0) {
      throw new Error(`perfil "${profileName}" não encontrado`);
    }
    const params = [`=.id=${profiles[0]['.id']}`];
    if (rateLimit) params.push(`=rate-limit=${rateLimit}`);
    if (macCookieDays) params.push(`=add-mac-cookie=yes`, `=mac-cookie-timeout=${macCookieDays}d`);
    await client.write('/ip/hotspot/user/profile/set', params);
    client.close();
    return { success: true };
  } catch (error) {
    client.close();
    throw new Error(error.message);
  }
}

// Aplica velocidade/reconexão em todos os roteadores ativos
async function updateAllUserProfiles(props) {
  const routers = getActiveRouters();
  const results = [];
  for (const router of routers) {
    try {
      await updateUserProfile(router, props);
      results.push({ router: router.name, success: true });
    } catch (err) {
      results.push({ router: router.name, success: false, error: err.message });
    }
  }
  return results;
}

function generatePassword() {
  return Math.random().toString(36).slice(2, 10);
}

module.exports = {
  getRouter, getActiveRouters, authorizeUser, getActiveSessions,
  disconnectUser, testConnection, updateUserProfile, updateAllUserProfiles
};
