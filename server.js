const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
require('dotenv').config();

const pool = require('./src/database/connection');
const migrate = require('./src/database/migrate');
const empresasRoutes = require('./src/routes/empresas.routes');
const administradoresRoutes = require('./src/routes/administradores.routes');
const authRoutes = require('./src/routes/auth.routes');
const barbeirosRoutes = require('./src/routes/barbeiros.routes');
const servicosRoutes = require('./src/routes/servicos.routes');
const agendamentosRoutes = require('./src/routes/agendamentos.routes');
const horariosRoutes = require('./src/routes/horarios.routes');
const backupsRoutes = require('./src/routes/backups.routes');
const lojaRoutes = require('./src/routes/loja.routes');
const galeriaRoutes = require('./src/routes/galeria.routes');
const masterRoutes = require('./src/routes/master.routes');
const { criarBackupsAutomaticos } = require('./src/services/backup.service');
const { statusConfiguracao } = require('./src/services/whatsapp.service');
const { securityHeaders, rateLimit } = require('./src/middlewares/security');

const app = express();
const PORT = Number(process.env.PORT || 3001);
const FRONTEND_DIR = path.resolve(__dirname, '..', 'frontend');
const FRONTEND_INDEX = path.join(FRONTEND_DIR, 'index.html');

app.disable('x-powered-by');
const origens = String(process.env.CORS_ORIGINS || '').split(',').map((v) => v.trim()).filter(Boolean);
app.use(cors(origens.length ? { origin: origens, credentials: true } : undefined));
app.use(securityHeaders);
app.use(rateLimit);
app.use(express.json({ limit: '30mb' }));
app.use(express.urlencoded({ extended: true, limit: '30mb' }));

app.get('/status', async (_req, res) => {
  try {
    const resultado = await pool.query('SELECT NOW()');
    res.json({
      status: 'Agenda Fácil API online',
      banco: 'PostgreSQL conectado',
      horario: resultado.rows[0].now,
      whatsapp: statusConfiguracao()
    });
  } catch (erro) {
    console.error('Erro na rota /status:', erro);
    res.status(500).json({
      erro: 'Falha ao acessar o PostgreSQL.',
      detalhe: erro.message
    });
  }
});

app.use('/empresas', empresasRoutes);
app.use('/administradores', administradoresRoutes);
app.use('/auth', authRoutes);
app.use('/barbeiros', barbeirosRoutes);
app.use('/servicos', servicosRoutes);
app.use('/agendamentos', agendamentosRoutes);
app.use('/horarios', horariosRoutes);
app.use('/backups', backupsRoutes);
app.use('/loja', lojaRoutes);
app.use('/galeria', galeriaRoutes);
app.use('/master-api', masterRoutes);

const frontendDisponivel = fs.existsSync(FRONTEND_INDEX);
if (frontendDisponivel) {
  console.log(`✅ Frontend encontrado em: ${FRONTEND_DIR}`);
} else {
  console.error(`❌ Frontend não encontrado em: ${FRONTEND_DIR}`);
}

app.use((req, res, next) => {
  if (
    req.path === '/' ||
    req.path.startsWith('/agendar') ||
    req.path.startsWith('/admin') ||
    req.path.startsWith('/master') ||
    req.path.endsWith('.html') ||
    req.path.endsWith('.js') ||
    req.path.endsWith('.css') ||
    req.path === '/service-worker.js'
  ) {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
  }
  next();
});

if (frontendDisponivel) {
  app.use(express.static(FRONTEND_DIR, { index: false }));

  app.get(['/', '/agendar', '/agendar/'], (_req, res) => {
    res.sendFile(FRONTEND_INDEX);
  });

  app.get(['/admin', '/admin/'], (_req, res) => {
    res.sendFile(path.join(FRONTEND_DIR, 'admin', 'index.html'));
  });

  app.get(['/master', '/master/'], (_req, res) => {
    res.sendFile(path.join(FRONTEND_DIR, 'master', 'index.html'));
  });
}

const PREFIXOS_API = [
  '/empresas',
  '/administradores',
  '/auth',
  '/barbeiros',
  '/servicos',
  '/agendamentos',
  '/horarios',
  '/backups',
  '/loja',
  '/galeria',
  '/master-api',
  '/status'
];

app.use((req, res) => {
  if (PREFIXOS_API.some((prefixo) => req.path.startsWith(prefixo))) {
    return res.status(404).json({ erro: 'Rota da API não encontrada.' });
  }

  if (!frontendDisponivel) {
    return res.status(503).send('Frontend não encontrado no servidor.');
  }

  return res.sendFile(FRONTEND_INDEX);
});

migrate()
  .then(() => {
    const server = app.listen(PORT, '0.0.0.0', () => {
      console.log(`🚀 Agenda Fácil iniciada na porta ${PORT}`);
    });

    setTimeout(() => {
      criarBackupsAutomaticos().catch((erro) => {
        console.error('Erro no backup inicial:', erro.message);
      });
    }, 15000);

    setInterval(() => {
      criarBackupsAutomaticos().catch((erro) => {
        console.error('Erro no backup diário:', erro.message);
      });
    }, 24 * 60 * 60 * 1000);

    server.on('error', (erro) => {
      console.error('Erro no servidor:', erro);
    });
  })
  .catch((erro) => {
    console.error('❌ Falha ao preparar o banco:');
    console.error(erro);
    process.exitCode = 1;
  });
