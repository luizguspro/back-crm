const WhatsAppService = require('../services/whatsapp.service');
const pool = require('../config/database');

class WhatsAppController {
  async initialize(req, res) {
    try {
      const userId = req.userId;
      const sessionId = `session-${userId}`;
      
      // Limpar sessão anterior se existir com erro
      const checkSession = await pool.query(
        'SELECT status FROM whatsapp_sessoes WHERE usuario_id = $1',
        [userId]
      );
      
      if (checkSession.rows.length > 0) {
        const status = checkSession.rows[0].status;
        if (status === 'reconnecting' || status === 'error' || status === 'disconnected') {
          // Desconectar sessão antiga
          await WhatsAppService.disconnectSession(sessionId);
          
          // Limpar do banco
          await pool.query(
            'DELETE FROM whatsapp_sessoes WHERE usuario_id = $1',
            [userId]
          );
        }
      }
      
      // Inicializar nova sessão
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
      
      // Primeiro verificar no banco
      const dbResult = await pool.query(
        'SELECT qr_code, status FROM whatsapp_sessoes WHERE usuario_id = $1',
        [userId]
      );
      
      if (dbResult.rows.length > 0) {
        const session = dbResult.rows[0];
        
        if (session.qr_code) {
          return res.json({ 
            success: true, 
            qr: session.qr_code,
            status: session.status 
          });
        }
        
        if (session.status === 'connected') {
          return res.json({ 
            success: true, 
            connected: true,
            status: 'connected'
          });
        }
      }
      
      // Verificar na memória
      const qr = await WhatsAppService.getQR(sessionId);
      
      if (qr) {
        res.json({ 
          success: true, 
          qr,
          status: 'qr_code'
        });
      } else {
        const status = await WhatsAppService.getStatus(sessionId);
        if (status.connected) {
          res.json({ 
            success: true, 
            connected: true,
            status: 'connected'
          });
        } else {
          res.json({ 
            success: false, 
            error: 'QR Code não disponível. Tente inicializar novamente.',
            status: status.status || 'unknown'
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
        status: status.status,
        numero: status.numero,
        nome: status.nome,
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
      
      // Limpar do banco
      await pool.query(
        'DELETE FROM whatsapp_sessoes WHERE usuario_id = $1',
        [userId]
      );
      
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
      
      if (!numero || !mensagem) {
        return res.status(400).json({ 
          success: false, 
          error: 'Número e mensagem são obrigatórios' 
        });
      }
      
      const result = await WhatsAppService.sendMessage(sessionId, numero, mensagem);
      
      if (result.success) {
        // Criar conversa se não existir
        let conversaId;
        const conversaResult = await pool.query(
          'SELECT id FROM conversas WHERE usuario_id = $1 AND numero = $2',
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
             SET ultima_mensagem = $1, ultima_mensagem_em = NOW()
             WHERE id = $2`,
            [mensagem, conversaId]
          );
        }
        
        // Salvar mensagem no banco
        await pool.query(
          `INSERT INTO mensagens (id, conversa_id, usuario_id, numero, conteudo, tipo, remetente, status, lida)
           VALUES (gen_random_uuid(), $1, $2, $3, $4, 'enviada', 'atendente', 'sent', true)`,
          [conversaId, userId, numero, mensagem]
        );
        
        res.json({ 
          success: true, 
          message: 'Mensagem enviada' 
        });
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
        'SELECT config FROM bot_config WHERE usuario_id = $1',
        [req.userId]
      );
      
      if (result.rows.length === 0) {
        const defaultConfig = {
          bot_ativo: false,
          bot_mensagem_inicial: '',
          bot_menu_opcoes: [],
          bot_respostas: [],
          bot_delay_resposta: 2,
          bot_transferir_atendente_palavras: []
        };
        
        await pool.query(
          `INSERT INTO bot_config (id, usuario_id, config) 
           VALUES (gen_random_uuid(), $1, $2)`,
          [req.userId, JSON.stringify(defaultConfig)]
        );
        
        res.json({ 
          success: true, 
          config: defaultConfig 
        });
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
        `INSERT INTO bot_config (id, usuario_id, config) 
         VALUES (gen_random_uuid(), $1, $2)
         ON CONFLICT (usuario_id) 
         DO UPDATE SET config = $2, atualizado_em = NOW()`,
        [req.userId, JSON.stringify(config)]
      );
      
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