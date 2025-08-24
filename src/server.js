const express = require('express');
const cors = require('cors');
const http = require('http');
const socketIO = require('socket.io');
const path = require('path');
require('dotenv').config();

// Verificar se os módulos opcionais existem
let helmet, morgan, rateLimit;
try {
  helmet = require('helmet');
} catch (e) {
  console.log('⚠️ Helmet não instalado - executando sem proteção adicional de headers');
}
try {
  morgan = require('morgan');
} catch (e) {
  console.log('⚠️ Morgan não instalado - executando sem logs de requisições');
}
try {
  rateLimit = require('express-rate-limit');
} catch (e) {
  console.log('⚠️ Express-rate-limit não instalado - executando sem limitação de taxa');
}

const app = express();
const server = http.createServer(app);

// ============================================
// CONFIGURAÇÃO DO SOCKET.IO
// ============================================
const io = socketIO(server, {
  cors: {
    origin: process.env.FRONTEND_URL || 'http://localhost:5173',
    credentials: true
  }
});

// ============================================
// MIDDLEWARES
// ============================================

// Helmet (se disponível)
if (helmet) {
  app.use(helmet({
    crossOriginResourcePolicy: { policy: "cross-origin" }
  }));
}

// CORS
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:5173',
  credentials: true
}));

// Body Parser
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Morgan (se disponível)
if (morgan && process.env.NODE_ENV === 'development') {
  app.use(morgan('dev'));
}

// Rate Limiting (se disponível)
if (rateLimit && process.env.NODE_ENV === 'production') {
  const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutos
    max: 100
  });
  app.use('/api/', limiter);
}

// Servir arquivos estáticos
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

// ============================================
// ANEXAR IO AO APP
// ============================================
app.set('io', io);

// ============================================
// CONFIGURAÇÃO DO BANCO DE DADOS
// ============================================
let db = null;
const fs = require('fs');
const dbConfigPath = path.join(__dirname, 'config', 'database.js');

// Verificar se existe arquivo de configuração do banco
if (fs.existsSync(dbConfigPath)) {
  try {
    db = require('./config/database');
    app.set('db', db.pool);
  } catch (error) {
    console.log('⚠️ Erro ao carregar configuração do banco:', error.message);
  }
} else {
  console.log('⚠️ Arquivo config/database.js não encontrado - executando sem banco de dados');
}

// ============================================
// IMPORTAR ROTAS EXISTENTES
// ============================================
const loadRoute = (routeName, routePath) => {
  try {
    return require(routePath);
  } catch (error) {
    console.log(`⚠️ Rota ${routeName} não encontrada - continuando sem ela`);
    return null;
  }
};

// Carregar rotas disponíveis
const authRoutes = loadRoute('auth', './routes/auth.routes');
const dashboardRoutes = loadRoute('dashboard', './routes/dashboard.routes');
const conversationRoutes = loadRoute('conversation', './routes/conversation.routes');
const pipelineRoutes = loadRoute('pipeline', './routes/pipeline.routes');
const contactRoutes = loadRoute('contact', './routes/contact.routes');
const whatsappRoutes = loadRoute('whatsapp', './routes/whatsapp.routes');
const automationRoutes = loadRoute('automation', './routes/automation.routes');
const campaignRoutes = loadRoute('campaign', './routes/campaign.routes');

// ============================================
// REGISTRAR ROTAS DISPONÍVEIS
// ============================================
if (authRoutes) app.use('/api/auth', authRoutes);
if (dashboardRoutes) app.use('/api/dashboard', dashboardRoutes);
if (conversationRoutes) app.use('/api/conversations', conversationRoutes);
if (pipelineRoutes) app.use('/api/pipeline', pipelineRoutes);
if (contactRoutes) app.use('/api/contacts', contactRoutes);
if (whatsappRoutes) app.use('/api/whatsapp', whatsappRoutes);
if (automationRoutes) app.use('/api/automation', automationRoutes);
if (campaignRoutes) app.use('/api/campaigns', campaignRoutes);

// ============================================
// WEBSOCKET
// ============================================
const socketHandlersPath = path.join(__dirname, 'websocket', 'socketHandlers.js');
if (fs.existsSync(socketHandlersPath)) {
  try {
    require('./websocket/socketHandlers')(io);
    console.log('✅ WebSocket handlers carregados');
  } catch (error) {
    console.log('⚠️ Erro ao carregar WebSocket handlers:', error.message);
  }
} else {
  console.log('⚠️ WebSocket handlers não encontrados');
  
  // Configuração básica do WebSocket
  io.on('connection', (socket) => {
    console.log('👤 Novo cliente conectado:', socket.id);
    
    socket.on('disconnect', () => {
      console.log('👤 Cliente desconectado:', socket.id);
    });
  });
}

// ============================================
// ROTAS DE HEALTH CHECK
// ============================================
app.get('/health', async (req, res) => {
  const healthStatus = {
    status: 'OK',
    timestamp: new Date(),
    environment: process.env.NODE_ENV || 'development',
    uptime: process.uptime()
  };

  // Verificar banco se disponível
  if (db && db.pool) {
    try {
      const result = await db.pool.query('SELECT NOW() as time');
      healthStatus.database = {
        connected: true,
        time: result.rows[0].time
      };
    } catch (error) {
      healthStatus.database = {
        connected: false,
        error: error.message
      };
    }
  }

  res.json(healthStatus);
});

// ============================================
// ROTA DE TESTE
// ============================================
app.get('/api/test', (req, res) => {
  res.json({
    message: 'API ZapVibe funcionando!',
    version: '1.0.0',
    timestamp: new Date()
  });
});

// ============================================
// TRATAMENTO DE ERROS
// ============================================

// 404 Handler
app.use((req, res) => {
  res.status(404).json({
    error: 'Rota não encontrada',
    path: req.originalUrl
  });
});

// Error Handler
app.use((err, req, res, next) => {
  console.error('❌ Erro:', err.stack);
  res.status(err.status || 500).json({
    error: process.env.NODE_ENV === 'production' 
      ? 'Algo deu errado!' 
      : err.message
  });
});

// ============================================
// INICIALIZAÇÃO DO SERVIDOR
// ============================================
const PORT = process.env.PORT || 3001;

const startServer = async () => {
  try {
    console.log('\n🔄 Iniciando servidor ZapVibe...\n');
    
    // Testar conexão com banco se disponível
    if (db && db.testConnection) {
      try {
        await db.testConnection();
        console.log('✅ Banco de dados conectado\n');
      } catch (error) {
        console.log('⚠️ Banco de dados não conectado:', error.message);
        console.log('💡 O servidor continuará sem banco de dados\n');
      }
    }
    
    // Criar diretório de uploads se não existir
    const uploadsDir = path.join(__dirname, '../uploads');
    if (!fs.existsSync(uploadsDir)) {
      fs.mkdirSync(uploadsDir, { recursive: true });
      console.log('📁 Diretório de uploads criado');
    }
    
    // Iniciar servidor
    server.listen(PORT, () => {
      console.log('='.repeat(50));
      console.log('🚀 Servidor ZapVibe rodando!');
      console.log('='.repeat(50));
      console.log(`📍 Porta: ${PORT}`);
      console.log(`🌍 Ambiente: ${process.env.NODE_ENV || 'development'}`);
      console.log(`🔗 Frontend: ${process.env.FRONTEND_URL || 'http://localhost:5173'}`);
      console.log(`📱 WhatsApp: ${whatsappRoutes ? 'Disponível' : 'Não configurado'}`);
      console.log(`🔌 WebSocket: Pronto para conexões`);
      console.log(`🗄️ Banco: ${db ? 'Configurado' : 'Não configurado'}`);
      console.log('='.repeat(50));
      console.log('\n✅ Sistema pronto!\n');
      
      // Mostrar rotas carregadas
      console.log('📋 Rotas disponíveis:');
      console.log('   GET  /health - Status do servidor');
      console.log('   GET  /api/test - Teste da API');
      if (authRoutes) console.log('   *    /api/auth/* - Autenticação');
      if (dashboardRoutes) console.log('   *    /api/dashboard/* - Dashboard');
      if (conversationRoutes) console.log('   *    /api/conversations/* - Conversas');
      if (pipelineRoutes) console.log('   *    /api/pipeline/* - Pipeline');
      if (contactRoutes) console.log('   *    /api/contacts/* - Contatos');
      if (whatsappRoutes) console.log('   *    /api/whatsapp/* - WhatsApp');
      if (automationRoutes) console.log('   *    /api/automation/* - Automação');
      if (campaignRoutes) console.log('   *    /api/campaigns/* - Campanhas');
      console.log('');
    });
    
  } catch (error) {
    console.error('❌ Erro ao iniciar servidor:', error);
    process.exit(1);
  }
};

// ============================================
// GRACEFUL SHUTDOWN
// ============================================
process.on('SIGTERM', () => {
  console.log('SIGTERM recebido, encerrando servidor...');
  server.close(() => {
    console.log('Servidor encerrado');
    if (db && db.pool) {
      db.pool.end();
    }
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('\nSIGINT recebido, encerrando servidor...');
  server.close(() => {
    console.log('Servidor encerrado');
    if (db && db.pool) {
      db.pool.end();
    }
    process.exit(0);
  });
});

// Iniciar servidor
startServer();