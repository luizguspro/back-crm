const { default: makeWASocket, DisconnectReason, useMultiFileAuthState } = require('@whiskeysockets/baileys');
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
  }
  
  async initializeSession(sessionId, userId) {
    if (this.sessions.has(sessionId)) {
      console.log('Sessão já existe:', sessionId);
      return;
    }
    
    const sessionPath = path.join(__dirname, '../../sessions', sessionId);
    
    // Criar diretório se não existir
    if (!fs.existsSync(sessionPath)) {
      fs.mkdirSync(sessionPath, { recursive: true });
    }
    
    const { state, saveCreds } = await useMultiFileAuthState(sessionPath);
    
    const sock = makeWASocket({
      auth: state,
      logger: pino({ level: 'silent' }),
      printQRInTerminal: false,
      browser: ['ZapVibe', 'Chrome', '1.0.0']
    });
    
    // Salvar socket
    this.sessions.set(sessionId, sock);
    
    // Eventos do socket
    sock.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr } = update;
      
      if (qr) {
        // Gerar QR Code
        const qrCode = await QRCode.toDataURL(qr);
        this.qrCodes.set(sessionId, qrCode);
        
        // Emitir via WebSocket
        const io = global.io;
        if (io) {
          io.to(`user-${userId}`).emit('whatsapp:qr', { qr: qrCode });
        }
      }
      
      if (connection === 'close') {
        const shouldReconnect = (lastDisconnect?.error instanceof Boom)?.output?.statusCode !== DisconnectReason.loggedOut;
        
        if (shouldReconnect) {
          console.log('Reconectando WhatsApp...');
          setTimeout(() => this.initializeSession(sessionId, userId), 5000);
        } else {
          this.sessions.delete(sessionId);
          this.qrCodes.delete(sessionId);
        }
      }
      
      if (connection === 'open') {
        console.log('WhatsApp conectado:', sessionId);
        this.qrCodes.delete(sessionId);
        
        // Salvar no banco
        await pool.query(
          'UPDATE usuarios SET whatsapp_conectado = true WHERE id = $1',
          [userId]
        );
        
        // Emitir status
        const io = global.io;
        if (io) {
          io.to(`user-${userId}`).emit('whatsapp:ready', { connected: true });
        }
        
        // Carregar config do bot
        await this.loadBotConfig(sessionId, userId);
      }
    });
    
    // Receber mensagens
    sock.ev.on('messages.upsert', async (m) => {
      const msg = m.messages[0];
      if (!msg.key.fromMe && msg.message) {
        await this.handleIncomingMessage(sessionId, userId, msg);
      }
    });
    
    // Atualizar credenciais
    sock.ev.on('creds.update', saveCreds);
  }
  
  async handleIncomingMessage(sessionId, userId, msg) {
    const sock = this.sessions.get(sessionId);
    const numero = msg.key.remoteJid.replace('@s.whatsapp.net', '');
    const mensagem = msg.message?.conversation || 
                    msg.message?.extendedTextMessage?.text || '';
    
    // Salvar mensagem no banco
    await pool.query(
      `INSERT INTO mensagens (usuario_id, numero, conteudo, tipo, status)
       VALUES ($1, $2, $3, $4, $5)`,
      [userId, numero, mensagem, 'recebida', 'received']
    );
    
    // Verificar se bot está ativo
    const botConfig = this.botConfigs.get(sessionId);
    if (botConfig && botConfig.bot_ativo) {
      await this.processBot(sessionId, numero, mensagem, botConfig);
    }
    
    // Emitir via WebSocket
    const io = global.io;
    if (io) {
      io.to(`user-${userId}`).emit('whatsapp:message', {
        from: numero,
        body: mensagem,
        timestamp: new Date()
      });
    }
  }
  
  async processBot(sessionId, numero, mensagem, config) {
    const sock = this.sessions.get(sessionId);
    
    // Delay configurável
    await new Promise(resolve => setTimeout(resolve, config.bot_delay_resposta * 1000));
    
    let resposta = null;
    
    // Verificar palavras para transferir para atendente
    if (config.bot_transferir_atendente_palavras?.length > 0) {
      const transferir = config.bot_transferir_atendente_palavras.some(palavra => 
        mensagem.toLowerCase().includes(palavra.toLowerCase())
      );
      
      if (transferir) {
        await sock.sendMessage(numero + '@s.whatsapp.net', {
          text: '👤 Ok! Vou chamar um atendente humano para você. Aguarde um momento...'
        });
        return;
      }
    }
    
    // Verificar opções do menu
    if (config.bot_menu_opcoes?.length > 0) {
      const opcao = config.bot_menu_opcoes.find(opt => 
        opt.texto.toLowerCase() === mensagem.toLowerCase()
      );
      
      if (opcao) {
        resposta = opcao.resposta;
        
        if (opcao.acao === 'transferir_atendente') {
          // Marcar para atendente
          await pool.query(
            'UPDATE conversas SET precisa_atendente = true WHERE numero = $1',
            [numero]
          );
        }
      }
    }
    
    // Verificar respostas automáticas
    if (!resposta && config.bot_respostas?.length > 0) {
      for (const autoResposta of config.bot_respostas) {
        const match = autoResposta.palavras_chave.some(palavra => 
          mensagem.toLowerCase().includes(palavra.toLowerCase())
        );
        
        if (match) {
          resposta = autoResposta.resposta;
          break;
        }
      }
    }
    
    // Se não encontrou resposta, enviar mensagem inicial
    if (!resposta && config.bot_mensagem_inicial) {
      resposta = config.bot_mensagem_inicial;
    }
    
    // Enviar resposta
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
    return this.qrCodes.get(sessionId);
  }
  
  async getStatus(sessionId) {
    const sock = this.sessions.get(sessionId);
    const qr = this.qrCodes.get(sessionId);
    
    return {
      connected: sock ? sock.user ? true : false : false,
      qr: qr || null
    };
  }
  
  async sendMessage(sessionId, numero, mensagem) {
    const sock = this.sessions.get(sessionId);
    
    if (!sock || !sock.user) {
      return { success: false, error: 'WhatsApp não conectado' };
    }
    
    try {
      const jid = numero.includes('@') ? numero : numero + '@s.whatsapp.net';
      await sock.sendMessage(jid, { text: mensagem });
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
      this.sessions.delete(sessionId);
      this.qrCodes.delete(sessionId);
      this.botConfigs.delete(sessionId);
    }
  }
}

module.exports = new WhatsAppService();