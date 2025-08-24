const WhatsAppService = require('../services/whatsapp.service');
const pool = require('../config/database');

class WhatsAppController {
  async initialize(req, res) {
    try {
      const userId = req.userId;
      const sessionId = `session-${userId}`;
      
      await WhatsAppService.initializeSession(sessionId, userId);
      
      res.json({ 
        success: true, 
        message: 'Inicializando WhatsApp...' 
      });
      
    } catch (error) {
      console.error('Erro ao inicializar WhatsApp:', error);
      res.status(500).json({ 
        success: false, 
        error: 'Erro ao inicializar WhatsApp' 
      });
    }
  }
  
  async getQR(req, res) {
    try {
      const userId = req.userId;
      const sessionId = `session-${userId}`;
      
      const qr = await WhatsAppService.getQR(sessionId);
      
      if (qr) {
        res.json({ success: true, qr });
      } else {
        const status = await WhatsAppService.getStatus(sessionId);
        if (status.connected) {
          res.json({ success: true, connected: true });
        } else {
          res.status(404).json({ 
            success: false, 
            error: 'QR Code não disponível' 
          });
        }
      }
      
    } catch (error) {
      console.error('Erro ao buscar QR:', error);
      res.status(500).json({ 
        success: false, 
        error: 'Erro ao buscar QR Code' 
      });
    }
  }
  
  async getStatus(req, res) {
    try {
      const userId = req.userId;
      const sessionId = `session-${userId}`;
      
      const status = await WhatsAppService.getStatus(sessionId);
      
      res.json({
        success: true,
        connected: status.connected,
        qr: status.qr
      });
      
    } catch (error) {
      console.error('Erro ao verificar status:', error);
      res.status(500).json({ 
        success: false, 
        error: 'Erro ao verificar status' 
      });
    }
  }
  
  async disconnect(req, res) {
    try {
      const userId = req.userId;
      const sessionId = `session-${userId}`;
      
      await WhatsAppService.disconnectSession(sessionId);
      
      res.json({ 
        success: true, 
        message: 'WhatsApp desconectado' 
      });
      
    } catch (error) {
      console.error('Erro ao desconectar:', error);
      res.status(500).json({ 
        success: false, 
        error: 'Erro ao desconectar WhatsApp' 
      });
    }
  }
  
  async sendMessage(req, res) {
    try {
      const { numero, mensagem } = req.body;
      const userId = req.userId;
      const sessionId = `session-${userId}`;
      
      const result = await WhatsAppService.sendMessage(sessionId, numero, mensagem);
      
      if (result.success) {
        // Salvar mensagem no banco
        await pool.query(
          `INSERT INTO mensagens (usuario_id, numero, conteudo, tipo, status)
           VALUES ($1, $2, $3, $4, $5)`,
          [userId, numero, mensagem, 'enviada', 'sent']
        );
        
        res.json({ success: true, message: 'Mensagem enviada' });
      } else {
        res.status(400).json({ 
          success: false, 
          error: result.error 
        });
      }
      
    } catch (error) {
      console.error('Erro ao enviar mensagem:', error);
      res.status(500).json({ 
        success: false, 
        error: 'Erro ao enviar mensagem' 
      });
    }
  }
  
  async getBotConfig(req, res) {
    try {
      const result = await pool.query(
        'SELECT * FROM bot_config WHERE usuario_id = $1',
        [req.userId]
      );
      
      if (result.rows.length === 0) {
        // Criar config padrão
        const defaultConfig = {
          bot_ativo: false,
          bot_mensagem_inicial: '',
          bot_menu_opcoes: [],
          bot_respostas: [],
          bot_delay_resposta: 2,
          bot_transferir_atendente_palavras: []
        };
        
        await pool.query(
          `INSERT INTO bot_config (usuario_id, config) VALUES ($1, $2)`,
          [req.userId, JSON.stringify(defaultConfig)]
        );
        
        res.json({ success: true, config: defaultConfig });
      } else {
        res.json({ 
          success: true, 
          config: result.rows[0].config 
        });
      }
      
    } catch (error) {
      console.error('Erro ao buscar config do bot:', error);
      res.status(500).json({ 
        success: false, 
        error: 'Erro ao buscar configurações' 
      });
    }
  }
  
  async saveBotConfig(req, res) {
    try {
      const config = req.body;
      
      await pool.query(
        `INSERT INTO bot_config (usuario_id, config) 
         VALUES ($1, $2)
         ON CONFLICT (usuario_id) 
         DO UPDATE SET config = $2, atualizado_em = NOW()`,
        [req.userId, JSON.stringify(config)]
      );
      
      // Atualizar bot service
      const sessionId = `session-${req.userId}`;
      await WhatsAppService.updateBotConfig(sessionId, config);
      
      res.json({ 
        success: true, 
        message: 'Configurações salvas' 
      });
      
    } catch (error) {
      console.error('Erro ao salvar config:', error);
      res.status(500).json({ 
        success: false, 
        error: 'Erro ao salvar configurações' 
      });
    }
  }
}

module.exports = new WhatsAppController();