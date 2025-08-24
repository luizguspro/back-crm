const pool = require('../config/database');

class ConversationController {
  async getAll(req, res) {
    try {
      const { search, status } = req.query;
      
      let query = `
        SELECT c.*, cont.nome, cont.email, cont.whatsapp,
               COUNT(m.id) FILTER (WHERE m.lida = false) as nao_lidas,
               MAX(m.criado_em) as ultima_mensagem_em
        FROM conversas c
        LEFT JOIN contatos cont ON c.contato_id = cont.id
        LEFT JOIN mensagens m ON c.id = m.conversa_id
        WHERE c.usuario_id = $1
      `;
      
      const params = [req.userId];
      
      if (search) {
        query += ' AND (cont.nome ILIKE $2 OR m.conteudo ILIKE $2)';
        params.push(`%${search}%`);
      }
      
      if (status === 'unread') {
        query += ' AND EXISTS (SELECT 1 FROM mensagens WHERE conversa_id = c.id AND lida = false)';
      }
      
      query += ' GROUP BY c.id, cont.nome, cont.email, cont.whatsapp ORDER BY ultima_mensagem_em DESC';
      
      const result = await pool.query(query, params);
      
      res.json(result.rows);
      
    } catch (error) {
      console.error('Erro ao buscar conversas:', error);
      res.status(500).json({ error: 'Erro ao buscar conversas' });
    }
  }
  
  async getMessages(req, res) {
    try {
      const { id } = req.params;
      
      const result = await pool.query(
        `SELECT * FROM mensagens 
         WHERE conversa_id = $1 
         ORDER BY criado_em ASC`,
        [id]
      );
      
      // Marcar como lidas
      await pool.query(
        'UPDATE mensagens SET lida = true WHERE conversa_id = $1 AND tipo = $2',
        [id, 'recebida']
      );
      
      res.json(result.rows);
      
    } catch (error) {
      console.error('Erro ao buscar mensagens:', error);
      res.status(500).json({ error: 'Erro ao buscar mensagens' });
    }
  }
  
  async sendMessage(req, res) {
    try {
      const { id } = req.params;
      const { message } = req.body;
      
      // Buscar dados da conversa
      const convResult = await pool.query(
        `SELECT c.*, cont.whatsapp 
         FROM conversas c
         LEFT JOIN contatos cont ON c.contato_id = cont.id
         WHERE c.id = $1 AND c.usuario_id = $2`,
        [id, req.userId]
      );
      
      if (convResult.rows.length === 0) {
        return res.status(404).json({ error: 'Conversa não encontrada' });
      }
      
      const conversa = convResult.rows[0];
      
      // Salvar mensagem
      const msgResult = await pool.query(
        `INSERT INTO mensagens (conversa_id, conteudo, tipo, remetente, lida)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING *`,
        [id, message, 'enviada', 'atendente', true]
      );
      
      // Enviar via WhatsApp se conectado
      const WhatsAppService = require('../services/whatsapp.service');
      const sessionId = `session-${req.userId}`;
      
      await WhatsAppService.sendMessage(sessionId, conversa.whatsapp, message);
      
      // Emitir via WebSocket
      const io = global.io;
      if (io) {
        io.to(`conversation-${id}`).emit('new-message', {
          conversationId: id,
          message: msgResult.rows[0]
        });
      }
      
      res.json({ success: true, message: msgResult.rows[0] });
      
    } catch (error) {
      console.error('Erro ao enviar mensagem:', error);
      res.status(500).json({ error: 'Erro ao enviar mensagem' });
    }
  }
}

module.exports = new ConversationController();