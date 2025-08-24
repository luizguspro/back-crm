const pool = require('../config/database');

class DashboardController {
  async getKPIs(req, res) {
    try {
      const userId = req.userId;
      
      // Buscar KPIs do usuário
      const leadsQuentes = await pool.query(
        'SELECT COUNT(*) FROM leads WHERE usuario_id = $1 AND score >= 80',
        [userId]
      );
      
      const novosLeads = await pool.query(
        'SELECT COUNT(*) FROM leads WHERE usuario_id = $1 AND DATE(criado_em) = CURRENT_DATE',
        [userId]
      );
      
      const visitasAgendadas = await pool.query(
        'SELECT COUNT(*) FROM agendamentos WHERE usuario_id = $1 AND data >= CURRENT_DATE',
        [userId]
      );
      
      const conversoes = await pool.query(
        'SELECT COUNT(*) FROM leads WHERE usuario_id = $1 AND status = $2',
        [userId, 'won']
      );
      
      const totalLeads = await pool.query(
        'SELECT COUNT(*) FROM leads WHERE usuario_id = $1',
        [userId]
      );
      
      const taxaConversao = totalLeads.rows[0].count > 0 
        ? (conversoes.rows[0].count / totalLeads.rows[0].count * 100).toFixed(1)
        : 0;
      
      res.json({
        leadsQuentes: parseInt(leadsQuentes.rows[0].count),
        novosLeads: parseInt(novosLeads.rows[0].count),
        visitasAgendadas: parseInt(visitasAgendadas.rows[0].count),
        taxaConversao: parseFloat(taxaConversao)
      });
      
    } catch (error) {
      console.error('Erro ao buscar KPIs:', error);
      res.status(500).json({ error: 'Erro ao buscar KPIs' });
    }
  }
  
  async getRecentActivities(req, res) {
    try {
      const result = await pool.query(
        `SELECT a.*, c.nome as contact_name 
         FROM atividades a 
         LEFT JOIN contatos c ON a.contato_id = c.id 
         WHERE a.usuario_id = $1 
         ORDER BY a.criado_em DESC 
         LIMIT 20`,
        [req.userId]
      );
      
      res.json(result.rows);
      
    } catch (error) {
      console.error('Erro ao buscar atividades:', error);
      res.status(500).json({ error: 'Erro ao buscar atividades' });
    }
  }
  
  async getPerformanceData(req, res) {
    try {
      const days = req.query.days || 10;
      
      const result = await pool.query(
        `SELECT 
          DATE(criado_em) as data,
          COUNT(DISTINCT CASE WHEN tipo = 'conversa' THEN id END) as conversas,
          COUNT(DISTINCT CASE WHEN tipo = 'lead' THEN id END) as leads,
          COUNT(DISTINCT CASE WHEN tipo = 'venda' THEN id END) as vendas,
          SUM(CASE WHEN tipo = 'venda' THEN valor ELSE 0 END) as receita
         FROM atividades
         WHERE usuario_id = $1 AND criado_em >= CURRENT_DATE - INTERVAL '${days} days'
         GROUP BY DATE(criado_em)
         ORDER BY data DESC`,
        [req.userId]
      );
      
      res.json(result.rows);
      
    } catch (error) {
      console.error('Erro ao buscar performance:', error);
      res.status(500).json({ error: 'Erro ao buscar dados de performance' });
    }
  }
  
  async getChannelPerformance(req, res) {
    try {
      const result = await pool.query(
        `SELECT 
          canal,
          COUNT(*) as contacts,
          COUNT(DISTINCT CASE WHEN convertido = true THEN id END) as conversions,
          ROUND(COUNT(*) * 100.0 / SUM(COUNT(*)) OVER (), 0) as percentage
         FROM contatos
         WHERE usuario_id = $1
         GROUP BY canal`,
        [req.userId]
      );
      
      res.json(result.rows);
      
    } catch (error) {
      console.error('Erro ao buscar canais:', error);
      res.status(500).json({ error: 'Erro ao buscar performance por canal' });
    }
  }
}

module.exports = new DashboardController();