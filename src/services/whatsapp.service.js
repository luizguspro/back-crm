const { default: makeWASocket, DisconnectReason, useMultiFileAuthState, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
const QRCode = require('qrcode');
const path = require('path');
const fs = require('fs');
const pino = require('pino');
const pool = require('../config/database');

class WhatsAppService {
  constructor() {
    this.sessions = new Map();
    this.qrCodes = new Map();
    this.botConfigs = new Map();
    this.connectionAttempts = new Map();
    this.initializeSavedSessions();
  }
  
  async initializeSavedSessions() {
    try {
      // Limpar sessões com erro ou reconnecting ao iniciar
      await pool.query(
        `UPDATE whatsapp_sessoes 
         SET status = 'disconnected' 
         WHERE status IN ('reconnecting', 'error', 'initializing')`
      );
      
      // Carregar apenas sessões que estavam conectadas
      const result = await pool.query(
        `SELECT * FROM whatsapp_sessoes WHERE status = 'connected'`
      );
      
      for (const session of result.rows) {
        console.log(`Restaurando sessão para usuário: ${session.usuario_id}`);
        try {
          await this.initializeSession(session.session_id, session.usuario_id, true);
        } catch (error) {
          console.error(`Erro ao restaurar sessão ${session.session_id}:`, error);
        }
      }
    } catch (error) {
      console.error('Erro ao restaurar sessões:', error);
    }
  }
  
  async initializeSession(sessionId, userId, isRestore = false) {
    // Verificar se já existe uma sessão ativa
    if (this.sessions.has(sessionId)) {
      const existingSock = this.sessions.get(sessionId);
      
      // Se já está conectado, retornar
      if (existingSock && existingSock.user) {
        console.log('Sessão já conectada:', sessionId);
        return existingSock;
      }
      
      // Se não está conectado, limpar
      console.log('Limpando sessão existente:', sessionId);
      await this.disconnectSession(sessionId);
    }
    
    // Verificar tentativas de conexão
    const attempts = this.connectionAttempts.get(sessionId) || 0;
    if (attempts > 3) {
      console.error('Muitas tentativas de conexão para:', sessionId);
      await pool.query(
        `UPDATE whatsapp_sessoes SET status = 'error' WHERE session_id = $1`,
        [sessionId]
      );
      this.connectionAttempts.delete(sessionId);
      throw new Error('Muitas tentativas de conexão falhadas');
    }
    
    this.connectionAttempts.set(sessionId, attempts + 1);
    
    const sessionPath = path.join(__dirname, '../../sessions', sessionId);
    
    // Limpar pasta de sessão se não for restore
    if (!isRestore && fs.existsSync(sessionPath)) {
      fs.rmSync(sessionPath, { recursive: true, force: true });
      console.log('Pasta de sessão limpa:', sessionPath);
    }
    
    // Criar pasta se não existir
    if (!fs.existsSync(sessionPath)) {
      fs.mkdirSync(sessionPath, { recursive: true });
    }
    
    try {
      const { state, saveCreds } = await useMultiFileAuthState(sessionPath);
      const { version } = await fetchLatestBaileysVersion();
      
      const sock = makeWASocket({
        version,
        auth: state,
        logger: pino({ level: 'silent' }),
        printQRInTerminal: false,
        browser: ['ZapVibe CRM', 'Chrome', '1.0.0'],
        syncFullHistory: false,
        qrTimeout: 60000, // 60 segundos para QR
        defaultQueryTimeoutMs: 60000,
        connectTimeoutMs: 60000,
        keepAliveIntervalMs: 10000,
        emitOwnEvents: true,
        fireInitQueries: false
      });
      
      this.sessions.set(sessionId, sock);
      
      // Atualizar banco
      if (!isRestore) {
        await pool.query(
          `INSERT INTO whatsapp_sessoes (id, usuario_id, session_id, status)
           VALUES (gen_random_uuid(), $1, $2, $3)
           ON CONFLICT (usuario_id) 
           DO UPDATE SET session_id = $2, status = $3, qr_code = NULL, atualizado_em = NOW()`,
          [userId, sessionId, 'initializing']
        );
      }
      
      // Eventos do socket
      sock.ev.on('connection.update', async (update) => {
        await this.handleConnectionUpdate(update, sessionId, userId, sock);
      });
      
      sock.ev.on('messages.upsert', async (m) => {
        if (m.type === 'notify') {
          for (const msg of m.messages) {
            if (!msg.key.fromMe && msg.message) {
              await this.handleIncomingMessage(sessionId, userId, msg);
            }
          }
        }
      });
      
      sock.ev.on('creds.update', saveCreds);
      
      return sock;
      
    } catch (error) {
      console.error('Erro ao inicializar sessão:', error);
      this.connectionAttempts.delete(sessionId);
      
      await pool.query(
        `UPDATE whatsapp_sessoes SET status = 'error' WHERE session_id = $1`,
        [sessionId]
      );
      
      throw error;
    }
  }
  
  async handleConnectionUpdate(update, sessionId, userId, sock) {
    const { connection, lastDisconnect, qr } = update;
    
    console.log('Connection update:', { connection, sessionId, hasQR: !!qr });
    
    if (qr) {
      console.log('QR Code gerado para sessão:', sessionId);
      
      try {
        const qrCode = await QRCode.toDataURL(qr);
        this.qrCodes.set(sessionId, qrCode);
        
        await pool.query(
          `UPDATE whatsapp_sessoes 
           SET qr_code = $1, status = 'qr_code', atualizado_em = NOW()
           WHERE session_id = $2`,
          [qrCode, sessionId]
        );
        
        const io = global.io;
        if (io) {
          io.to(`user-${userId}`).emit('whatsapp:qr', { qr: qrCode });
        }
      } catch (error) {
        console.error('Erro ao processar QR Code:', error);
      }
    }
    
    if (connection === 'close') {
      const statusCode = (lastDisconnect?.error instanceof Boom)?.output?.statusCode;
      const shouldReconnect = statusCode !== DisconnectReason.loggedOut && 
                             statusCode !== 401 && 
                             statusCode !== 403;
      
      console.log('Conexão fechada:', {
        statusCode,
        shouldReconnect,
        sessionId
      });
      
      if (shouldReconnect) {
        const attempts = this.connectionAttempts.get(sessionId) || 0;
        
        if (attempts < 3) {
          console.log(`Tentando reconectar (tentativa ${attempts + 1}/3)...`);
          
          await pool.query(
            `UPDATE whatsapp_sessoes SET status = 'reconnecting' WHERE session_id = $1`,
            [sessionId]
          );
          
          this.sessions.delete(sessionId);
          
          setTimeout(() => {
            this.initializeSession(sessionId, userId).catch(console.error);
          }, 5000);
        } else {
          console.error('Máximo de tentativas de reconexão atingido');
          await this.handleDisconnection(sessionId, userId);
        }
      } else {
        await this.handleDisconnection(sessionId, userId);
      }
    }
    
    if (connection === 'open') {
      console.log('WhatsApp conectado com sucesso:', sessionId);
      
      // Reset tentativas
      this.connectionAttempts.delete(sessionId);
      this.qrCodes.delete(sessionId);
      
      const numero = sock.user?.id?.split('@')[0] || '';
      const nome = sock.user?.name || 'ZapVibe User';
      
      await pool.query(
        `UPDATE whatsapp_sessoes 
         SET status = 'connected', 
             qr_code = NULL, 
             numero = $1, 
             nome = $2, 
             ultima_conexao = NOW(), 
             atualizado_em = NOW()
         WHERE session_id = $3`,
        [numero, nome, sessionId]
      );
      
      await pool.query(
        `UPDATE usuarios 
         SET whatsapp_conectado = true, 
             whatsapp_numero = $1, 
             whatsapp_nome = $2
         WHERE id = $3`,
        [numero, nome, userId]
      );
      
      const io = global.io;
      if (io) {
        io.to(`user-${userId}`).emit('whatsapp:ready', { 
          connected: true,
          numero,
          nome
        });
      }
      
      await this.loadBotConfig(sessionId, userId);
    }
  }
  
  async handleDisconnection(sessionId, userId) {
    console.log('Desconectando sessão:', sessionId);
    
    this.sessions.delete(sessionId);
    this.qrCodes.delete(sessionId);
    this.botConfigs.delete(sessionId);
    this.connectionAttempts.delete(sessionId);
    
    await pool.query(
      `UPDATE whatsapp_sessoes 
       SET status = 'disconnected', qr_code = NULL 
       WHERE session_id = $1`,
      [sessionId]
    );
    
    await pool.query(
      `UPDATE usuarios 
       SET whatsapp_conectado = false 
       WHERE id = $1`,
      [userId]
    );
    
    const io = global.io;
    if (io) {
      io.to(`user-${userId}`).emit('whatsapp:disconnected');
    }
  }
  
  async handleIncomingMessage(sessionId, userId, msg) {
    try {
      const sock = this.sessions.get(sessionId);
      const numero = msg.key.remoteJid.replace('@s.whatsapp.net', '').replace('@g.us', '');
      const mensagem = msg.message?.conversation || 
                      msg.message?.extendedTextMessage?.text || 
                      msg.message?.imageMessage?.caption ||
                      msg.message?.videoMessage?.caption || '';
      const isGroup = msg.key.remoteJid.includes('@g.us');
      
      if (isGroup) return;
      
      let conversaId;
      const conversaResult = await pool.query(
        `SELECT id FROM conversas WHERE usuario_id = $1 AND numero = $2`,
        [userId, numero]
      );
      
      if (conversaResult.rows.length === 0) {
        const novaConversa = await pool.query(
          `INSERT INTO conversas (id, usuario_id, numero, canal_tipo, status, ultima_mensagem, ultima_mensagem_em)
           VALUES (gen_random_uuid(), $1, $2, 'whatsapp', 'active', $3, NOW())
           RETURNING id`,
          [userId, numero, mensagem]
        );
        conversaId = novaConversa.rows[0].id;
      } else {
        conversaId = conversaResult.rows[0].id;
        
        await pool.query(
          `UPDATE conversas 
           SET ultima_mensagem = $1, ultima_mensagem_em = NOW(), status = 'active'
           WHERE id = $2`,
          [mensagem, conversaId]
        );
      }
      
      await pool.query(
        `INSERT INTO mensagens (id, conversa_id, usuario_id, numero, conteudo, tipo, remetente, status, lida)
         VALUES (gen_random_uuid(), $1, $2, $3, $4, 'recebida', 'contato', 'received', false)`,
        [conversaId, userId, numero, mensagem]
      );
      
      const botConfig = this.botConfigs.get(sessionId);
      if (botConfig && botConfig.bot_ativo) {
        await this.processBot(sessionId, numero, mensagem, botConfig);
      }
      
      const io = global.io;
      if (io) {
        io.to(`user-${userId}`).emit('whatsapp:message', {
          conversaId,
          from: numero,
          body: mensagem,
          timestamp: new Date()
        });
      }
      
    } catch (error) {
      console.error('Erro ao processar mensagem:', error);
    }
  }
  
  async processBot(sessionId, numero, mensagem, config) {
    const sock = this.sessions.get(sessionId);
    if (!sock) return;
    
    await new Promise(resolve => setTimeout(resolve, (config.bot_delay_resposta || 2) * 1000));
    
    let resposta = config.bot_mensagem_inicial || 'Olá! Como posso ajudar?';
    
    if (resposta) {
      await sock.sendMessage(numero + '@s.whatsapp.net', {
        text: resposta
      });
    }
  }
  
  async loadBotConfig(sessionId, userId) {
    try {
      const result = await pool.query(
        'SELECT config FROM bot_config WHERE usuario_id = $1',
        [userId]
      );
      
      if (result.rows.length > 0) {
        this.botConfigs.set(sessionId, result.rows[0].config);
      }
    } catch (error) {
      console.error('Erro ao carregar config do bot:', error);
    }
  }
  
  async updateBotConfig(sessionId, config) {
    this.botConfigs.set(sessionId, config);
  }
  
  async getQR(sessionId) {
    const qrFromMemory = this.qrCodes.get(sessionId);
    if (qrFromMemory) return qrFromMemory;
    
    try {
      const result = await pool.query(
        'SELECT qr_code FROM whatsapp_sessoes WHERE session_id = $1',
        [sessionId]
      );
      
      if (result.rows.length > 0 && result.rows[0].qr_code) {
        return result.rows[0].qr_code;
      }
    } catch (error) {
      console.error('Erro ao buscar QR do banco:', error);
    }
    
    return null;
  }
  
  async getStatus(sessionId) {
    const sock = this.sessions.get(sessionId);
    const qr = await this.getQR(sessionId);
    
    try {
      const result = await pool.query(
        'SELECT status, numero, nome FROM whatsapp_sessoes WHERE session_id = $1',
        [sessionId]
      );
      
      if (result.rows.length > 0) {
        const session = result.rows[0];
        return {
          connected: session.status === 'connected',
          status: session.status,
          qr: qr,
          numero: session.numero,
          nome: session.nome
        };
      }
    } catch (error) {
      console.error('Erro ao buscar status:', error);
    }
    
    return {
      connected: sock ? sock.user ? true : false : false,
      status: 'unknown',
      qr: qr || null
    };
  }
  
  async sendMessage(sessionId, numero, mensagem, conversaId = null, userId = null) {
    const sock = this.sessions.get(sessionId);
    
    if (!sock || !sock.user) {
      return { success: false, error: 'WhatsApp não conectado' };
    }
    
    try {
      const jid = numero.includes('@') ? numero : numero + '@s.whatsapp.net';
      await sock.sendMessage(jid, { text: mensagem });
      
      if (conversaId && userId) {
        await pool.query(
          `INSERT INTO mensagens (id, conversa_id, usuario_id, numero, conteudo, tipo, remetente, status, lida)
           VALUES (gen_random_uuid(), $1, $2, $3, $4, 'enviada', 'atendente', 'sent', true)`,
          [conversaId, userId, numero, mensagem]
        );
        
        await pool.query(
          `UPDATE conversas 
           SET ultima_mensagem = $1, ultima_mensagem_em = NOW()
           WHERE id = $2`,
          [mensagem, conversaId]
        );
      }
      
      return { success: true };
    } catch (error) {
      console.error('Erro ao enviar mensagem:', error);
      return { success: false, error: error.message };
    }
  }
  
  async disconnectSession(sessionId) {
    const sock = this.sessions.get(sessionId);
    
    if (sock) {
      sock.end();
    }
    
    await this.handleDisconnection(sessionId, sessionId.replace('session-', ''));
    
    // Limpar pasta de sessão
    const sessionPath = path.join(__dirname, '../../sessions', sessionId);
    if (fs.existsSync(sessionPath)) {
      fs.rmSync(sessionPath, { recursive: true, force: true });
      console.log('Pasta de sessão removida:', sessionPath);
    }
  }
}

module.exports = new WhatsAppService();