require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

// Garante que a pasta de dados existe
const dataDir = path.join(__dirname, '../data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const { initDatabase } = require('./config/database');
const hotspotRoutes = require('./routes/hotspot');
const adminRoutes = require('./routes/admin');
const authRoutes = require('./routes/auth');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve arquivos estáticos do frontend
app.use(express.static(path.join(__dirname, '../../public')));
// Assets do portal também na raiz — o portal é servido em "/" e referencia ./css, ./js, ./img
app.use(express.static(path.join(__dirname, '../../public/hotspot')));

// Rotas da API
app.use('/api/hotspot', hotspotRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/auth', authRoutes);

// Rota principal — portal hotspot
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../../public/hotspot/index.html'));
});

// login.html do MikroTik com o roteador embutido — baixar via /tool fetch
// Ex.: /mikrotik-login/2 gera a página de redirecionamento que identifica o roteador 2
app.get('/mikrotik-login/:id', (req, res) => {
  const id = parseInt(req.params.id) || 1;
  const base = (process.env.BASE_URL || 'https://wifi.virgemdalapa.mg.gov.br').replace(/\/$/, '');
  const url = `${base}/?router=${id}&mac=$(mac)&ip=$(ip)&link-login-only=$(link-login-only)&link-orig=$(link-orig-esc)&error=$(error)`;
  res.type('html').send(`<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <title>Wi-Fi de Todos — Virgem da Lapa</title>
  <meta http-equiv="refresh" content="0; url=${url}">
</head>
<body style="font-family:sans-serif;text-align:center;padding-top:60px;background:#062a4d;color:#fff">
  <p>Redirecionando para o portal Wi-Fi da Prefeitura de Virgem da Lapa...</p>
  <p><a style="color:#ff9e33" href="${url}">Clique aqui se não for redirecionado</a></p>
</body>
</html>`);
});

// Rota do painel admin
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, '../../public/admin/index.html'));
});

app.get('/admin/*', (req, res) => {
  res.sendFile(path.join(__dirname, '../../public/admin/index.html'));
});

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', version: '1.0.0', timestamp: new Date().toISOString() });
});

initDatabase();

app.listen(PORT, () => {
  console.log(`\n🚀 Hotspot Virgem da Lapa rodando na porta ${PORT}`);
  console.log(`   Portal Hotspot: http://localhost:${PORT}/`);
  console.log(`   Painel Admin:   http://localhost:${PORT}/admin`);
  console.log(`   Ambiente: ${process.env.NODE_ENV || 'development'}\n`);
});

module.exports = app;
