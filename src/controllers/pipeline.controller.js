const pool = require('../config/database');
const { v4: uuidv4 } = require('uuid');

class PipelineController {
  async getDeals(req, res) {
    try {
      const stages = [
        { id: 'new', title: 'Novos Leads', color: 'bg-blue-500', description: 'Leads recém chegados', leads: [] },
        { id: 'qualified', title: 'Qualificados', color: 'bg-purple-500', description: 'Leads com potencial confirmado', leads: [] },
        { id: 'proposal', title: 'Proposta', color: 'bg-amber-500', description: 'Proposta enviada', leads: [] },
        { id: 'negotiation', title: 'Negociação', color: 'bg-orange-500', description: 'Em negociação final', leads: [] },
        { id: 'won', title: 'Ganhos', color: 'bg-green-500', description: 'Negócios fechados', leads: [] }
      ];
      
      const result = await pool.query(
        `SELECT l.*, c.nome as contact_name, c.email, c.telefone as phone, c.whatsapp
         FROM leads l
         LEFT JOIN contatos c ON l.contato_id = c.id
         WHERE l.usuario_id = $1
         ORDER BY l.criado_em DESC`,
        [req.userId]
      );
      
      // Organizar por estágio
      result.rows.forEach(lead => {
        const stage = stages.find(s => s.id === lead.status);
        if (stage) {
          stage.leads.push({
            id: lead.id,
            name: lead.contact_name || lead.nome,
            email: lead.email,
            phone: lead.phone,
            value: lead.valor,
            score: lead.score,
            stage: lead.status,
            tags: lead.tags || [],
            source: lead.origem,
            lastContact: lead.ultimo_contato,
            lastChannel: lead.ultimo_canal
          });
        }
      });
      
      res.json(stages);
      
    } catch (error) {
      console.error('Erro ao buscar deals:', error);
      res.status(500).json({ error: 'Erro ao buscar pipeline' });
    }
  }
  
  async createDeal(req, res) {
    try {
      const { name, email, phone, value, stage, source } = req.body;
      
      // Criar contato se não existir
      let contatoId = null;
      if (email) {
        const contactResult = await pool.query(
          'SELECT id FROM contatos WHERE email = $1 AND usuario_id = $2',
          [email, req.userId]
        );
        
        if (contactResult.rows.length > 0) {
          contatoId = contactResult.rows[0].id;
        } else {
          const newContact = await pool.query(
            `INSERT INTO contatos (id, usuario_id, nome, email, telefone, score)
             VALUES ($1, $2, $3, $4, $5, $6)
             RETURNING id`,
            [uuidv4(), req.userId, name, email, phone, 50]
          );
          contatoId = newContact.rows[0].id;
        }
      }
      
      // Criar lead
      const leadId = uuidv4();
      const result = await pool.query(
        `INSERT INTO leads (id, usuario_id, contato_id, nome, valor, status, origem, score)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING *`,
        [leadId, req.userId, contatoId, name, value || 0, stage || 'new', source || 'Manual', 60]
      );
      
      res.json(result.rows[0]);
      
    } catch (error) {
      console.error('Erro ao criar deal:', error);
      res.status(500).json({ error: 'Erro ao criar negócio' });
    }
  }
  
  async moveDeal(req, res) {
    try {
      const { id } = req.params;
      const { stageId } = req.body;
      
      await pool.query(
        'UPDATE leads SET status = $1, atualizado_em = NOW() WHERE id = $2 AND usuario_id = $3',
        [stageId, id, req.userId]
      );
      
      // Registrar atividade
      await pool.query(
        `INSERT INTO atividades (usuario_id, tipo, titulo, descricao)
         VALUES ($1, $2, $3, $4)`,
        [req.userId, 'deal_moved', 'Negócio movido', `Negócio movido para ${stageId}`]
      );
      
      res.json({ success: true });
      
    } catch (error) {
      console.error('Erro ao mover deal:', error);
      res.status(500).json({ error: 'Erro ao mover negócio' });
    }
  }
  
  async updateDeal(req, res) {
    try {
      const { id } = req.params;
      const updates = req.body;
      
      const fields = Object.keys(updates);
      const values = Object.values(updates);
      
      const setClause = fields.map((field, i) => `${field} = $${i + 3}`).join(', ');
      
      const result = await pool.query(
        `UPDATE leads SET ${setClause}, atualizado_em = NOW()
         WHERE id = $1 AND usuario_id = $2
         RETURNING *`,
        [id, req.userId, ...values]
      );
      
      res.json(result.rows[0]);
      
    } catch (error) {
      console.error('Erro ao atualizar deal:', error);
      res.status(500).json({ error: 'Erro ao atualizar negócio' });
    }
  }
  
  async deleteDeal(req, res) {
    try {
      const { id } = req.params;
      
      await pool.query(
        'DELETE FROM leads WHERE id = $1 AND usuario_id = $2',
        [id, req.userId]
      );
      
      res.json({ success: true });
      
    } catch (error) {
      console.error('Erro ao deletar deal:', error);
      res.status(500).json({ error: 'Erro ao deletar negócio' });
    }
  }
}

module.exports = new PipelineController();