const pool = require('../config/database');

class AutomationController {
  async getStatus(req, res) {
    try {
      const result = await pool.query(
        'SELECT * FROM automacao_config WHERE usuario_id = $1',
        [req.userId]
      );
      
      const config = result.rows[0] || { ativa: false };
      
      res.json({
        isRunning: config.ativa,
        lastRun: config.ultima_execucao
      });
      
    } catch (error) {
      console.error('Erro ao buscar status:', error);
      res.status(500).json({ error: 'Erro ao buscar status' });
    }
  }
  
  async start(req, res) {
    try {
      await pool.query(
        `INSERT INTO automacao_config (usuario_id, ativa) 
         VALUES ($1, true)
         ON CONFLICT (usuario_id) 
         DO UPDATE SET ativa = true`,
        [req.userId]
      );
      
      res.json({ success: true });
      
    } catch (error) {
      console.error('Erro ao iniciar automação:', error);
      res.status(500).json({ error: 'Erro ao iniciar automação' });
    }
  }
  
  async stop(req, res) {
    try {
      await pool.query(
        'UPDATE automacao_config SET ativa = false WHERE usuario_id = $1',
        [req.userId]
      );
      
      res.json({ success: true });
      
    } catch (error) {
      console.error('Erro ao parar automação:', error);
      res.status(500).json({ error: 'Erro ao parar automação' });
    }
  }
  
  async getFlows(req, res) {
    try {
      const flows = [
        {
          id: 'auto-qualify-hot',
          nome: 'Qualificar Leads Quentes',
          descricao: 'Move leads com score alto para qualificados',
          ativo: true,
          gatilho: 'Score > 80',
          regras: { score_minimo: 80 }
        },
        {
          id: 'auto-cadence',
          nome: 'Cadência de Follow-up',
          descricao: 'Envia mensagens automáticas de follow-up',
          ativo: true,
          gatilho: 'Sem resposta há 24h',
          regras: { tempo_sem_resposta: 24 }
        }
      ];
      
      res.json(flows);
      
    } catch (error) {
      console.error('Erro ao buscar fluxos:', error);
      res.status(500).json({ error: 'Erro ao buscar fluxos' });
    }
  }
  
  async updateFlow(req, res) {
    try {
      const { flowId } = req.params;
      const config = req.body;
      
      // Aqui você salvaria a configuração do fluxo no banco
      
      res.json({ success: true });
      
    } catch (error) {
      console.error('Erro ao atualizar fluxo:', error);
      res.status(500).json({ error: 'Erro ao atualizar fluxo' });
    }
  }
  
  async runNow(req, res) {
    try {
      // Executar automações manualmente
      // Implementar lógica de automação aqui
      
      await pool.query(
        'UPDATE automacao_config SET ultima_execucao = NOW() WHERE usuario_id = $1',
        [req.userId]
      );
      
      res.json({ success: true });
      
    } catch (error) {
      console.error('Erro ao executar automação:', error);
      res.status(500).json({ error: 'Erro ao executar automação' });
    }
  }
}

module.exports = new AutomationController();