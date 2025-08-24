const pool = require('../config/database');
const { v4: uuidv4 } = require('uuid');

class CampaignController {
  async getAll(req, res) {
    try {
      const result = await pool.query(
        'SELECT * FROM campanhas WHERE usuario_id = $1 ORDER BY criado_em DESC',
        [req.userId]
      );
      
      res.json(result.rows);
      
    } catch (error) {
      console.error('Erro ao buscar campanhas:', error);
      res.status(500).json({ error: 'Erro ao buscar campanhas' });
    }
  }
  
  async create(req, res) {
    try {
      const campaign = {
        id: uuidv4(),
        usuario_id: req.userId,
        ...req.body
      };
      
      const result = await pool.query(
        `INSERT INTO campanhas 
         (id, usuario_id, nome, tipo, status, mensagem, canais, publico_alvo, data_inicio, data_fim, orcamento)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         RETURNING *`,
        [campaign.id, campaign.usuario_id, campaign.nome, campaign.tipo, 
         campaign.status || 'draft', campaign.mensagem, campaign.canais,
         campaign.publico_alvo, campaign.data_inicio, campaign.data_fim, campaign.orcamento]
      );
      
      res.json(result.rows[0]);
      
    } catch (error) {
      console.error('Erro ao criar campanha:', error);
      res.status(500).json({ error: 'Erro ao criar campanha' });
    }
  }
  
  async update(req, res) {
    try {
      const { id } = req.params;
      const updates = req.body;
      
      const fields = Object.keys(updates);
      const values = Object.values(updates);
      
      const setClause = fields.map((field, i) => `${field} = $${i + 3}`).join(', ');
      
      const result = await pool.query(
        `UPDATE campanhas SET ${setClause}, atualizado_em = NOW()
         WHERE id = $1 AND usuario_id = $2
         RETURNING *`,
        [id, req.userId, ...values]
      );
      
      res.json(result.rows[0]);
      
    } catch (error) {
      console.error('Erro ao atualizar campanha:', error);
      res.status(500).json({ error: 'Erro ao atualizar campanha' });
    }
  }
  
  async delete(req, res) {
    try {
      const { id } = req.params;
      
      await pool.query(
        'DELETE FROM campanhas WHERE id = $1 AND usuario_id = $2',
        [id, req.userId]
      );
      
      res.json({ success: true });
      
    } catch (error) {
      console.error('Erro ao deletar campanha:', error);
      res.status(500).json({ error: 'Erro ao deletar campanha' });
    }
  }
}

module.exports = new CampaignController();